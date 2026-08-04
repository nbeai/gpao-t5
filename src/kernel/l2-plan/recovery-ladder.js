// L2 · 되게 만드는 사다리 (P2-6) — T5 의 최우선 미션은 **사용자 지시를 최대한 수행하는 것**이다.
//
// 오너 지시(2026-07-27): "된다/안 된다"만 말하지 마라. ① 가진 도구로 되는 방법을 찾고
// ② 못 하는 부분은 대안을 제시해라. 그게 동반자다. 네이버 하나 모바일로 뚫은 건 로봇이다.
//
// 그래서 실패를 **한 번의 결과**가 아니라 **사다리**로 다룬다.
//   1단 같은 도구, 다른 방법  — 주소 변환·다음 후보·인자 조정
//   2단 다른 도구            — 우리 수집이 막히면 모델 내장 검색, 로컬이 막히면 범위 확장 요청
//   3단 사용자와 함께        — 사람만 할 수 있는 최소 단계를 부탁한다(로그인·화면 붙여넣기)
//   4단 정직하게            — 무엇이 왜 막혔는지 + 지금 할 수 있는 한 가지
//
// 여기서 정하는 것은 **다음 시도의 종류**뿐이다. 실행·승인·기록은 기존 경로가 그대로 한다.


/**
 * 실패 종류 → 다음에 밟을 계단. 도구가 늘어도 이 표는 종류로만 자란다(사례 하드코딩 금지).
 * P0-b: `needsHand` 로 지목된 손은 **다른 손의 범위 밖을 대신 밟는 손**이다 — 그 사실이
 * 사용자 고지 대상(descriptor.readReach)을 정한다. 손 목록을 검사에 손으로 적지 않게
 * 이 표를 내보낸다(여기에 손을 더하면 고지 불변식이 자동으로 그 손을 문다).
 */
