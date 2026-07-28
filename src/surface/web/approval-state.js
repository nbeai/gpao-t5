/**
 * 현재 결과인지와 승인이 살아 있는지는 서로 다른 사실이다.
 *
 * activePendingIds가 있으면 서버의 목록이 단일 진실이다. 목록이 없는 직접 렌더 경로만
 * historical 여부로 폴백한다.
 */
export function approvalIsActive(pendingId, activePendingIds, historical = false) {
  if (Array.isArray(activePendingIds)) return activePendingIds.includes(pendingId);
  return historical !== true;
}

/** 마지막 결과만 현재 표면으로 두되, 승인 활성 목록은 모든 결과에 전달한다. */
export function projectionOptions(index, lastAssistantIndex, activePendingIds) {
  return {
    historical: index !== lastAssistantIndex,
    activePendingIds,
  };
}
