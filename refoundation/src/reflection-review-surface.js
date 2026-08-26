import { createHash } from 'node:crypto';

const REVIEW_SCHEMA = 't5.reflection-review-surface.v1';
const DETAIL_SCHEMA = 't5.reflection-review-detail.v1';
const SOURCE_SCHEMA = 't5.reflection-review-source.v1';

const hashHandle = (kind, parts) => `${kind}_${createHash('sha256')
  .update(JSON.stringify(['t5.reflection-review.handle.v1', kind, ...parts]))
  .digest('base64url').slice(0, 22)}`;

function entryParts(entry) {
  const candidate = entry?.candidate;
  if (!candidate?.candidate || !entry?.materializationDigest || !candidate.candidateDigest) {
    throw new TypeError('persisted Reflection entry is required');
  }
  const receipt = entry.receipt ?? entry.materialization?.receipt ?? null;
  if (receipt?.schema !== 't5.reflection-materialization-receipt.v2'
    || !Array.isArray(receipt.affectedScopeHeads)
    || typeof receipt.affectedScopeDigest !== 'string'
    || !/^[a-f0-9]{64}$/u.test(receipt.affectedScopeDigest)) {
    throw new TypeError('persisted Reflection v2 scope receipt is required');
  }
  return { candidate, materialization: entry.materialization ?? null, receipt };
}

export function reflectionReviewHandle(entry) {
  const { candidate } = entryParts(entry);
  return hashHandle('review', [entry.materializationDigest, candidate.candidate.reflectionId]);
}

export function reflectionReviewRevisionHandle(entry) {
  const { candidate } = entryParts(entry);
  return hashHandle('revision', [entry.materializationDigest, candidate.candidateDigest]);
}

export function reflectionReviewSourceHandle(entry, reference) {
  entryParts(entry);
  if (!reference?.recordId) throw new TypeError('Reflection source reference is required');
  return hashHandle('source', [entry.materializationDigest, reference.recordId]);
}

function internalValues(entry) {
  const { candidate, receipt } = entryParts(entry);
  const values = new Set();
  const add = (value) => {
    if (typeof value === 'string' && value.length >= 3) values.add(value);
  };
  add(candidate.candidate.reflectionId); add(candidate.candidateDigest);
  for (const value of [
    ...(candidate.candidate.sourceEpisodeIds ?? []), ...(candidate.candidate.sourceRecordIds ?? []),
    ...(candidate.candidate.counterexampleRecordIds ?? []), ...(candidate.candidate.affectedScopes ?? []),
  ]) add(value);
  for (const episode of candidate.episodes ?? []) {
    add(episode.episodeId); add(episode.workId); add(episode.runId); add(episode.resultDigest);
    for (const ids of Object.values(episode.recordRoles ?? {})) for (const id of ids ?? []) add(id);
  }
  for (const reference of candidate.recordRefs ?? []) {
    add(reference.recordId); add(reference.sourceStore); add(reference.sourceId); add(reference.sha256);
    add(reference.scope?.sessionId); add(reference.scope?.workId); add(reference.scope?.channel);
    for (const subject of reference.scope?.subjectKeys ?? []) add(subject);
  }
  for (const head of candidate.correctionHeads ?? []) {
    add(head.memoryId); add(head.subjectKey); for (const id of head.sourceRecordIds ?? []) add(id);
  }
  for (const head of candidate.sourceFence?.forgetHeads ?? []) {
    add(head.scopeHandle); add(head.lastForgetRequestId); add(head.tombstoneDigest);
  }
  add(candidate.sourceFence?.windowDigest); add(entry.materializationDigest);
  for (const head of receipt?.counterexampleSearch?.heads ?? []) {
    for (const value of Object.values(head)) add(value);
  }
  add(receipt.affectedScopeDigest);
  for (const head of receipt.affectedScopeHeads) {
    add(head.handle); add(head.sessionId); add(head.workId); add(head.channel); add(head.headDigest);
    for (const subject of head.subjectKeys ?? []) add(subject);
  }
  return [...values].sort((left, right) => right.length - left.length);
}

function safeText(value, entry, maximum) {
  let text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, maximum);
  for (const internal of internalValues(entry)) text = text.split(internal).join('[식별 정보 숨김]');
  return text.replace(/\b[a-f0-9]{64}\b/giu, '[식별 정보 숨김]');
}