const LADDER = {
  // 웹: 사이트가 막았다 → 우리 수집 대신 모델이 자기 인프라로 찾는다(1층은 스크래핑 차단에 안 걸린다).
  robots_disallow: { rung: 'other_tool', useModelSearch: true, why: '그 사이트가 수집을 막아 두었어요' },
  login_wall: { rung: 'ask_user', useModelSearch: true, why: '로그인이 필요한 페이지예요' },
  bot_wall: { rung: 'other_tool', useModelSearch: true, why: '자동 접근을 막아 두었어요' },
  // 'blocked' 는 **모든 도구 공통** 상태다. 여기에 "주소" 같은 웹 어휘를 쓰면 파일 실패에도
  // "그 주소를 열지 못했어요"가 나간다(라이브 실측). 도구 중립으로 둔다.
  blocked: { rung: 'other_tool', useModelSearch: true, why: '그건 지금 열지 못했어요' },
  // 반복시: **같은 실패의 두 번째부터** 밟는 계단(H09 — 같은 실패 반복 0). 재시도는 한 번은
  // 정당하지만, 두 번째에도 재시도를 권하면 사다리가 반복 그 자체를 만든다.
  timeout: {
    rung: 'retry', why: '응답이 늦어요',
    반복시: { rung: 'other_tool', useModelSearch: true, why: '기다려도 응답이 없어요' },
  },
  // 429/503 은 "안 되는 곳"이 아니라 **잠시 뒤면 되는 일**이다. 다른 경로로 도망가지 말고 기다린다.
  // (우리가 너무 자주 물어서 생긴 경우가 대부분이다 — 실측 2026-07-27.)
  rate_limited: {
    rung: 'retry', why: '너무 자주 물어봐서 그 사이트가 잠시 쉬라고 했어요',
    반복시: {
      rung: 'ask_user', why: '너무 자주 물어봐서 그 사이트가 잠시 쉬라고 했어요',
      next: '시간을 조금 두었다가 다시 시켜 주시면 그때 해볼게요.',
    },
  },
  // 로컬: 파일 손의 범위 밖은 **T5 의 한계가 아니다.** 그 자리를 읽는 손이 따로 있으면
  // 2단(다른 손)이지 3단(사용자에게 부탁)이 아니다. 라이브에서 이 계단을 3단으로 두는 바람에
  // "폴더를 통째로 복사해 주세요"까지 갔다(c217a0c6) — 다음 턴에 터미널로 다 읽을 수 있었다.
  //
  // **다만 손이 있을 때만 그렇게 말한다.** 없는 손을 약속하면 거짓이고, 그때는 범위를 넓혀
  // 달라고 부탁하는 것이 맞다(그건 사람만 할 수 있는 일이다 — 예전 계약 그대로 남긴다).
  out_of_scope: {
    rung: 'other_hand', needsHand: 'local.terminal',
    why: '그 자리는 파일 도구의 작업 폴더 밖이에요',
    없으면: { rung: 'ask_user', requestScope: true, why: '제 작업 폴더 밖이에요' },
  },
  needs_auth: { rung: 'ask_user', why: '연결이 필요해요' },
  // 보호 영역(비밀·시스템)은 **우회 대상이 아니다.** 여기에 계단이 없어서 일반 경로로 흘렀다 —
  // 다른 경로로 찾겠다는 약속은 비밀 앞에서는 그 자체가 위반이다(H09 반대시험으로 실측).
  // 사람만 할 수 있는 최소 단계 하나만 정직하게 준다. useModelSearch 금지.
  protected: {
    rung: 'ask_user',
    why: '그 자리는 지키는 자리라 제가 열지 않아요',
    next: '필요한 내용이 있으면 직접 확인해서 필요한 부분만 알려 주시면 그걸로 이어갈게요.',
  },
  // ── H09 실패 다섯 종류(기계 사실 분류) 계단 ──
  // fetchState·scopeState 처럼 도구가 종류를 직접 선언하지 않아도, 원장 영수증의 기계 사실
  // (오류 코드·호출 없음)에서 판별된 종류가 여기로 온다. 사례가 아니라 종류로만 자란다.
  not_found: {
    rung: 'other_hand', needsHand: 'local.locate',
    why: '그 이름의 파일을 지금 자리에서 찾지 못했어요',
    없으면: {
      rung: 'ask_user', why: '그 이름의 파일을 지금 자리에서 찾지 못했어요',
      next: '어느 폴더에 있는지 알려 주시면 바로 볼게요.',
    },
  },
  access_denied: {
    rung: 'ask_user', why: '그 자리에는 접근 권한이 없어요',
    next: '접근할 수 있는 다른 사본이 있으면 알려 주세요.',
  },
  // 도구 없음은 "그 대상이 막혔다"가 아니다 — 손이 없는 것이다. 웹 계열이면 모델 내장 검색이
  // 실제 대안이 되므로 켤 수 있게 두되(켤지는 런타임이 modelSupportsSearch 로 판단),
  // 문장은 도구가 준비되지 않았다는 사실을 말한다(일반 blocked 문구로 뭉개지 않는다).
  tool_missing: { rung: 'other_tool', useModelSearch: true, why: '그 일을 맡는 도구가 아직 준비되지 않았어요' },
  unsupported_format: {
    rung: 'ask_user', why: '그건 지금 방식으로는 읽지 못하는 형식이에요',
    next: '다른 형식으로 된 사본이 있으면 알려 주시면 그걸로 볼게요.',
  },
  exec_failed: { rung: 'retry', why: '실행 중 문제가 있었어요' },
};

// ── H09 · 실패 다섯 종류 — 원장 영수증의 기계 사실에서 판별한다 ──────────
// 접근 거부 / 파일 없음 / 도구 없음 / 형식 미지원 / 실행 실패. 사용자 문장(한국어)을 파싱하지
// 않는다 — 문장은 바뀌지만 기계 사실(scopeState·fetchState·오류 코드·호출 없음)은 계약이다.

/** 진단면에서 OS 오류 코드만 꺼낸다. 진단 원문은 여기서 끝난다(사용자면으로 안 나간다). */

function 오류코드(diag) {
  if (!diag) return undefined;
  if (typeof diag === 'object' && typeof diag.code === 'string') return diag.code;
  const 원문 = typeof diag === 'string' ? diag : `${diag.message ?? ''} ${diag.reason ?? ''}`;
  return /\b(ENOENT|ENOTDIR|EACCES|EPERM|EISDIR|ENOTSUP|ENOSPC)\b/.exec(원문)?.[1];
}

