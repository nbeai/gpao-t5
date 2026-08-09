// L1 · Context Mesh / T-cell — ContextAdmissionPacket 처리(§5). P6-1 최소 슬라이스.
// 핵심 안전 불변식(헌법 §3-2, 계획서 §5.3):
//   - 기억 승격은 admission→replay→approval 흐름. 라우터가 raw 기억을 쓰지 않는다.
//   - operating_principle 은 replayPassed && userConfirmed 전에는 행동에 영향 0.
//   - preference 는 userConfirmed 전에는 행동에 영향 0.
//   - 승격 전 후보는 어떤 영향도 없다. 승격된 것도 "이번 요청에 관련"될 때만 좁게 입장.
//   - T-cell(operating_principle)과 preference는 kind로 분리해 섞이지 않는다.

// 후보 감지 신호(범주 — 특정 대화 전용 규칙이 아니라 일반 언어 범주). 모델이 뒷단에서 정교화한다.
// 운영원리 = T5 행동을 규율하는 규칙(확인/금지 의미). 선호 = 사용자가 좋아하는 방식.
// 주의: '받'(수신)은 선호에도 흔하므로 원리 신호에서 제외한다.
import { bestShapeOverlap, bestShapeMatch, SHAPE_SIMILARITY } from '../l0-evidence/text-shape.js';
import { 사실공급 } from '../model-sovereign.js';
const PRINCIPLE_SIGNAL = /무조건|반드시.*확인|절대.*(마|말|하지)|(할|보낼|전송할|올릴) ?땐|전에.*확인|확인받/;
const PREFERENCE_SIGNAL = /(좋아|선호|받고 싶|줬으면|앞으로.*(로|으로|기본)|항상.*(로|으로) 받|글로 받|표로 받)/;

/**
 * 사용자 발화에서 기억 승격 후보를 감지한다(자동 승격 아님 — 후보만).
 * @param {string} text
 * @returns {{kind:'preference'|'operating_principle', statement:string}|null}
 */
export function detectCandidate(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  // 운영 원리가 선호보다 강한 신호 — 먼저 검사.
  if (PRINCIPLE_SIGNAL.test(t)) return { kind: 'operating_principle', statement: t };
  if (PREFERENCE_SIGNAL.test(t)) return { kind: 'preference', statement: t };
  return null;
}

/**
 * 지금 물러나 있는가 — 내려간 것(OS 판단)이든 치워 둔 것(사용자 판단)이든.
 *
 * 둘 다 **삭제가 아니라 표식**이라 되돌리면 그대로 돌아온다. 이 판정이 여기 한 곳에만
 * 사는 이유는, 영향 게이트와 사용자 표면이 각자 재면 언젠가 **같은 항목을 두고 다르게
 * 말하기** 때문이다 — 화면은 "반영 중"이라는데 실제로는 들지 않는 상태가 그것이다.
 */
export const 물러남 = (entry) => Number.isFinite(entry?.decayedAt) || Number.isFinite(entry?.archivedAt);

/**
 * 승격 항목이 지금 행동에 영향을 줄 자격이 있는가(핵심 안전 게이트).
 * @param {object} entry ContextAdmissionPacket 형태
 */
export function isInfluenceEligible(entry) {
  if (!entry) return false;
  if (물러남(entry)) return false;
  // 추정된 성향(inferred_trait, P6-17 Slice-3)은 **관찰 전용 — 어떤 경우에도 영향 0**. tier·userConfirmed와
  //   독립된 불변식(안전 바닥과 같은 방어적 이중화). 레인이 뚫려도(promoted에 잘못 들어가도) 여기서 막힌다.
  if (entry.kind === 'inferred_trait') return false;
  if (entry.kind === 'operating_principle') {
    // T-cell: replay 통과 + 사용자 승인 전에는 절대 영향 금지.
    return entry.replayPassed === true && entry.userConfirmed === true;
  }
  // preference: 사용자 승인 후 영향.
  return entry.userConfirmed === true;
}

