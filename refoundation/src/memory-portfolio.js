function subjectKey(item) { return item.subjects?.[0] ? String(item.subjects[0]) : `memory:${item.memoryId}`; }
function newer(left, right) {
  const leftRevision = Number(left.subjectRevision ?? 0); const rightRevision = Number(right.subjectRevision ?? 0);
  if (leftRevision !== rightRevision) return leftRevision > rightRevision;
  return Number(left.sourceOrder ?? 0) > Number(right.sourceOrder ?? 0);
}

export function currentUserMemoryCandidates(items = []) {
  const bySubject = new Map();
  for (const item of items.filter((candidate) => candidate.kind === 'user')) {
    const key = subjectKey(item);
    const prior = bySubject.get(key);
    if (!prior || newer(item, prior)) bySubject.set(key, item);
  }
  return [...bySubject.values()];
}

export function selectMemoryPortfolio({ items = [], currentWork = null } = {}) {
  const exactWork = items.filter((item) => item.kind === 'work' && currentWork
    && item.source?.workId === currentWork.workId
    && Number(item.source?.revision ?? 0) === Number(currentWork.revision));
  const explicitUser = currentUserMemoryCandidates(items).filter((item) => item.alwaysRelevant === true);
  return [...explicitUser, ...exactWork];
}

export function memoryCandidateProjection(items = []) {
  const candidates = currentUserMemoryCandidates(items).filter((item) => item.alwaysRelevant !== true);
  if (!candidates.length) return null;
  return { role: 'assistant', content: [
    '[T5 USER MEMORY CANDIDATES — subjects and pointers only; not recalled content]',
    'Decide relevance yourself from the current user purpose. If a candidate may matter, call memory action=read with its exact memoryId. Do not infer its content from the subject.',
    ...candidates.map((item) => JSON.stringify({ memoryId: item.memoryId,
      subjects: item.subjects ?? [], subjectRevision: item.subjectRevision,
      sourceOrder: item.sourceOrder, recordedAt: item.updatedAt ?? item.createdAt ?? null })),
  ].join('\n') };
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
    sessionId: workState.works?.find((work) => work.workId === event.workId)?.sessionId ?? null,
    sourceMessageId: workState.works?.find((work) => work.workId === event.workId)?.sourceMessageId ?? null,
    recordedAt: event.recordedAt ?? null }));
}