function publicStatus(state) {
  if (state === 'proposed') return { code: 'needs_review', label: '검토 필요',
    actions: { retain: true, reject: true } };
  if (state === 'reviewed') return { code: 'kept_for_review', label: '검토용으로 남김',
    actions: { retain: false, reject: true } };
  if (state === 'rejected') return { code: 'not_used', label: '사용하지 않음',
    actions: { retain: false, reject: false } };
  if (state === 'archived') return { code: 'stored_history', label: '지난 검토 기록',
    actions: { retain: false, reject: false } };
  return { code: 'separate_test_record', label: '별도 검증 기록',
    actions: { retain: false, reject: false } };
}

function sourceLabel(reference) {
  if (reference.sourceKind === 'conversation_message') return '대화에서 확인한 내용';
  if (reference.sourceKind === 'run_event') return '실행 과정에서 확인한 내용';
  if (reference.sourceKind === 'work_event') return '작업 결과에서 확인한 내용';
  if (['attachment', 'artifact', 'local_file'].includes(reference.sourceKind)) return '파일에서 확인한 내용';
  return '외부 자료에서 확인한 내용';
}

function availabilityFor(reference, receipt) {
  const item = receipt?.reopenAccountingRecords?.find((record) => record.recordId === reference.recordId);
  if (!item) return { code: 'unknown', label: '현재 확인 상태를 알 수 없음' };
  if (item.availability === 'available' && item.digestMatched === true) {
    return { code: 'available', label: '제안 생성 때 확인됨' };
  }
  if (item.availability === 'changed' || item.digestMatched === false) {
    return { code: 'changed', label: '원본이 바뀜' };
  }
  return { code: 'unavailable', label: '지금 열 수 없음' };
}

function publicSource(entry, reference) {
  const { receipt } = entryParts(entry);
  const availability = availabilityFor(reference, receipt);
  return { sourceHandle: reflectionReviewSourceHandle(entry, reference), label: sourceLabel(reference),
    availability: availability.code, availabilityLabel: availability.label,
    recordedAt: reference.recordedAt ?? null };
}

function referenceMap(candidate) {
  return new Map((candidate.recordRefs ?? []).map((reference) => [reference.recordId, reference]));
}

function assertUniqueSourceHandles(entry) {
  const { candidate } = entryParts(entry);
  const handles = (candidate.recordRefs ?? []).map((reference) => (
    reflectionReviewSourceHandle(entry, reference)
  ));
  if (new Set(handles).size !== handles.length) {
    throw new Error('Reflection review source handles must be unique');
  }
}

function sourcesFor(entry, ids, byId) {
  return [...new Set(ids ?? [])].map((id) => byId.get(id)).filter(Boolean)
    .map((reference) => publicSource(entry, reference));
}

function counts(entry) {
  const { candidate, receipt } = entryParts(entry);
  return {
    supportingExperiences: candidate.episodes?.length ?? 0,
    supportingSources: candidate.candidate.sourceRecordIds?.length ?? 0,
    counterexamples: receipt?.counterexampleSearch?.heads?.length ?? 0,
    uncertainties: candidate.unknowns?.length ?? 0,
    currentCorrections: candidate.correctionRelations?.length ?? 0,
  };
}

function notices(candidate) {
  const result = ['AI가 제안한 내용이며 아직 어떤 작업에도 적용되지 않았어요.'];
  if (candidate.taint?.externalUntrustedOrigin) {
    result.push('외부 자료가 포함돼 있어 사람의 검토 없이 사용할 수 없어요.');
  }
  return result;
}

export function projectReflectionReviewList(entries = []) {
  if (!Array.isArray(entries)) throw new TypeError('Reflection review entries must be an array');
  const reviewHandles = entries.map(reflectionReviewHandle);
  const revisionHandles = entries.map(reflectionReviewRevisionHandle);
  if (new Set(reviewHandles).size !== reviewHandles.length
    || new Set(revisionHandles).size !== revisionHandles.length) {
    throw new Error('Reflection review list handles must be unique');
  }
  return { schema: REVIEW_SCHEMA, appliedCount: 0, items: entries.map((entry) => {
    const { candidate } = entryParts(entry); const status = publicStatus(candidate.candidate.state);
    return { reviewHandle: reflectionReviewHandle(entry), revisionHandle: reflectionReviewRevisionHandle(entry),
      title: '검토할 배운 점', hypothesis: safeText(candidate.candidate.hypothesis, entry, 280),
      status: status.code, statusLabel: status.label, actions: status.actions,
      counts: counts(entry), applied: false };
  }) };
}