// 이번 요청에 "관련" 있는지(좁게 입장). 검증 사례가 있으면 그걸로, 없으면 낱말로 —
// 뒷단 임베딩/모델 회수는 밀도화 단계. "많이 기억함"이 아니라 "이번 행동에 필요함".
/**
 * 이 문장이 이번 요청에 관련 있는가(좁게 입장 판정). activeGoal·기억 공통 사용.
 * @param {string} statement
 * @param {string} requestText
 */
/**
 * 검증된 원리의 입장 판정 — **낱말이 아니라 suite 가 검증한 사례로 본다.**
 *
 * 라이브에서 막혔던 자리다: 원리를 좁힐수록 문장이 길고 구체적이 되는데, 낱말 겹침으로 재면
 * 축약된 실제 발화(`12월 것도. 1800 / 1100 / …`)와 안 겹쳐 **입장 자체를 못 했다.** 그렇다고
 * 낱말 판정을 느슨하게 풀면 과잉 적용이 열린다.
 *
 * 그래서 이미 있는 사실을 쓴다. 그 원리는 **어떤 상황에서 통과했고 어떤 상황에서 떨어졌는지**
 * suite 가 검증했다 — positive·boundary 사례는 적용되는 상황, negative 사례는 적용하면 안 되는
 * 상황이다. 지금 발화가 앞엣것과 같은 모양이고 뒤엣것과 덜 닮았을 때만 보인다.
 *
 * 두 쪽 다 걸리면 **적용하면 안 되는 쪽**을 따른다 — 잘못 든 원리가 안 든 원리보다 나쁘다.
 * 판단 자체는 여전히 모델의 것이다. 여기서 정하는 것은 "무엇을 모델 앞에 놓을지"뿐이다.
 */
function 사례로관련(entry, requestText) {
  const s = entry?.scopeSignals;
  if (!s?.appliesWhen?.length) return null; // 검증 사례가 없으면 이 판정을 쓰지 않는다
  const 적용 = bestShapeMatch(requestText, s.appliesWhen);
  // 같은 종류의 말인가(겹침) **그리고** 그 본보기를 실제로 덮는가 — 짧고 흔한 말이 우연히
  // 걸리는 것을 덮음이 막는다.
  if (적용.overlap < SHAPE_SIMILARITY || 적용.coverage < SHAPE_SIMILARITY) return false;
  // 검증된 비적용 상황에 더 가까우면 들지 않는다 — 잘못 든 원리가 안 든 원리보다 나쁘다.
  //
  // 여기에 "여유(margin)"를 두어 아슬아슬한 것까지 막아 볼까 했는데, 실측한 어떤 발화에서도
  // 판정이 달라지지 않았다. 일하지 않는 장치는 두지 않는다.
  //
  // 사용자가 같은 요청에 **명시적으로 다른 형식**을 덧붙이면(`…근데 표 대신 문장 요약으로 줘`)
  // 원리는 그대로 든다. 감추지 않는 것이 맞다 — 모델이 현재 지시와 함께 보고 판단할 일이지,
  // Runtime 이 대신 지워 줄 일이 아니다(그건 모델 판단을 규칙으로 대체하는 것이다).
  const 비적용 = bestShapeOverlap(requestText, s.notWhen ?? []);
  return 비적용 < 적용.overlap;
}

export function isRelevant(statement, requestText) {
  const req = String(requestText ?? '');
  const words = String(statement ?? '').split(/\s+/).filter((w) => w.length >= 2);
  return words.some((w) => {
    if (req.includes(w)) return true;
    // 조사 근사 제거: 마지막 글자를 떼고도 비교(보고서는→보고서).
    const stem = w.length > 2 ? w.slice(0, -1) : w;
    return stem.length >= 2 && req.includes(stem);
  });
}

// ── 목표 입장 판정 v2 의 문법 재료 ──────────────────────────────────────────────
//
// 아래 셋은 **문구 목록이 아니라 닫힌 문법 부류**다(조사·지시사·의존명사·보조용언 활용).
// 한국어에서 이 부류들은 새 원소가 생기지 않는다 — "경쟁사"·"정산" 같은 열린 어휘(명사)를
// 나열하는 것과는 종류가 다른 사실이고, 그 구분이 이 설계의 허리다. 열린 어휘 사전은
// 여기 만들지 않는다(감사 계약: 낱말 목록 나열식 금지는 열린 부류에 대한 금지다).

