function canonicalTime(value, label) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be canonical UTC time`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be canonical UTC time`);
  }
  return value;
}

function portableSource(source) {
  return {
    recordId: source.recordId,
    sourceKind: source.sourceKind,
    sourceStore: source.sourceStore,
    ...(source.sourceKind === 'local_file' ? {} : { sourceId: source.sourceId }),
    sourceRevision: source.sourceRevision,
    sha256: source.sha256,
    occurredAt: source.occurredAt,
    recordedAt: source.recordedAt,
    scope: source.scope,
    trust: source.trust,
    sensitivity: source.sensitivity,
    coverage: source.coverage,
    availability: source.availability,
  };
}

export function exportMemoryBundle({ state, exportedAt } = {}) {
  if (!state || !Array.isArray(state.claims) || !Array.isArray(state.tombstones)) {
    throw new TypeError('memory export requires current MemoryLedger state');
  }
  return {
    schema: 't5.memory-portable.v1',
    exportedAt: canonicalTime(exportedAt, 'exportedAt'),
    canonical: 'existing MemoryLedger events remain authoritative',
    claims: state.claims.map((claim) => ({
      memoryId: claim.memoryId, kind: claim.kind, subjectKey: claim.subjectKey,
      ...(claim.sensitivity === 'never_store' ? {} : { value: claim.value }),
      scope: claim.scope,
      sources: claim.sources.map(portableSource),
      recordedAt: claim.recordedAt, validFrom: claim.validFrom, validTo: claim.validTo,
      subjectRevision: claim.subjectRevision, sourceOrder: claim.sourceOrder,
      status: claim.status, supersedes: claim.supersedes, conflictsWith: claim.conflictsWith,
      sensitivity: claim.sensitivity, alwaysRelevant: claim.alwaysRelevant,
    })),
    tombstones: state.tombstones.map((item) => ({
      requestId: item.requestId, memoryId: item.memoryId, subjectKey: item.subjectKey,
      targetRevision: item.targetRevision, reversibleUntil: item.reversibleUntil,
    })),
  };
}