const 접근거부_FETCH = new Set(['robots_disallow', 'login_wall', 'bot_wall', 'needs_auth']);

/** 기계 증거가 **있을 때만** 종류를 말한다. 증거 없는 실패는 여기서 판정하지 않는다(모름≠아무거나). */
function 증거종류(rec) {
  if (!rec) return null;
  if (rec.failureKind) return rec.failureKind; // 도구가 직접 선언한 분류가 최우선(미래 계약)
  // 호출 자체가 없었다(actualCall null) + 실행 불가 사유 — 도구가 없는 것이다.
  const diag = rec.diagnosticTrace;
  if (!rec.actualCall && typeof diag === 'object' && diag?.reason === 'not_executable') return 'tool_missing';
  if (rec.scopeState === 'out_of_scope' || rec.scopeState === 'protected') return 'access_denied';
  if (접근거부_FETCH.has(rec.fetchState)) return 'access_denied';
  const code = 오류코드(diag);
  if (code === 'EACCES' || code === 'EPERM') return 'access_denied';
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'not_found';
  if (code === 'EISDIR' || code === 'ENOTSUP') return 'unsupported_format';
  return null;
}

/**
 * 이 영수증의 실패 종류. 접근 거부(access_denied) · 파일 없음(not_found) · 도구 없음(tool_missing)
 * · 형식 미지원(unsupported_format) · 실행 실패(exec_failed). 실패가 아니면 null.
 * 증거가 없으면 failureState 로만 보수적으로 말한다: blocked → 접근 거부, failed/timeout → 실행 실패.
 * @param {import('../contracts.js').ToolReceipt|undefined} rec
 * @returns {'access_denied'|'not_found'|'tool_missing'|'unsupported_format'|'exec_failed'|null}
 */
export function 실패종류(rec) {
  if (!rec || (rec.failureState ?? 'none') === 'none') return null;
  const 증거 = 증거종류(rec);
  if (증거) return 증거;
  if (rec.failureState === 'blocked') return 'access_denied';
  if (rec.failureState === 'cancelled') return null; // 취소는 실패가 아니다 — 복구할 것이 없다
  return 'exec_failed';
}

/**
 * 이번 실패에서 다음에 무엇을 할지 정한다.
 *
 * **지금 어떤 손이 있는지를 보고 정한다.** 표에 적힌 계단이라도 그 손이 없으면 그 계단은
 * 없는 것이다 — 없는 손을 약속하면 "할 수 있다"는 거짓이 사용자에게 나간다.
 * @param {Array<{failureState?:string, fetchState?:string, scopeState?:string}>} receipts
 * @param {string[]} [hands] 지금 실제로 쓸 수 있는 도구 id 들(미지정이면 판정하지 않고 표대로)
 * @returns {{rung:string, useModelSearch?:boolean, requestScope?:boolean, why?:string}|null}
 */
// ── 호출 지문 — "같은 일"의 기계 신분(턴 실행부와 사다리가 같은 규칙을 쓴다) ──
// C 감사 F3.1/F3.2: 예전 지문은 `command ?? path ?? request` 라 ① 키 순서·부수 필드가 다르면
// 같은 일이 다른 지문이 됐고(과소 차단) ② `local.file` 의 action 이 지문에 없어 **읽고 나서
// 쓰는 정상 걸음**이 "같은 일 되풀이"로 차단됐다(과대 차단 — H08→H09 를 잇는 가장 흔한 경로).
// 정규화 규칙: 의미 있는 인자만, 키 정렬, 빈 값 제거. probe 부산물은 지문이 아니다.
// `cwd` 도 뺀다 — 계획 단계의 probe 가 채워 넣는 값이라, 모델이 같은 명령을 다시 고르면
// 한쪽에만 cwd 가 붙어 같은 일이 다른 지문이 된다(예전 계약도 command 만 봤다 — 보존).
const 지문제외 = new Set(['probeResult', 'granted', 'changes', 'targetLabel', 'cwd']);

/**
 * 도구 호출의 정규화 지문. 같은 일 = 같은 지문, 다른 일(다른 action·다른 대상) = 다른 지문.
 * @param {string} toolId @param {object} [args]
 */
