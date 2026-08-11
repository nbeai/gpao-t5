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

// §5-5·§7 집행(오너 결정): 저장·활성은 안 묻는다 — 단 넷이 함께 선다(출처가 오너 대화 · replay 통과 ·
//   즉시 가시 · 되돌리기 한 번). 아래 표지는 그중 "사용자 원문의 명시 지속 의도"를 판정한다.
//   모델이 지어낸 제안에는 이 표지가 **사용자 원문에** 없으므로 자동 승격 문을 지나지 못한다.
const PERSIST_INTENT = /기억해\s*[줘둬두주]|기억해\s*달라|기억해라|앞으로는|앞으로도|항상/;
// 일회성 예외 — "이번만" 류는 이 대화에서 끝난다. 다음 대화에 남기면 §5-5 위반(자동 승격 금지).
const ONE_TIME_SIGNAL = /이번만|이번 ?한 ?번|이번엔|오늘만|오늘은|지금만/;
// 민감정보 — 자동 승격 절대 금지. 사용자가 카드로 직접 확정하는 길만 남긴다(막힌 쪽이 안전한 방향).
const SENSITIVE_SIGNAL = /비밀번호|비번|암호|계좌|카드 ?번호|주민(등록)? ?번호|여권|공인인증|API ?키|토큰|시크릿/i;

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
  // §5-5: "기억해줘" 류 명시 지속 의도는 그 자체가 후보 신호다 — 위 범주 규칙이 못 알아들어도
  //   사용자가 직접 시켰다("나 커피 안 마셔. 앞으로 기억해줘"). 기본 kind는 선호.
  if (PERSIST_INTENT.test(t)) return { kind: 'preference', statement: t };
  return null;
}

/**
 * 자동 승격 자격 중 **원문에서 판정하는 몫**(§5-5 자격 일곱의 ②지속 의도 · ④민감정보 아님 · ⑤일회성 아님).
 * ①출처(오너 대화 원문)·③현재 요청 관련은 호출 자리가 보장하고(턴의 사용자 원문 그 자체를 판정한다),
 * ⑥replay 통과·⑦즉시 가시+되돌리기 한 번은 승격 실행부(서버)가 잇는다.
 * @param {string} text 사용자 원문
 * @returns {{ok:boolean, reason?:'no_persist_intent'|'one_time'|'sensitive'}}
 */
export function autoPromoteEligible(text) {
  const t = String(text ?? '').trim();
  if (!PERSIST_INTENT.test(t)) return { ok: false, reason: 'no_persist_intent' };
  if (ONE_TIME_SIGNAL.test(t)) return { ok: false, reason: 'one_time' };
  if (SENSITIVE_SIGNAL.test(t)) return { ok: false, reason: 'sensitive' };
  return { ok: true };
}

// 지속 의도·일회성 표지를 뗀 알맹이(주제 비교 전용). 저장은 언제나 원문 그대로 — 비교만 알맹이로 한다.
//   표지를 안 떼면 "기억해줘"끼리 겹쳐 모든 기억이 같은 주제로 보인다.
const INTENT_MARKERS_G = /기억해\s*[줘둬두주][가-힣]*|기억해\s*달라[가-힣]*|기억해라|앞으로[는도]?|항상|이번 ?한 ?번|이번만|이번엔|오늘만|오늘은|지금만/g;
function stripIntentMarkers(text) {
  return String(text ?? '').replace(INTENT_MARKERS_G, ' ').trim();
}

/**
 * 새 지시가 과거 기억을 이긴다(§5-5 검증 — "새 지시가 과거 기억을 이김"의 지속 상태화).
 * 같은 주제(표지 뗀 알맹이의 양방향 낱말 겹침)의 과거 승격 항목이면 새 명시 지시가 대체한다.
 * rollbackable=false(고정 원칙)는 대체하지 않는다. 겹침이 없으면 둘 다 산다(좁게).
 * @param {string} newStatement 새로 승격되는 사용자 원문
 * @param {object} oldEntry 과거 promoted 항목
 */
export function supersedes(newStatement, oldEntry) {
  if (!oldEntry || oldEntry.rollbackable === false) return false;
  const a = stripIntentMarkers(newStatement);
  const b = stripIntentMarkers(oldEntry.statement);
  return isRelevant(a, b) && isRelevant(b, a);
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
