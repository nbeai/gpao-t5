// L1 · LLM-ready Task Context Packet (모델 입력 계약, §11)
// 계약들이 모델에게 전달되는 최종 형태. "사실·경계"를 주고 "판단·문장"은 모델에 남긴다.
// 지시문 장문 주입이 아니다(T3 tool-path-briefing 실증 원리). 무관한 사실을 나열하지 않는다.
import { selfStateSummary } from '../l0-evidence/self-state.js';
import { sameSiteLinks } from '../l0-evidence/working-state.js';
import { operatorReality } from './operator-reality.js';

/**
 * 도구 결과에서 **사용자면 데이터**만 압축해 뽑는다. 통째로 넣으면 프롬프트가 폭주하고,
 * 안 넣으면 모델이 실행 결과를 못 보고 되묻는다. 진단·내부 구조는 애초에 receipt 에 없다.
 */
/** 긴 글은 앞뒤를 남기고 가운데를 접는다 — 앞부분만 자르면 결론이 통째로 사라진다. */
function fold(text, keep) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= keep) return t;
  const head = Math.ceil(keep * 0.7);
  return `${t.slice(0, head)} …(가운데 ${t.length - keep}자 생략)… ${t.slice(-(keep - head))}`;
}

/**
 * 실행 결과 → **모델이 판단할 수 있는 요약 사실**.
 *
 * 예전엔 `JSON.stringify(result).slice(0, 1200)` 이었다. 앞부분만 남기는 절단이라 뒤에 있던
 * 링크·관찰 사실이 통째로 잘렸다 — 그리고 무엇이 잘렸는지도 안 보였다(오너 지적).
 * 원문은 **영수증에 그대로 남는다.** 여기 오는 것은 판단에 필요한 것만이다.
 *
 * 도구마다 "중요한 것"이 다르므로 종류별로 요약한다. 사이트별 분기는 없다.
 */