export function 호출지문(toolId, args) {
  const a = args && typeof args === 'object' ? { ...args } : {};
  // local.file 의 기본 action 을 지문에도 똑같이 적는다(도구 handler 의 기본 규칙과 한 진실).
  // 이게 없으면 `{path}` 와 `{action:'read', path}` 가 같은 읽기인데 다른 지문이 된다.
  if (toolId === 'local.file' && a.action === undefined) a.action = a.path ? 'read' : 'list';
  const kv = Object.entries(a)
    .filter(([k, v]) => !지문제외.has(k) && v !== undefined && v !== null && v !== '')
    .map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
    .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
  return `${toolId}:${kv.map(([k, v]) => `${k}=${v}`).join('')}`;
}

/** 같은 실패인지 가르는 지문 — 턴 실행부(turn.js)와 같은 정규화 지문을 쓴다. */
function 실패지문(rec) {
  const call = rec?.actualCall;
  if (!call?.tool) return null;
  return 호출지문(call.tool, call.args ?? {});
}

/** 다른 손의 범위 밖을 대신 밟는 손들 — 고지 불변식(P0-b)이 이 집합을 문다. */
export function 범위를넘겨받는손들() {
  return [...new Set(Object.values(LADDER).flatMap((s) => [s?.needsHand, s?.반복시?.needsHand, s?.없으면?.needsHand]).filter(Boolean))];
}

export function nextRung(receipts = [], hands) {
  // H09 · 같은 실패 반복 0 — 같은 손·같은 인자의 실패가 이미 두 번 이상 쌓였으면,
  // 그 실패에 다시 "재시도"를 권하지 않는다(권하면 사다리가 반복을 만든다).
  const 본지문 = new Map();
  for (const r of receipts) {
    if (!r || (r.failureState ?? 'none') === 'none') continue;
    const 지문 = 실패지문(r);
    if (지문) 본지문.set(지문, (본지문.get(지문) ?? 0) + 1);
  }
  for (const r of receipts) {
    if (!r || (r.failureState ?? 'none') === 'none') continue;
    // 종류 판별: 도구가 선언한 종류(fetchState·scopeState)가 가장 정확하고, 다음이 원장의
    // 기계 증거(오류 코드·호출 없음), 마지막이 일반 상태(blocked)다. 증거 없는 failed/timeout 은
    // 계단을 만들지 않는다 — 그때는 도구가 남긴 다음 길(nextSafeAction)이 더 정확하다(다음길 계약).
    let key; let step;
    for (const k of [r.fetchState, r.scopeState, 증거종류(r), r.failureState]) {
      if (k && LADDER[k]) { key = k; step = LADDER[k]; break; }
    }
    if (!step) continue;
    // 반복 확전: 같은 실패의 두 번째부터는 "다시 시도"가 답이 될 수 없다.
    const 반복됨 = (본지문.get(실패지문(r)) ?? 0) >= 2;
    if (반복됨 && step.rung === 'retry') {
      step = step.반복시 ?? {
        rung: 'ask_user', why: step.why,
        next: '같은 방법으로는 계속 안 되고 있어요. 다른 방법을 알려 주시면 그걸로 해볼게요.',
      };
    }
    const { needsHand, 없으면, 반복시: _확전, ...본계단 } = step;
    // **모르면 약속하지 않는다.** 손이 있다고 확인됐을 때만 "다른 손으로 이어서"라고 말한다 —
    // 손 목록을 안 준 호출부(구형·단위 검사)는 보수적인 계단으로 간다. 없는 손을 약속하는 것이
    // 부탁하는 것보다 나쁘다: 사용자는 기다리다가 아무 일도 안 일어난 걸 알게 된다.
    if (needsHand && !(Array.isArray(hands) && hands.includes(needsHand))) {
      return { ...(없으면 ?? 본계단), from: key };
    }
    return { ...본계단, from: key };
  }
  return null;
}

/**
 * 사용자에게 보일 한 줄. **무엇이 막혔는지 + 지금 이어서 무엇을 하는지**를 함께 말한다.
 * "안 됩니다"로 끝나는 문장을 만들지 않는다(막다른 답 금지).
 */
