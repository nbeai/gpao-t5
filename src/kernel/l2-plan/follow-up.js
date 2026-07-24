// L2 · FollowUpEvent (§8) — 긴 작업 중 들어온 새 지시를 놓치지 않는다.
// "현재 요청 우선" 원칙으로 처리한다.

/**
 * @param {Object} p
 * @param {string} p.runningTask
 * @param {string} p.incomingInput
 * @param {boolean} [p.conflict]   현재 목표와 새 지시의 충돌 여부
 * @returns {import('../contracts.js').FollowUpEvent}
 */
export function decideFollowUp(p) {
  const conflict = Boolean(p.conflict);
  // 충돌하면 현재 작업을 안전 저장하고 새 지시로 전환(interrupt).
  // 충돌 없으면 현재 작업에 병합(merge). 둘 다 사용자에게 한 줄 알린다.
  const decision = conflict ? 'interrupt' : 'merge';
  const userNotice = conflict
    ? `"${p.runningTask}" 은 여기까지 저장해 두고 새 요청부터 할게요.`
    : `"${p.runningTask}" 에 이어서 반영할게요.`;
  return {
    runningTask: p.runningTask,
    incomingInput: p.incomingInput,
    conflict,
    decision,
    // Phase 5.1(§8.1): 후보 유형 계약 자리. P5는 호출자가 명시할 때만 채우고 기본 none.
    candidateKind: p.candidateKind ?? 'none',
    userNotice,
  };
}