/** 조사(체언 뒤 문법 표지). 낱말 끝에서 한 번 벗긴다 — 남는 어간이 2음절 미만이면 벗기지
 *  않는다("회의→회" 같은 훼손 방지. "값과↔값을"이 안 붙는 값은 치르고 문서화한다). */
const 조사꼬리 = /(이라도|까지|부터|에서|으로|라도|처럼|만큼|보다|은|는|이|가|을|를|의|에|와|과|랑|도|만|로)$/;

/** 서술어 활용꼴 — 하다(경동사)·주다(수혜 보조용언)·되다·보다 활용과 그 요청 어미.
 *  요청문의 서술어("정리해서 알려줘")는 "어떻게 해달라"이지 "무엇에 대해"가 아니므로
 *  대상 판정의 증거에서 뺀다. 외자 "해"는 3음절 이상에서만 본다("동해" 같은 지명 보호). */
const 서술어꼴 = (w) => /(해서|해요|해라|해봐|해줘|하자|하고|하죠|할까|할래|할게|합니다|했다|했어요?|줘요?|줄래|줄게|주세요|주라|다오|달라|돼요?|됐다|됐어요?|된다|보자|볼까)$/.test(w)
  || (w.length >= 3 && /해$/.test(w));

/** 지시·이음 표지 — 앞 담화를 가리키는 닫힌 부류: 그-지시사("그것/그거/그건/그걸/그게"),
 *  의존명사 '것/거'+보조사 '도'("것도" — "이번 주 **것도**"의 그 자리), 보조사 '마저'.
 *  낱말 단위로만 본다("증거도"의 '-거도' 같은 우연 일치를 막는다). */
const 이음표지낱말 = (w) => /^(그것|그거|그건|그걸|그게)/.test(w) || w === '것도' || w === '거도' || w === '마저';

/** 닫힌 부류 낱말(대상이 될 수 없는 것): 의존명사·지시사·기능부사·접속사. */
const 닫힌부류 = (w) => /^(것|거|수|데|좀|더|다시|또|계속|마저|그리고|그럼|그래서|근데|이런|그런|저런|이것|이거|저것|저거)$/.test(w)
  || /^(그것|그거|그건|그걸|그게)/.test(w);

/** 발화의 **내용어**(대상 후보) 어간 나열 — 서술어·닫힌 부류를 빼고 조사를 벗긴, 순서 보존. */
const 내용어들 = (text) => {
  const out = [];
  for (const raw of String(text ?? '').split(/\s+/)) {
    const w = raw.replace(/[^\p{L}\p{N}]+/gu, '');
    if (!w || 닫힌부류(w) || 서술어꼴(w)) continue;
    const 벗김 = w.replace(조사꼬리, '');
    const 어간 = 벗김.length >= 2 ? 벗김 : w;
    if (어간.length >= 2) out.push(어간);
  }
  return out;
};