export function rungMessage(step) {
  if (!step) return undefined;
  switch (step.rung) {
    case 'other_tool':
      return `${step.why}. 대신 제가 아는 경로로 찾아볼게요.`;
    // 2단의 로컬 판 — 한 손이 안 닿으면 **다른 손으로 내가 이어서 한다.** 사용자를 시키지 않는다.
    case 'other_hand':
      return `${step.why}. 제 다른 손으로 이어서 볼게요.`;
    case 'ask_user':
      // C 감사 F6.3: "작업 범위에 넣어 주시면"은 제품에 그 수단이 없어(기동 시 환경변수뿐)
      // 사용자가 할 수 없는 행동을 약속하는 말이었다. 지금 실제로 되는 다음 행동만 청한다 —
      // 볼 수 있는 자리(작업 폴더·Downloads·Documents·Desktop) 안의 사본을 알려 주는 것.
      if (step.requestScope) {
        return `${step.why}. 제가 볼 수 있는 자리(작업 폴더·다운로드·문서·바탕화면) 안에 사본이 있으면 알려 주세요 — 바로 볼게요.`;
      }
      // 계단이 종류에 맞는 다음 한 걸음(next)을 스스로 말하면 그것을 쓴다 — 기본 문구
      // ("화면 내용을 붙여 주시면")는 로그인벽에서 나온 말이라 파일 없음·형식 미지원에는 거짓이다.
      if (step.next) return `${step.why}. ${step.next}`;
      return `${step.why}. 화면 내용을 붙여 주시면 이어서 정리할게요.`;
    case 'retry':
      // 시점을 정직하게(P-OP-6): 같은 턴의 같은 재시도는 지문이 막는다 — "해볼게요"라고
      // 약속해 놓고 이 턴에 안 하는 모양이 된다. 되는 것은 잠시 뒤(다음 요청)의 재시도다.
      return `${step.why}. 잠시 뒤에 다시 시도해 볼 수 있어요.`;
    default:
      return undefined;
  }
}

// ── H09 P0 · 읽지 못한 것을 읽은 척하는 답 차단 ──────────────────────────
// 인간 기준선 실측(H09): 1회차가 읽지 못한 내용을 읽은 척 서술했다. 프롬프트 문구는 이 병을
// 못 막는다 — **원장(영수증)과 답을 기계로 대조**한다. 이번 턴의 실행이 전부 실패했는데
// 답이 내용을 서술하면, 그 서술의 근거가 원장 어디에도 없다는 것이 기계 사실이다.

/** 실행 영수증의 사람이 부를 이름 — 사용자면 값(경로·요청)만 쓴다. 진단면은 안 쓴다. */
function 대상이름(rec) {
  const a = rec?.actualCall?.args ?? {};
  return a.path ?? a.request ?? a.command ?? a.subject ?? rec?.intended ?? '';
}

/**
 * 이번 턴 원장의 읽기 사실 — **무엇을 실제로 봤고 무엇을 못 봤는가.** 모델 입력에 사실로
 * 공급하는 재료다(문구 주입이 아니라 현실 공급 — 감사 계약 그대로).
 * @param {Array<import('../contracts.js').ToolReceipt>} receipts
 * @returns {{확인한것: Array<{무엇:string}>, 못본것: Array<{무엇:string, 왜?:string}>}}
 */
export function 읽기사실(receipts = []) {
  const 확인한것 = [];
  const 못본것 = [];
  for (const r of receipts ?? []) {
    if (!r) continue;
    if ((r.failureState ?? 'none') === 'none') 확인한것.push({ 무엇: String(대상이름(r)) });
    else 못본것.push({ 무엇: String(대상이름(r)), 왜: r.userSafeSummary });
  }
  return { 확인한것, 못본것 };
}

// "내용을 서술하고 있다"는 신호 — 읽은 결과를 전하는 상투 형태만 본다(정직한 실패 보고
// "읽지 못했어요"는 여기 걸리지 않는다). 이 목록은 판정의 마지막 조각일 뿐이고, 판정의
// 근거는 원장이다: 성공 영수증이 하나라도 있으면 이 목록은 아예 보지 않는다.
const 내용서술 = /읽어\s*보니|열어\s*보니|살펴\s*보니|내용(을|은)\s*보(면|니)|내용(은|이)?\s*다음과\s*같|파일에는|문서에는|적혀\s*있|담겨\s*있|들어\s*있(네|어|습)|에\s*따르면|정리하면\s*(다음|이렇)/;