export function compactResult(result, maxChars = 1200) {
  if (result == null || typeof result !== 'object') return undefined;

  // ① 브라우저 관찰 — 화면 핵심 글 · 본 범위 · 못 본 범위 · 더 열 것 · 조작
  const o = result.observation;
  if (o) {
    const lines = [];
    if (result.title) lines.push(`화면: ${result.title}`);
    if (o.seen) {
      lines.push(`글로 받은 범위: ${o.seen.chars}자 / 전체 ${o.seen.of}자 (${o.seen.percent}%)`
        + (o.thin ? ' — 글이 거의 없어요(열리기만 했을 수 있어요)' : ''));
    }
    if (o.unseen?.chars) lines.push(`못 받은 글: ${o.unseen.chars}자 (${o.unseen.percent}%)`);
    lines.push(`화면 아래 남음: ${o.moreBelow ? '있음(더 내리면 새로 불러올 수 있어요)' : '없음'}`);
    if (o.canOpen?.length) {
      lines.push(`더 열 수 있는 것: ${o.canOpen.map((c) => `${c.text}(${c.kind}, ref=${c.ref})`).join(' · ')}`);
    }
    if (o.acted) {
      lines.push(o.acted.kind === 'scroll'
        ? `조작: ${o.acted.times}번 내렸어요${o.acted.stopped ? ` (${o.acted.stopped})` : ''}`
        : `조작: ${o.acted.ref} 를 눌렀어요`);
    }
    const body = fold(result.markdown ?? result.excerpt ?? '', Math.max(maxChars - lines.join('\n').length - 40, 200));
    return `${lines.join('\n')}\n본문: ${body}`;
  }

  // ② 웹 수집 — 제목 · 본문 길이 · 핵심 발췌 · 열지 않은 같은 사이트 링크
  if (typeof result.markdown === 'string' || Array.isArray(result.links)) {
    const lines = [];
    if (result.title) lines.push(`제목: ${result.title}`);
    if (Array.isArray(result.comparisonCandidates)) {
      // 조용히 자르지 않는다(같은 계열) — 몇 개 중 몇 개인지 말한다.
      if (result.comparisonCandidates.length > 3) lines.push(`비교 후보 ${result.comparisonCandidates.length}개 중 위 3개만 싣는다.`);
      for (const c of result.comparisonCandidates.slice(0, 3)) {
        const date = c.publishedAt ?? c.modifiedAt ?? '날짜 미확인';
        lines.push(`후보 ${c.rank}: ${c.title || '(제목 없음)'} · ${date} · ${c.url}`);
      }
    }
    const md = String(result.markdown ?? '');
    if (md) lines.push(`본문 ${md.length}자`);
    const 링크전체 = (result.links ?? []).map((l) => (typeof l === 'string' ? l : l?.url)).filter(Boolean);
    const links = 링크전체.slice(0, 6);
    // 조용히 자르지 않는다(같은 계열) — 안 실은 링크가 있으면 몇 개인지 말한다.
    if (links.length) {
      lines.push(`그 페이지의 링크: ${links.join(' · ')}`
        + (링크전체.length > links.length ? ` (전체 ${링크전체.length}개 중 ${links.length}개만 실음)` : ''));
    }
    const body = fold(md || result.excerpt || '', Math.max(maxChars - lines.join('\n').length - 40, 200));
    return `${lines.join('\n')}\n본문: ${body}`;
  }

  // ②-b 폴더 목록 — 이름 옆에 **사람 말 상대시각**을 붙인다. H08 라이브 실측(2026-08-01):
  // ISO 시각이 JSON 덩어리 속에 있으면 모델이 "방금 받은" 판단에 못 잇고 이름표("최종")로
  // 골랐다. 같은 사실을 판단이 닿는 형태로 준다(며칠·몇 분 전 — 지시가 아니라 사실이다).
  if (typeof result.path === 'string' && Array.isArray(result.items)) {
    const 지금 = Date.now();
    const 시각말 = (iso) => {
      const ms = 지금 - Date.parse(iso);
      if (!Number.isFinite(ms)) return '';
      const 분 = Math.max(1, Math.round(ms / 60_000));
      if (분 < 60) return ` — ${분}분 전 고침`;
      if (분 < 60 * 24) return ` — ${Math.round(분 / 60)}시간 전 고침`;
      return ` — ${Math.round(분 / (60 * 24))}일 전 고침`;
    };
    // ── **조용히 자르지 않는다** (오너 라이브 실측 2026-08-03) ──────────────
    // 다운로드 437개 정리 요청에서 이 갈래는 `slice(0,40)` 뒤 1200자에서 다시 잘려
    // **23개(5%)만** 모델에게 갔다. 그런데 요약은 "437개를 찾았어요"였고, 잘렸다는 말은
    // 마침표 세 개가 전부였다. 나머지를 가져올 인자(offset·limit)도 없다.
    // 모델은 "437개가 있다"는 말과 23개의 이름을 받은 채 "예고만으로 턴을 소비하지 말라"는
    // 요구까지 받았다 — 불가능한 자리다. 그래서 다섯 턴 내내 계획만 반복했다.
    // 되풀이는 모델의 고집이 아니라 **런타임이 대신 판단하고 그 사실을 숨긴 결과**였다.
    //
    // 그래서 둘을 함께 준다: ① 무엇을 얼마나 뺐는지 ② 뺀 부분을 판단할 수 있는 **집계**.
    // 437개 이름을 다 싣는 건 답이 아니다 — 이 일에 필요했던 건 이름이 아니라 분포였다.
    // 집계는 사실이지 판단이 아니다(`modifiedAt` 을 주는 것과 같은 급).
    const 전체 = result.items;
    const 줄 = (i) => `- ${i.name}${i.kind === 'folder' ? '/' : ''}${i.modifiedAt ? 시각말(i.modifiedAt) : ''}`;
    const 머리 = `자리: ${result.path}`;
    const 이름예산 = Math.floor(maxChars * 0.6); // 나머지는 "뺀 것"을 정직하게 말하는 데 쓴다
    const 실은것 = [];
    let 쓴글자 = 머리.length;
    for (const i of 전체) {
      const l = 줄(i);
      if (쓴글자 + l.length + 1 > 이름예산) break;
      실은것.push(l); 쓴글자 += l.length + 1;
    }
    if (실은것.length === 전체.length) return `${머리}\n${실은것.join('\n')}`;

    const 나머지 = 전체.slice(실은것.length);
    const 세기 = (뽑기) => {
      const m = new Map();
      for (const i of 나머지) { const k = 뽑기(i); m.set(k, (m.get(k) ?? 0) + 1); }
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const 확장자 = 세기((i) => (i.kind === 'folder' ? '폴더' : (i.name.match(/\.[^.]+$/)?.[0] ?? '(확장자 없음)').toLowerCase()));
    const 나이 = 세기((i) => {
      const ms = 지금 - Date.parse(i.modifiedAt ?? '');
      if (!Number.isFinite(ms)) return '고친 때 모름';
      const 일 = ms / 86_400_000;
      return 일 < 7 ? '7일 안' : 일 < 30 ? '30일 안' : 일 < 180 ? '180일 안' : '180일 넘음';
    });
    const 짧게 = (쌍들, n) => 쌍들.slice(0, n).map(([k, v]) => `${k} ${v}개`).join(' · ')
      + (쌍들.length > n ? ` · 그 밖 ${쌍들.slice(n).reduce((s, [, v]) => s + v, 0)}개` : '');
    return [
      머리,
      실은것.join('\n'),
      `— 여기까지가 이름을 실은 ${실은것.length}개다. **나머지 ${나머지.length}개는 이 답에 이름을 싣지 못했다**(전체 ${전체.length}개).`,
      `못 실은 ${나머지.length}개의 확장자: ${짧게(확장자, 8)}`,
      `못 실은 ${나머지.length}개의 고친 때: ${짧게(나이, 4)}`,
      '이름 하나하나가 필요하면 더 좁은 폴더를 따로 보거나, 조건에 맞는 것만 골라내는 명령을 쓴다.',
    ].join('\n');
  }

  // ③ 파일 본문 — **줄 구조를 지운 채 주지 않는다**(C 감사 F4.2). `fold` 의 `\s+` 접기는
  // 웹 본문용 규칙인데 파일 읽기 결과가 JSON 갈래로 떨어져 CSV·정산표의 행 경계가 모델
  // 입력에서 통째로 사라졌다 — 모델은 행을 근거 없이 재구성해야 했다. 줄바꿈은 남기고,
  // 넘치면 앞뒤를 남기며 접었다는 표식을 단다(모름을 사실로 전달).
  if (typeof result.text === 'string' && typeof result.path === 'string') {
    const lines = [`파일: ${result.path}`];
    if (result.modifiedAt) lines.push(`고침: ${result.modifiedAt}`); // 최신 판단의 재료(F2.3·H08)
    if (result.bytes != null) lines.push(`크기: ${result.bytes}바이트`);
    const keep = Math.max(maxChars - lines.join('\n').length - 40, 200);
    const t = String(result.text).replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    const body = t.length <= keep
      ? t
      : `${t.slice(0, Math.ceil(keep * 0.7))}\n…(가운데 ${t.length - keep}자 생략)…\n${t.slice(-(keep - Math.ceil(keep * 0.7)))}`;
    return `${lines.join('\n')}\n내용:\n${body}`;
  }

  // ④ 그 밖(작은 결과) — 통째로 주되, 넘치면 가운데를 접는다(앞부분만 남기지 않는다).
  const json = JSON.stringify(result);
  if (!json || json === '{}') return undefined;
  return fold(json, maxChars);
}

/**
 * P2-9 · 외부 표면 상태 — **무엇을 요청했고, 무엇을 읽었고, 무엇을 못 읽었는가.**
 *
 * 큰 분류 체계를 만들지 않는다(routeKind 11개·surfaceType 12개 금지 — 발화에서 예측하는 분류기는
 * 오늘 걷어낸 것과 같은 병이다). `surfaceAction` 은 **실제로 한 일**의 사후 기록 하나뿐이다.
 *
 * **못 읽은 것은 실패가 아니다.** failureState 는 그대로 'none' 이다 — 페이지는 읽었다.
 * 왜 더 못 읽었는지는 `web.collect` 의 **능력 문장**이 말한다(브라우저로 열어 버튼·탭·스크롤을
 * 다루는 손이 없다). 능력 부재를 실패로 기록하면 T5 가 "막혔다"고 말하게 되고, 그건
 * P2-8 에서 고친 것과 정면으로 충돌한다.
 */
export function surfaceOf(receipt) {
  if (receipt?.actualCall?.tool !== 'web.collect') return undefined;
  if ((receipt.failureState ?? 'none') !== 'none') return undefined; // 실패는 여기서 말하지 않는다
  const read = receipt.sources?.[0];
  if (!read?.sourceUrl) return undefined;
  const via = receipt.result?.foundVia;
  const pick = (c) => (typeof c === 'string' ? c : c?.url);
  return {
    action: receipt.result?.surfaceAction ?? (via ? 'search_then_read' : 'read_url'),
    requested: via?.query ?? receipt.actualCall?.args?.request,
    read: {
      url: read.sourceUrl,
      title: read.title || receipt.result?.title,
      chars: (receipt.result?.markdown ?? '').length, // 얼마나 읽었는지 — "보이는 만큼"의 근거
    },
    notRead: {
      // 그 사이트 안에 있는데 열지 않은 곳 = **다음에 갈 수 있는 경로**
      onPage: sameSiteLinks(read.sourceUrl, receipt.result?.links),
      // 검색이 준 다른 후보. 찾던 곳이 여기 없으면 **검색이 못 찾은 것**이지 막힌 게 아니다.
      fromSearch: (via?.candidates ?? []).map(pick).filter((u) => u && u !== read.sourceUrl).slice(0, 4),
    },
  };
}

/** 지금 시각·시간대·지역 — OS 가 아는 사실. 모델이 "오늘"을 알아야 오늘 일을 할 수 있다. */
export function nowFacts(clock = () => new Date()) {
  const d = clock();
  let timeZone; let locale;
  try {
    const opt = Intl.DateTimeFormat().resolvedOptions();
    timeZone = opt.timeZone; locale = opt.locale;
  } catch { /* 알 수 없으면 안 싣는다 — 지어내지 않는다 */ }
  let local;
  try {
    local = new Intl.DateTimeFormat('ko-KR', {
      dateStyle: 'full', timeStyle: 'short', timeZone,
    }).format(d);
  } catch { local = d.toISOString(); }
  return { iso: d.toISOString(), local, timeZone, locale };
}

/**
 * 이번 턴에 실제로 열린 연결 입력면과 직접 확인한 단서.
 *
 * 이건 특정 서비스나 도구를 분류하지 않는다. 도구가 영수증 계약으로 낸 사실을 읽을 뿐이다.
 * 입력면이 열리지 않았으면 T5 는 비밀값을 받을 통로가 없다. 그 사실이 없으면 모델은
 * "입력창에 넣어 달라"는, 실제로는 없는 길을 자연스럽게 상상한다.
 */
export function connectionAdmissionFacts(receipts = []) {
  const requests = receipts
    .map((r) => r?.surfaceRequest)
    .filter((r) => r?.kind === 'secret_input');
  const discovery = receipts
    .map((r) => r?.connectionDiscovery)
    .filter(Boolean)
    .at(-1);

  return {
    secretInput: requests.length
      ? {
          label: requests.at(-1).label,
          fields: (requests.at(-1).fields ?? []).map((f) => f.label ?? f.name).filter(Boolean),
        }
      : null,
    ...(discovery ? { discovery } : {}),
  };
}

/**
 * @param {Object} p
 * @param {import('../contracts.js').IntentPacket} p.intent
 * @param {import('../contracts.js').SelfStateSnapshot} p.selfState
 * @param {string[]} [p.admittedContext]
 * @param {Array<{role:string,text:string}>} [p.recentTurns]  같은 대화의 최근 발화(사람이 읽는 말만)
 * @param {import('../contracts.js').ActionPlan} [p.plan]
 * @param {import('../contracts.js').ToolReceipt[]} [p.receipts]
 * @returns {import('../contracts.js').TaskContextPacket}
 */
export function buildTaskContext(p) {
  const { intent, selfState } = p;
  const summary = selfStateSummary(selfState);

  // 사실만. 요청과 무관한 사실은 넣지 않는다(§11 규칙).
  const selfStateFacts = {
    model: summary.model,
    modelAuthState: summary.modelAuthState,
    // Phase 2-2 다이어트(§11 "무관한 사실을 나열하지 않는다"): 능력 **설명 문장**은 도구를 실제로
    // 쓰는 턴이나 능력을 물어본 턴에만. 인사 한 마디에 설명서를 통째로 실으면 모델이 그걸 읽고
    // 번호 목록으로 되읊는다(실측). 가벼운 턴에는 도구 **이름만** 준다 — 과장 금지는 이름만으로도 선다.
    readyTools: intent.answerMode === 'fast_chat' && !p.selfhoodDetail
      ? (summary.ready ?? [])
      : (summary.readyCapabilities ?? summary.ready),
    // 한계(무엇을 연결하면 되는지)는 그 도구가 걸리는 턴에서만 쓸모 있다. 잡담에는 소음이다.
    limits: intent.answerMode === 'fast_chat' && !p.selfhoodDetail ? [] : summary.limits,
    // 승인 필요 손은 자기 상태를 물었을 때만 상세히 준다. 평범한 대화에 권한 설명을 매번
    // 싣지 않되, 물었을 때 모델이 추측으로 위험 범위를 만들지 않게 한다.
    approvalRequired: p.selfhoodDetail ? summary.approvalRequired : [],
  };

  const authorityFacts = {
    boundary: intent.authorityBoundary,
    autoAllowed: p.plan ? p.plan.autoAllowed : [],
    needsApproval: p.plan ? p.plan.needsApproval.map((g) => g.action) : [],
    forbidden: p.plan ? p.plan.forbidden : [],
  };

  const packet = {
    // P-ID-1: 자기인지. identity 는 매 턴(짧게), selfhoodDetail 은 물어봤을 때만(문서에서 꺼낸 대목).
    identity: p.identity,
    capabilityCounts: p.capabilityCounts,
    selfhoodDetail: p.selfhoodDetail,
    currentRequest: intent.currentRequest, // 원문 보존
    // Phase 2-1: 같은 대화의 최근 발화. 이게 없으면 매 턴이 단발이라 방금 한 말을 기억하지 못하고
    // 말투도 턴마다 다시 골라진다(실측: 이름을 기억하겠다고 답한 다음 턴에 모른다고 했다).
    recentTurns: p.recentTurns ?? [],
    // 모델이 스스로 찾을 수 있는가 — 사실이므로 알려준다. 모르면 "못 한다"고 답해 버린다.
    nativeSearch: Boolean(p.nativeSearch),
    // 이번 턴에 손을 더 못 쓰는 상태. **없는 것과 다르다** — 그 차이를 안 주면 모델이
    // 빈칸을 '능력 없음'으로 메우고 사용자에게 떠넘긴다(실측 2026-07-28).
    ...(p.toolBudgetSpent ? { toolBudgetSpent: true } : {}),
    // 빈 답을 한 번 더 받는 자리는 도구 예산을 쓴 것이 아니다. 실행 사실은 그대로 두고
    // 사용자에게 보낼 최종 문장만 요구한다.
    ...(p.answerOnly ? { answerOnly: true } : {}),
    // 반대 방향의 같은 사실 — **아직 이어 쓸 수 있는 손이 남아 있다.** H08 라이브 실측
    // (2026-08-01): 손이 3걸음 남았는데 모델이 "지금 손은 다 써서"라며 일을 다음 턴과
    // 사용자에게 미뤘다. 남았다는 사실이 어디에도 없으니 빈칸을 소진으로 메운 것이다.
    ...(Number.isInteger(p.toolStepsLeft) && p.toolStepsLeft > 0 ? { toolStepsLeft: p.toolStepsLeft } : {}),
    // 어느 provider 인가 — 모델 계열별 운영 보정을 고르는 데만 쓴다(정체성은 안 바뀐다).
    modelProviderId: p.modelProviderId,
    // 막힌 것이 있을 때 다음 계단(사다리). 지시가 아니라 **지금 쓸 수 있는 길**이라는 사실이다.
    recoveryHint: p.recoveryHint,
    // 자기 파악 세 번째 축(운용 상태) — 실제 기록만. 모델 추정은 넣지 않는다(오염 방지).
    workingState: p.workingState,
    projectWorkState: p.projectWorkState,
    // 서버가 아는 실행 현실. 주소·경로·포트 같은 내부값은 싣지 않고 사용자에게 의미 있는
    // 경계만 준다. 모델이 자기 호스팅 환경을 출신 지식으로 추측하지 않게 한다.
    runtimeEnvironment: p.runtimeEnvironment,
    // **지금 언제, 어디인가.** OS 는 이걸 안다. 안 주면 모델은 "오늘"이 언제인지 몰라 되묻거나
    // 엉뚱한 날짜로 답한다(실측: "미국 기준 오늘인 7월 26일을 말씀하신 거라면…").
    // 지역도 마찬가지 — 사실이 없으니 "어느 지역이요?"를 매번 물었다. 규칙이 아니라 사실이 부족했다.
    now: p.now ?? nowFacts(),
    selfStateFacts,
    admittedContext: p.admittedContext ?? [],
    // S3 · 다른 대화에서 이어받을 수 있는 작업(§4.7). 사실 나열이며 지시가 아니다 —
    // "아까 그거"가 무엇인지는 모델이 이 사실 위에서 판단한다. 후보가 여럿이면 여럿 그대로.
    carryableWork: p.carryableWork ?? [],
    // S5-3: 직전 답이 놓고 쓴 문장들 — 정정이 무엇을 고치는지 지목할 대상.
    priorShown: p.priorShown ?? [],
    authorityFacts,
    answerMode: intent.answerMode,
    // 방법·언어는 모델에 열어둔다(§10.2). 이 문자열은 지시문이 아니라 규칙 표식이다.
    naturalness: 'method_and_language_open',
    ...(p.workContractAssessment ? { workContractAssessment: p.workContractAssessment } : {}),
  };

  // SOUL 말투 — 매 턴 고정 접두에 얹힌다(캐시에 붙는다).
  if (p.voice) packet.voice = p.voice;

  // 3축: 응답 표면(웹/텔레그램/슬랙). 방 id·정책·도구명은 싣지 않는다 — 라벨과 성질만.
  if (p.surface) packet.surface = p.surface;

  // P5-B-0.5: **외부 서비스 얘기가 나오면 지금 가능한 현실을 함께 놓는다.**
  // 금지문("복붙 시키지 마라")을 더하지 않는다 — 실측에서 그런 규칙은 안 먹혔다(§24).
  // 대신 "직접 연결은 이 상태이고, 이미 있는 손으로는 이런 게 된다"를 사실로 준다.
  // 그 사실이 없으면 모델은 없는 자리를 상상으로 메우고, 가장 쉬운 상상이 복붙 요청이다.
  // **분류기에 매달지 않는다.** 처음엔 fast_chat 턴에서 뺐는데, 오너가 든 네 시나리오 중 셋이
  // fast_chat 으로 분류됐다(실측):
  //   "너 내 노션 볼 수 있어?" · "구글에 연결하고 싶어" · "Gmail에서 견적서 찾아줘"
  // 셋 다 현실을 못 받은 채 답했고, 그래서 있는 브라우저 손을 두고 복붙을 시켰다.
  //
  // 이건 사실이 분류에 좌우된 것이다 — **말귀를 intent 분류기로 축소하지 말라**(오너 지시).
  // 이 블록은 T5 자기 손과 연결 상태에 대한 **능력 사실**이다(readyTools·limits 와 같은 급).
  // 짧게 유지하는 것으로 소음을 다루고, 실을지 말지를 분류기가 정하게 두지 않는다.
  if (p.externalReality) packet.externalReality = p.externalReality;
  // M5 연속성 ②: 같은 목록을 다시 놓을 때 **그것이 새 사실이 아니라는 사실**을 함께 놓는다.
  // 사실을 빼는 게 아니라 한 줄을 더하는 것이다(위 주석의 흉터 — 빼면 능력이 사라진다).
  if (p.externalReality && p.externalRealityDelta) packet.externalRealityDelta = p.externalRealityDelta;

  // 연결·비밀 입력은 가능한지의 문제 이전에 **실제로 열린 표면이 있는지**의 문제다.
  // 매 턴 같은 구조 사실을 싣되, 후보와 값은 영수증으로 확인된 것만 넣는다.
  if (p.externalReality || p.receipts?.length) packet.connectionAdmission = connectionAdmissionFacts(p.receipts);

  // 대화 대상이 파일·웹·외부 서비스·개발 작업 중 무엇이든 같은 운영 현실을 본다.
  // 이건 "이 도구를 써라"가 아니라, T5가 이미 사용자 대신 직접 다룰 수 있는 일을 알려 주는
  // 사실이다. 서비스별 분기나 발화 분류에 매달리면 다음 낯선 요청에서 다시 빈칸이 생긴다.
  const operating = operatorReality(selfState);
  if (operating) packet.operatorReality = operating;

  // 실행 결과가 있으면 사실로만 덧붙인다(진단면 제외 — userSafeSummary 만).
  if (p.receipts && p.receipts.length) {
    packet.evidenceFacts = p.receipts.map((r) => ({
      intended: r.intended,
      failureState: r.failureState,
      // P2-8: **주소를 직접 받아 읽은 것**과 **검색해서 찾아 읽은 것**을 구분한다.
      // 실측(2026-07-27): 모델이 "부오상회 을지로점 **네이버 플레이스**"를 요청했는데 우리가 검색해서
      // 나온 블로그를 읽고 failureState=none 으로 성공 기록했다. 모델은 플레이스를 못 받았다는 것만
      // 알고 이유를 몰라 "검색 수집이 제한돼서"라고 **추측**했다 — 우리가 안 알려줬기 때문이다.
      // 불일치 탐지기(토큰 휴리스틱)를 만들지 않는다. 그건 다음에 또 어긋난다(절대원칙 8).
      // 사실만 준다: 무엇을 찾으려 했고, 무엇을 읽었고, 안 읽은 후보가 무엇인가. 판단은 모델이 한다(§24).
      surface: surfaceOf(r),
      summary: r.userSafeSummary, // diagnosticTrace 는 절대 넣지 않는다
      // 결과의 **알맹이**도 준다. 요약만 주면 모델이 "목록을 붙여달라"고 되묻는다(실측: 파일 목록을
      // 실제로 읽어 놓고 "도구가 없어 못 본다"고 답했다). 진단면은 여전히 안 넣는다.
      data: compactResult(r.result),
      // **무엇으로 불렀는가**도 준다. 요약과 결과만 주면 모델은 자기가 보낸 인자를 다시 못 본다.
      // 그러면 "무엇을 적었는지"를 기억으로 재구성한다 — 실측(2026-07-27 라이브, 텔레그램·화면
      // 양쪽): `메모5.md` 에 실제로 쓴 목록과 T5 가 "이렇게 적었어"라며 보고한 목록이 **세 줄 다
      // 달랐다.** 원장·파일은 일치했고 답변만 갈라졌다. 짧은 값("세번째")은 우연히 맞아서 세 번을
      // 통과했고, 목록이 되자 드러났다.
      //
      // action-plan.js 는 이미 **판정과 실행이 같은 인자를 봐야 한다**고 못박았다(두 진실 금지).
      // 보고도 같은 인자를 봐야 한다. 셋 중 하나만 다른 것을 보면 원장만 진실이 되고, 사용자가
      // 읽는 답변은 그럴듯한 창작이 된다. 도구마다 결과에 실어 보내게 하면 빠뜨리는 도구가 생기므로
      // (조용한 미참여) 커널이 **모든 도구에 대해** 한 자리에서 준다.
      ...(r.failureState === 'none'
        ? { calledWith: compactResult(r.actualCall?.args) }
        : { attemptedWith: compactResult(확인되지않은인자(r.actualCall?.args)) }),
    }));
  }

  return packet;
}

function 확인되지않은인자(value) {
  if (Array.isArray(value)) return value.map(확인되지않은인자);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const pathLike = /(?:path|directory|root|cwd)$/i.test(key);
    if (pathLike && typeof item === 'string' && item.startsWith('/')) {
      return [key, '[확인되지 않은 절대 경로]'];
    }
    return [key, 확인되지않은인자(item)];
  }));
}