/**
 * **목표 입장 판정 v2** — "관련"을 낱말 겹침이 아니라 두 개의 구조 사실로 잰다.
 *
 * v1(7322dad · "마지막 낱말이 같으면 부탁 형태를 빼고 재판정")은 12턴형 병은 잡았지만
 * PM 반례 3건으로 일반화 부족이 실증됐다(2026-08-09):
 *   - 오판: "지금까지 내용을 … 말해줘" ↔ "방금 바뀐 내용을 정리해줘" — 마지막 낱말이
 *     다르면 서술어("정리해서")와 일반어("내용")까지 겹침 증거로 섰다.
 *   - 누락: "그것도 알려줘"·"이번 주 것도 알려줘" — 생략된 이어 부름은 대상 낱말이 발화에
 *     **없는 것이 정상**인데, 낱말 겹침은 그걸 무관으로 읽었다.
 * 병의 뿌리는 "낱말이 겹치는가"라는 질문 자체다. v2 는 질문을 둘로 바꾼다:
 *
 * ① **생략된 이어 부름인가** — 발화 쪽 신호로 본다. 지시·이음 표지(그것/~것도/마저 — 닫힌 문법
 *    부류)가 있거나 내용어가 아예 없으면(부탁 형태뿐이면) 발화가 스스로 대상을 세우지
 *    못한다는 문법 사실이고, 직전 목표가 그 생략을 푸는 유일한 근거다 → 싣는다.
 *    (공급은 fail-open — 무엇을 뜻하는지는 모델이 목표를 **보고** 판단한다. 안 실으면
 *    모델은 판단할 재료 자체가 없다.)
 * ② **같은 대상을 불렀는가** — 내용어(서술어·조사·닫힌 부류를 뺀 어간)끼리만 대조한다.
 *    같은 어간이 있어도 양쪽 다 **서로 다른 수식**을 받고 있으면 다른 대상이다:
 *    "행사 내용"과 "계약서 내용"은 같은 명사(내용)를 다른 대상에 씌운 것이고, 그걸 같다고
 *    읽는 것이 "일반어 겹침" 병의 정체다. 한국어 수식은 앞에서 오므로 바로 앞 내용어가
 *    그 수식이다. 어느 한쪽이라도 수식 없이(문두 등) 그 어간을 세웠으면 같은 대상으로
 *    본다 — "경쟁사 뉴스 조사" ↔ "조사 결과 더 자세히"가 이어지는 관통 조건.
 *
 * `bestShapeMatch`(글자 모양 겹침·덮음) 재사용을 먼저 검토했고 쓰지 않는다 — 실측:
 * 반례 쌍("…내용을 정리해서 말해줘"↔"…내용을 정리해줘")의 모양 겹침이 0.71 로 문턱(0.45)을
 * 훌쩍 넘는다. 모양 비교는 일반어·서술어의 글자가 그대로 증거가 되어 이 병을 **못 가른다**
 * (그 판정의 자리는 축약 반복 감지지 대상 동일성이 아니다). 판정은 여전히 값싼 사실 비교이고
 * 모델을 부르지 않는다 — 여기서 정하는 것은 "무엇을 모델 앞에 놓을지"뿐이다.
 */
