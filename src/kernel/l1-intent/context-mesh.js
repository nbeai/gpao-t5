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
const relevant = (entry, requestText) => {
  // 검증 사례가 있으면 그것이 진실이다. 없으면(선호 기억 등) 예전 낱말 판정 그대로.
  const 사례판정 = 사례로관련(entry, requestText);
  return 사례판정 ?? isRelevant(entry.statement, requestText);
};

/**
 * 이번 턴 admitted context — 승격되어 영향 가능한 것 중, 이번 요청에 관련된 것만 좁게.
 * @param {{promoted?:object[]}} memory
 * @param {string} requestText
 * @returns {string[]} 입장된 맥락 statement (사실만)
 */
export function admittedContext(memory, requestText) {
  return admittedEntries(memory, requestText).map((e) => e.statement);
}

/**
 * 입장한 항목을 **신분과 함께** 준다(S5-1 §4.5).
 *
 * `admittedContext` 는 이걸 문장으로 얇게 감싼 것이다 — 두 함수가 따로 판정하면 언젠가
 * 다른 답을 낸다. 판정은 한 곳에만 둔다. 신분은 OS 안에서만 쓰이고 모델·사용자면에는
 * 나가지 않는다.
 */
export function admittedEntries(memory, requestText) {
  return (memory?.promoted ?? [])
    .filter(isInfluenceEligible)
    .filter((e) => relevant(e, requestText))
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