/**
 * **읽기 성공 영수증이 0인데 답이 내용을 서술하면 차단한다**(H09 P0 — 거짓 성공 금지).
 * 차단은 빈 답이 아니다 — 영수증의 사용자면 사실로 만든 정직한 답을 함께 준다.
 *
 * 판정은 보수적이다: 이번 턴에 성공한 실행이 하나라도 있으면 서술의 근거일 수 있으므로
 * 막지 않는다(부분 성공 턴의 어느 서술이 어느 영수증 것인지는 기계가 못 가른다 — 한계 명시).
 * @param {Array<import('../contracts.js').ToolReceipt>} receipts 이번 턴 원장
 * @param {string} reply 내보내려는 최종 답
 * @returns {{blocked:true, reason:'unread_content_claim', 정직한답:string}|null}
 */
/**
 * 출처가 **계약인** 손을 썼는데 출처를 하나도 못 댔는가.
 *
 * 손 이름도, 실패 문장도 보지 않는다 — descriptor 가 선언한 `sourceLedgerRequired` 사실만 본다.
 * 실측(2026-08-03): 웹이 막혀 손이 던지면 영수증에는 일반 실패 문장만 남아 어떤 문구 규칙으로도
 * 잡을 수 없었다. **출처를 못 대면 그 답은 확인한 답이 아니다** — 그것만 계약으로 둔다.
 */
/**
 * **답이 말한 구체 사실 중 원장이 뒷받침하지 못하는 것.**
 *
 * 예문 규칙이 아니다 — 문구를 세지 않고 **사실 토막**을 센다. 목록은 늘어나지만
 * "두 자리 이상 수·날짜·금액·비율"의 정의는 늘어나지 않는다(절대원칙 8 · §4-6).
 *
 * 왜 두 자리부터인가: 목록 번호("1.", "2.")와 한 자리 수는 사람 말의 뼈대라
 * 지어낸 사실의 신호가 아니다. 실측(라이브 정직한 답)이 그 자리에 걸렸다.
 *
 * 대조 대상은 **원장 전체**다 — 호출 인자·요약·다음 행동까지. 사용자가 준 값을
 * 되풀이하는 것은 지어낸 것이 아니고, 그 값은 호출 인자로 원장에 남아 있다.
 */
export function 뒷받침없는구체(reply = '', receipts = []) {
  const 원장글 = JSON.stringify(receipts ?? '');
  const 토막 = new Set();
  for (const m of String(reply).matchAll(/\d[\d,.]*\s*(?:%|퍼센트|원|만원|억|건|명|점)?/g)) {
    const 원문 = m[0].trim();
    const 숫자만 = 원문.replace(/[^\d]/g, '');
    // 한 자리 수는 목록 번호·사람 말의 뼈대다. 사실 토막으로 세지 않는다.
    if (숫자만.length < 2) continue;
    토막.add(원문);
  }
  // 원장에 그 숫자가 있으면 뒷받침이 있다(표기 차이는 숫자만으로 대조한다).
  return [...토막].filter((t) => {
    const 숫자만 = t.replace(/[^\d]/g, '');
    return !원장글.includes(숫자만) && !원장글.replace(/[^\d]/g, '').includes(숫자만);
  });
}

function 출처못댐(receipts = [], 출처계약손 = []) {
  const 계약손 = new Set(출처계약손 ?? []);
  if (!계약손.size) return false;
  const 썼나 = (receipts ?? []).some((r) => r && 계약손.has(r.actualCall?.tool));
  if (!썼나) return false;
  return !(receipts ?? []).some((r) => Array.isArray(r?.sources) && r.sources.length > 0);
}