export function isGoalRelevant(goalStatement, requestText) {
  const 발화낱말 = String(requestText ?? '').split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]+/gu, ''));
  // ① 생략된 이어 부름 — 발화 쪽 신호(표지 또는 내용어 0)면 목표가 해석 근거로 실린다.
  if (발화낱말.some(이음표지낱말)) return true;
  const 발화내용어 = 내용어들(requestText);
  if (!발화내용어.length) return true;
  // ② 대상 대조 — 내용어끼리만. 목표에 대상이 없으면 잴 것이 없다(안 싣는다).
  const 목표내용어 = 내용어들(goalStatement);
  if (!목표내용어.length) return false;
  for (let i = 0; i < 발화내용어.length; i += 1) {
    const j = 목표내용어.indexOf(발화내용어[i]);
    if (j < 0) continue;
    const 발화수식 = i > 0 ? 발화내용어[i - 1] : null;
    const 목표수식 = j > 0 ? 목표내용어[j - 1] : null;
    // 양쪽 다 수식을 받는데 그 수식이 갈리면 같은 명사라도 다른 대상이다.
    if (발화수식 && 목표수식 && 발화수식 !== 목표수식) continue;
    return true;
  }
  return false;
}
const relevant = (entry, requestText, env) => {
  // 검증 사례가 있으면 그것이 진실이다 — 원칙은 **검증된 본보기**로 범위가 정해진다.
  const 사례판정 = 사례로관련(entry, requestText);
  if (사례판정 != null) return 사례판정;
  // ── **범위를 모르는 원칙은 낱말로 짐작하지 않는다**(S7 ③ · F-18 두 번째 자리) ──────
  //
  // 검증 사례가 없는 원칙을 발화 낱말 겹침으로 들었다. 그건 **모르는 범위를 글자로 짐작**하는
  // 것이다. 이 파일이 이미 적어 뒀다: *"잘못 든 원리가 안 든 원리보다 나쁘다."*
  // 모르면 안 드는 것이 맞고, 그 판정에는 발화가 필요 없다.
  // (선호는 아래에서 늘 든다 — 사용자에 대한 **사실**은 범위를 물을 것이 없다.)
  if (사실공급(env) && entry?.kind === 'operating_principle') return false;
  // ── **사용자에 대한 사실은 발화로 거르지 않는다**(F-18 · 2026-08-05) ──────────
  //
  // 예전엔 여기서도 낱말 겹침(`isRelevant`)을 봤다. 그래서 `"내가 뭘 마시는지 알아?"` 에
  // `"홍차를 마신다"` 가 **안 실렸다** — 겹치는 낱말이 없기 때문이다. 기억은 저장돼 있는데
  // 모델은 못 받고 "몰라"라고 답한다. **분류기가 사실 공급 여부를 정하고 있었다.**
  //
  // 선호는 사용자에 대한 **사실**이다. 무엇을 물었느냐에 따라 참이 되었다 거짓이 되지 않는다.
  // 검증된 사례로 범위가 정해진 **원칙**과는 성질이 다르다 — 그건 위에서 이미 갈렸다.
  //
  // 부수 효과 하나가 더 있다: 기억 블록이 발화마다 달라지지 않으므로 **프롬프트 접두가 산다**
  // (불변식 A). 예전 필터는 사실을 막으면서 캐시도 함께 깨고 있었다.
  // 사용자 사실(user_fact)도 같은 성질이다 — "내가 뭘 마시는지 알아?"가 어느 낱말로 오든
  // 저장된 사실은 실려 있어야 답할 수 있다(④ · 2026-08-09 user_fact 종류 신설).
  if (entry?.kind === 'preference' || entry?.kind === 'user_fact') return true;
  return isRelevant(entry.statement, requestText);
};

/**
 * 이번 턴 admitted context — 승격되어 영향 가능한 것 중, 이번 요청에 관련된 것만 좁게.
 * @param {{promoted?:object[]}} memory
 * @param {string} requestText
 * @returns {string[]} 입장된 맥락 statement (사실만)
 */
export function admittedContext(memory, requestText, env) {
  return admittedEntries(memory, requestText, env).map((e) => e.statement);
}

/**
 * 입장한 항목을 **신분과 함께** 준다(S5-1 §4.5).
 *
 * `admittedContext` 는 이걸 문장으로 얇게 감싼 것이다 — 두 함수가 따로 판정하면 언젠가
 * 다른 답을 낸다. 판정은 한 곳에만 둔다. 신분은 OS 안에서만 쓰이고 모델·사용자면에는
 * 나가지 않는다.
 */
/**
 * **선호를 몇 개까지 실을 것인가.** 발화로 거르지 않기로 한 이상(F-18) 개수는 묶어야 한다 —
 * 안 묶으면 기억이 늘수록 프롬프트가 조용히 커진다(불변식 B · 좁은 허리).
 * 축은 **발화와 무관**해야 한다(착수 조건 ②) — 그래야 대화 안에서 흔들리지 않고 접두가 산다.
 * 넘치면 최근 것을 남긴다: 사용자가 방금 고친 것이 지금의 진실이다.
 */
const 선호상한 = 30;

export function admittedEntries(memory, requestText, env) {
  const 실릴것 = (memory?.promoted ?? [])
    .filter(isInfluenceEligible)
    .filter((e) => relevant(e, requestText, env));
  const 선호 = 실릴것.filter((e) => e?.kind === 'preference' || e?.kind === 'user_fact'); // 상한은 한 묶음(무한 성장 금지)
  const 넘친것 = 선호.length > 선호상한 ? new Set(선호.slice(0, 선호.length - 선호상한)) : null;
  return 실릴것
    .filter((e) => !넘친것?.has(e))
    .map((e) => ({
      ref: e.candidateId ?? e.principleId ?? null,
      kind: e.kind,
      statement: e.statement,
      // 중복 억제 판정용 저장 근거 — 이 항목이 태어난 사용자 발화 원문(있을 때만).
      sourceQuote: e.evidence?.utteranceQuote ?? null,
    }));
}