export function projectReflectionReviewDetail(entry) {
  assertUniqueSourceHandles(entry);
  const { candidate, receipt } = entryParts(entry); const byId = referenceMap(candidate);
  const status = publicStatus(candidate.candidate.state);
  const roleLabels = [
    ['사용자가 원한 것', 'objectiveRecordIds'], ['실제로 사용한 방법', 'methodRecordIds'],
    ['실행 결과', 'effectSettlementRecordIds'], ['완료 확인', 'completionRecordIds'],
  ];
  const support = (candidate.episodes ?? []).map((episode, index) => ({
    label: `과업 경험 ${index + 1}`,
    sourceGroups: roleLabels.map(([label, role]) => ({ label,
      sources: sourcesFor(entry, episode.recordRoles?.[role], byId) })),
  }));
  const counterexamples = (receipt?.counterexampleSearch?.heads ?? []).map((head, index) => ({
    label: `반례 ${index + 1}`, sources: sourcesFor(entry, [head.recordId], byId),
  }));
  const correctionById = new Map((candidate.correctionHeads ?? []).map((head) => [head.memoryId, head]));
  const currentCorrections = (candidate.correctionRelations ?? []).map((relation, index) => {
    const head = correctionById.get(relation.memoryId); const aligned = relation.relation === 'preserved';
    return { label: `현재 교정 ${index + 1}`, relation: aligned ? 'marked_aligned' : 'marked_conflicting',
      relationLabel: aligned ? '후보가 현재 교정과 맞는다고 표시했어요.' : '후보가 현재 교정과 충돌한다고 표시했어요.',
      sources: sourcesFor(entry, head?.sourceRecordIds, byId) };
  });
  return { schema: DETAIL_SCHEMA, reviewHandle: reflectionReviewHandle(entry),
    revisionHandle: reflectionReviewRevisionHandle(entry), title: '검토할 배운 점',
    hypothesis: safeText(candidate.candidate.hypothesis, entry, 4_000),
    status: status.code, statusLabel: status.label, actions: status.actions,
    applied: false, notices: notices(candidate), counts: counts(entry), support,
    counterexamples, uncertainties: (candidate.unknowns ?? []).map((value) => safeText(value, entry, 1_000)),
    currentCorrections };
}

function reopenedState(state) {
  if (state === 'reopened') return { code: 'available', label: '현재 원본을 확인했어요.' };
  if (state === 'changed') return { code: 'changed', label: '기록 뒤 원본이 바뀌었어요.' };
  if (state === 'missing') return { code: 'missing', label: '원본을 찾을 수 없어요.' };
  if (state === 'permission_denied') return { code: 'permission_denied', label: '현재 권한으로 열 수 없어요.' };
  if (state === 'unknown') return { code: 'unknown', label: '현재 원본 상태를 알 수 없어요.' };
  return { code: 'unavailable', label: '지금 원본을 열 수 없어요.' };
}

export function projectReflectionReviewSource(entry, { sourceHandle, reopened } = {}) {
  assertUniqueSourceHandles(entry);
  const { candidate } = entryParts(entry); const reference = (candidate.recordRefs ?? [])
    .find((item) => reflectionReviewSourceHandle(entry, item) === sourceHandle);
  if (!reference) throw new Error('Reflection review source handle is not available');
  if (!reopened || typeof reopened !== 'object' || Array.isArray(reopened)
    || !['reopened', 'changed', 'missing', 'permission_denied', 'unknown', 'unavailable']
      .includes(reopened.state)) {
    throw new TypeError('sanitized reopened source state is required');
  }
  const allowedFields = new Set(['state', 'content', 'recordedAt']);
  if (Object.keys(reopened).some((field) => !allowedFields.has(field))) {
    throw new TypeError('sanitized reopened source has an unknown field');
  }
  if (reopened.recordedAt != null) {
    const parsed = new Date(reopened.recordedAt);
    if (typeof reopened.recordedAt !== 'string' || !Number.isFinite(parsed.getTime())
      || parsed.toISOString() !== reopened.recordedAt) {
      throw new TypeError('sanitized reopened source time is invalid');
    }
  }
  const state = reopenedState(reopened.state);
  return { schema: SOURCE_SCHEMA, reviewHandle: reflectionReviewHandle(entry),
    revisionHandle: reflectionReviewRevisionHandle(entry), sourceHandle,
    label: sourceLabel(reference), state: state.code, stateLabel: state.label,
    recordedAt: reopened.recordedAt ?? reference.recordedAt ?? null,
    content: reopened.state === 'reopened' ? safeText(reopened.content, entry, 8_000) : null };
}
