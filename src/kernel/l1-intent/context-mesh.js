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
 * 승격 항목이 지금 행동에 영향을 줄 자격이 있는가(핵심 안전 게이트).
 * @param {object} entry ContextAdmissionPacket 형태
 */
export function isInfluenceEligible(entry) {
  if (!entry) return false;
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

// 이번 요청에 "관련" 있는지(좁게 입장). P6-1은 statement 단어가 요청에 걸치는지로 판정 —
// 뒷단 임베딩/모델 회수는 밀도화 단계. "많이 기억함"이 아니라 "이번 행동에 필요함".
/**
 * 이 문장이 이번 요청에 관련 있는가(좁게 입장 판정). activeGoal·기억 공통 사용.
 * @param {string} statement
 * @param {string} requestText
 */
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
const relevant = (entry, requestText) => isRelevant(entry.statement, requestText);

/**
 * 이번 턴 admitted context — 승격되어 영향 가능한 것 중, 이번 요청에 관련된 것만 좁게.
 * @param {{promoted?:object[]}} memory
 * @param {string} requestText
 * @returns {string[]} 입장된 맥락 statement (사실만)
 */
export function admittedContext(memory, requestText) {
  return (memory?.promoted ?? [])
    .filter(isInfluenceEligible)
    .filter((e) => relevant(e, requestText))
    .map((e) => e.statement);
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
 * replay 검증(운영 원리 전용). P6-1은 최소 — 과거 turn과 명시 충돌만 없으면 통과.
 * 핵심은 "replay 없이는 승격 불가"라는 게이트 자체. replay 로직은 밀도화 단계에서 깊어진다.
 * @param {object} entry
 * @param {string[]} pastStatements
 * @returns {boolean} replay 통과 여부
 */
export function runReplay(entry, pastStatements = []) {
  if (entry.kind !== 'operating_principle') return true; // preference는 replay 불요
  // 명시적 모순(같은 문장의 부정형)이 과거에 있으면 실패. 없으면 통과.
  const negated = `안 ${entry.statement}`;
  return !pastStatements.some((s) => s.includes(negated));
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