/**
 * 채널 중복 제거(§5-K 제한의 구조 봉합): 같은 선호가 **대화 이력과 기억 블록에 중복 공급**
 * 되면 모델이 저장 채널을 구속 규칙으로 승격해 현재 명시 요청을 눌렀다(§5-J·§5-K 실측 —
 * 활성 2/6 vs 이력 단독 6/6). 원천 발화가 이번에 실제로 보내는 이력에 이미 있으면 기억
 * 블록으로 다시 넣지 않는다.
 *
 * 판정은 **저장 근거(utteranceQuote)와 이력 사용자 발화의 정확 동일성**뿐이다 — 낱말 규칙·
 * 의미 유사도·부분 일치 없음. 근거가 없는 항목은 억제하지 않는다(공급 쪽 fail-open: 기억이
 * 일을 안 하는 것이 중복 억제 오판보다 더 자주 틀리는 방향이다 — 새 대화 공급은 정상 유지).
 * @param {Array<{sourceQuote?:string|null}>} entries
 * @param {Array<{role:string, text:string}>} recentTurns 이번 모델 입력에 실제로 실리는 이력
 */
export function dropHistoryDuplicates(entries, recentTurns) {
  const 이력원문 = new Set((recentTurns ?? [])
    .filter((t) => t?.role === 'user')
    .map((t) => String(t.text ?? '').trim()));
  return (entries ?? []).filter((e) => {
    const 원천 = String(e?.sourceQuote ?? '').trim();
    return !원천 || !이력원문.has(원천);
  });
}

/**
 * 후보 ContextAdmissionPacket 생성(admitted=false, 승격 전 영향 0).
 * @param {string} candidateId
 * @param {'preference'|'operating_principle'} kind
 * @param {string} statement
 */
export function makeCandidate(candidateId, kind, statement) {
  return {
    candidateId,
    kind,
    statement,
    admitted: false,
    replayPassed: false,
    userConfirmed: false,
    rollbackable: true,
  };
}

/**
 * 사용자가 **지금 말로 선언한 선호**를 확인 카드 없이 반영한 항목.
 *
 * 왜 카드가 없나: 봉인 실측에서 그 카드가 지킨 실제 위험은 0 이었다(H01 3/3 카드1·클릭1).
 * 가역 로컬 기억은 승인이 아니라 되돌리기로 지킨다 — 안전은 마찰이 아니라 복구로 만든다.
 * 저장 내용은 **사용자 원문 인용 그 자체**다(계획 §4.2). 요약·확장 문장은 이 통로로 오지
 * 못한다 — 인용과 내용이 갈릴 자유도 자체를 없앤다.
 * @param {string} entryId
 * @param {string} statement 사용자 원문 조각 그대로
 * @param {{utteranceQuote:string, speechAct:string}} evidence
 */
export function makeAutoReversible(entryId, statement, evidence) {
  return {
    candidateId: entryId,
    kind: 'preference',
    tier: 'auto_reversible',
    statement,
    evidence,
    admitted: true,
    userConfirmed: true, // 선언 자체가 확인이다 — 별도 클릭을 요구하지 않는다
    replayPassed: true,  // preference 는 replay 불요(기존 계약)
    rollbackable: true,
    influenceScope: '관련된 이후 대화',
    reviewLevel: 'auto_reversible',
  };
}

/**
 * replay 검증(운영 원리 전용). P6-1은 최소 — 과거 turn과 명시 충돌만 없으면 통과.
 * 핵심은 "replay 없이는 승격 불가"라는 게이트 자체. replay 로직은 밀도화 단계에서 깊어진다.
 * @param {object} entry
 * @param {string[]} pastStatements
 * @returns {boolean} replay 통과 여부
 */