export function 읽은척차단(receipts = [], reply = '', { 출처계약손 = [] } = {}) {
  const 사실 = 읽기사실(receipts);
  if (!사실.못본것.length) return null;   // 실패한 실행이 없다 — 대조할 거짓이 없다
  if (사실.확인한것.length) return null;  // 실제로 본 것이 있다 — 서술의 근거일 수 있다
  // **출처가 계약인 손이 실패했으면 문구를 보지 않는다.**
  //
  // 실측(2026-08-03): `web.collect` 두 번 실패 · 원장 확인 0 · 출처 0 인데, 답이
  // "국세청 … 안내를 기준으로 정리하면 아래와 같습니다" 로 기관 문서를 근거처럼 인용하고
  // 날짜를 단정했다. `내용서술` 정규식이 "정리하면 아래와" 를 못 잡아 그대로 나갔다.
  //
  // 정규식을 늘리면 다음 문구에서 또 샌다 — 예문 규칙을 키우는 일이다(§4-6 금지).
  // 대신 기계 사실로 판정한다: **출처를 못 대면 그 답은 근거를 가진 답이 아니다.**
  // 조사에서 출처는 선택이 아니라 계약이므로, 문구가 무엇이든 정직한 사실이 나간다.
  // ── **F-15(2026-08-05): 출처 실패만으로는 막지 않는다** ────────────────────
  //
  // 라이브 실측: 차단 교환을 받은 모델이 *"…못 읽게 막혀 있어서 볼 수가 없어. 대신 이렇게…"*
  // 라고 **정직하게** 답했는데 이 게이트가 그것을 버리고 런타임 문장으로 갈아치웠다.
  // `출처못댐` 이 **답의 내용을 보지 않고** 단독으로 막았기 때문이다.
  //
  // 그 단독 차단은 2026-08-03 사고의 보상책이었고, **그 사고의 원인은 모델이 실패 사실을
  // 못 받은 것**이었다(차단 호출이 교환에 안 들어갔다). S2 가 그걸 고쳤다 —
  // 알려 주면 모델은 정직하게 말한다. 그래서 보상책은 이제 정직한 답만 죽인다.
  //
  // 문구 목록은 늘리지 않는다(§4-6 — 늘리면 다음 문장에서 또 샌다).
  // **구조로 판정한다**: 읽기가 전패했으면 T5 가 그 대상에 대해 가진 것은 "신분 + 실패" 뿐이다.
  // 그런데 답이 **원장 어디에도 없는 구체 사실**(두 자리 이상 수·날짜·금액·비율)을 말하면,
  // 그건 얻지 못한 것을 얻은 것처럼 말한 것이다. "못 읽었다"는 답에는 그런 토막이 없다.
  //
  // ── **이 판정의 알려진 구멍**(숨기지 않는다) ──────────────────────────────
  // 숫자가 없고 `내용서술` 문구도 안 쓰는 지어냄은 여기서 안 걸린다
  // (예: "국세청 자료를 보면 온라인 신고만 됩니다" — 날짜도 금액도 없다).
  // 그럼에도 이렇게 두는 이유:
  //   ① 옛 판정이 정직한 답을 **버리는 것은 라이브에서 매번** 일어났다(측정됨).
  //      구멍은 특정한 지어냄 방식일 때만 열린다.
  //   ② 뒤에 `출구검증` 이 한 겹 더 있다(답이 가리킨 자리가 원장에 없으면 되돌린다).
  //   ③ 문구 목록을 늘리는 길은 이미 두 번 뚫렸다(§4-6).
  // 이 구멍을 메우려면 **또 다른 구조 신호**가 필요하다 — 장부 F-15 에 그렇게 적었다.
  const 근거없는구체 = 출처못댐(receipts, 출처계약손)
    && 뒷받침없는구체(String(reply ?? ''), receipts).length > 0;
  if (!근거없는구체 && !내용서술.test(String(reply ?? ''))) return null;
  // 같은 실패가 여러 번이면 사용자는 같은 말을 여러 번 듣는다(실측: 3회 반복).
  // 사실을 줄이는 게 아니라 **같은 문장을 한 번만** 말한다 — 다른 실패는 그대로 다 남는다.
  const 무엇이 = [...new Set((receipts ?? [])
    .filter((r) => r && (r.failureState ?? 'none') !== 'none')
    .map((r) => r.userSafeSummary).filter(Boolean))].join(' ');
  const 다음 = (receipts ?? []).map((r) => r?.nextSafeAction).find((x) => typeof x === 'string' && x.trim());
  return {
    blocked: true,
    reason: 'unread_content_claim',
    정직한답: `${무엇이 || '요청하신 내용을 아직 확인하지 못했어요.'}${다음 ? ` ${다음}` : ''}`.trim(),
  };
}
