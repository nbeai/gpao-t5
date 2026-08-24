function tokens(value) { return new Set(String(value ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []); }
function tokenMatches(left, right) {
  if (left === right) return true;
  if (left.length < 2 || right.length < 2) return false;
  return left.startsWith(right) || right.startsWith(left)
    || left.slice(0, 2) === right.slice(0, 2);
}
function relevant(item, request) {
  const subjects = item.subjects?.length ? item.subjects : [item.content];
  const wanted = tokens(request); if (!wanted.size) return false;
  return subjects.some((subject) => [...tokens(subject)].some((token) => (
    [...wanted].some((wantedToken) => tokenMatches(token, wantedToken))
  )));
}

export function selectMemoryPortfolio({ items = [], request = '', currentWork = null } = {}) {
  const current = items.filter((item) => {
    if (item.kind === 'work') return currentWork && item.source?.workId === currentWork.workId
      && Number(item.source?.revision ?? 0) === Number(currentWork.revision);
    return item.kind === 'user' && (item.alwaysRelevant === true || relevant(item, request));
  });
  const bySubject = new Map();
  for (const item of current) {
    const key = item.subjects?.[0] ?? item.memoryId;
    const prior = bySubject.get(key);
    if (!prior || Number(item.source?.revision ?? 0) >= Number(prior.source?.revision ?? 0)) bySubject.set(key, item);
  }
  return [...bySubject.values()];
}

export function workingMemoryProjection(workState, workId) {
  const work = workState?.works?.find((item) => item.workId === workId);
  if (!work || work.status !== 'active') return null;
  return { workId: work.workId, revision: work.revision, status: work.status,
    pendingInputIds: (workState.inputs ?? []).filter((item) => item.workId === workId
      && item.state !== 'executed').map((item) => item.inputId) };
}

export function episodePointers(workState = {}) {
  const settlements = (workState.events ?? []).filter((event) => event.type === 'work_settled');
  return settlements.map((event) => ({ workId: event.workId, revision: event.revision,
    outcome: event.outcome, runId: event.runId,
    sourceMessageId: workState.works?.find((work) => work.workId === event.workId)?.sourceMessageId ?? null }));
}