export function runReplay(entry, pastStatements = [], suiteReport = null) {
  if (entry.kind !== 'operating_principle') return true; // preference는 replay 불요
  // S4(§4.4): 실질 replay 는 **실행 증거가 결합된 suite 판정**이다. 보고서가 있으면 그것이
  // 진실이고, 문자열 검사로 그것을 덮지 않는다. 보고서가 없으면 통과가 아니다 —
  // "표본 없음은 통과가 아니다"(계획). 예전의 부정형 검사는 그 아래의 얕은 방어로만 남는다.
  if (suiteReport) return suiteReport.pass === true;
  return false;
}

/** 옛 얕은 검사(부정형 충돌). suite 가 없을 때 사람이 확인 통로로 쓰던 경로에서만 참고한다. */
export function contradictsPast(entry, pastStatements = []) {
  const negated = `안 ${entry.statement}`;
  return pastStatements.some((s) => s.includes(negated));
}

/**
 * **후보 승격의 단일 통로** (H 감사 보강 2026-07-29). 승격 통로가 둘이면 replay·원장·필드가
 * 한쪽에만 붙는 날 다시 갈라진다 — 모든 확인 엔드포인트는 이 함수 하나에 위임한다.
 * memory 를 제자리에서 바꾼다(candidates→promoted). 저장·영수증은 부르는 쪽 몫.
 * @param {{candidates?:object[], promoted?:object[]}} memory
 * @param {string} candidateId
 * @returns {{ok:boolean, entry?:object, reason?:string}}
 */
export function confirmCandidate(memory, candidateId) {
  const idx = (memory.candidates ?? []).findIndex((e) => e.candidateId === candidateId);
  if (idx < 0) return { ok: false, reason: 'not_found' };
  const entry = memory.candidates[idx];
  let replayPassed = entry.kind !== 'operating_principle';
  if (entry.kind === 'operating_principle') {
    const past = [...(memory.promoted ?? []), ...memory.candidates.filter((e) => e !== entry)].map((e) => e.statement);
    // 과거와 명시적으로 충돌하면 suite 를 볼 것도 없다.
    if (contradictsPast(entry, past)) return { ok: false, reason: 'replay_failed' };
    // S4: 그 원리에 붙은 suite 보고서로만 통과한다. 사람이 확인 버튼을 눌러도 실행 증거 없이는
    // 원리가 행동에 들어가지 않는다(§4.4 "표본 없음·판정 불가는 통과가 아니다").
    // 다만 **아직 검증 전**과 **검증에서 떨어짐**은 다른 사실이다 — 사용자에게 같은 말을 하면
    // "왜 안 되는지"를 알 수 없다.
    if (!entry.replayReport) return { ok: false, reason: 'replay_pending' };
    replayPassed = runReplay(entry, past, entry.replayReport);
    if (!replayPassed) return { ok: false, reason: 'replay_failed' };
  }
  const r = promote(entry, { userConfirmed: true, replayPassed });
  if (!r.ok) return { ok: false, reason: r.reason };
  memory.candidates.splice(idx, 1);
  memory.promoted = [...(memory.promoted ?? []), r.entry];
  return { ok: true, entry: r.entry };
}

/**
 * 승격 — 게이트를 코드로 강제한다. operating_principle은 replayPassed 없이 승격 불가.
 * @param {object} entry
 * @param {{userConfirmed?:boolean, replayPassed?:boolean}} approval
 * @returns {{ok:boolean, reason?:string, entry?:object}}
 */
export function promote(entry, approval = {}) {
  if (!approval.userConfirmed) return { ok: false, reason: 'needs_user_confirm' };
  if (entry.kind === 'operating_principle' && approval.replayPassed !== true) {
    return { ok: false, reason: 'needs_replay' };
  }
  const isPrin = entry.kind === 'operating_principle';
  return {
    ok: true,
    entry: {
      ...entry,
      admitted: true,
      userConfirmed: true,
      replayPassed: isPrin ? true : entry.replayPassed,
      // 정직화(감사 보정): P6-1 replay는 최소(명시 모순만 검사). 강하게 "검토 완료"라 하지 않는다.
      reviewLevel: isPrin ? 'basic' : undefined,
      influenceScope: '관련된 이후 대화',
    },
  };
}
