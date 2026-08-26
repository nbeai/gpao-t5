import { createHash } from 'node:crypto';

import { validateRecordReference } from './record-reference.js';

const INPUT_FIELDS = new Set([
  'reflectionId', 'hypothesis', 'sourceEpisodeIds', 'sourceRecordIds',
  'counterexampleRecordIds', 'affectedScopes', 'createdBy', 'episodes',
  'recordRefs', 'correctionHeads', 'correctionRelations',
  'forgetHeads', 'counterexampleSearch', 'unknowns',
]);
const EPISODE_FIELDS = new Set([
  'episodeId', 'workId', 'workRevision', 'runId', 'resultDigest', 'outcome',
  'recordRoles',
]);
const ROLE_FIELDS = new Set([
  'objectiveRecordIds', 'methodRecordIds', 'effectSettlementRecordIds',
  'completionRecordIds',
]);
const CORRECTION_HEAD_FIELDS = new Set([
  'memoryId', 'subjectKey', 'subjectRevision', 'sourceOrder', 'status',
  'sourceRecordIds',
]);
const CORRECTION_RELATION_FIELDS = new Set(['memoryId', 'relation']);
const FORGET_HEAD_FIELDS = new Set([
  'scopeHandle', 'epoch', 'lastForgetRequestId', 'tombstoneDigest',
]);
const COUNTEREXAMPLE_SEARCH_FIELDS = new Set(['state', 'recordIds', 'sourceWindowDigest']);
const CANDIDATE_FIELDS = new Set([
  'reflectionId', 'hypothesis', 'sourceEpisodeIds', 'sourceRecordIds',
  'counterexampleRecordIds', 'affectedScopes', 'state', 'createdBy',
  'userConfirmed',
]);
const ENVELOPE_FIELDS = new Set([
  'schema', 'candidate', 'episodes', 'recordRefs', 'correctionHeads',
  'correctionRelations', 'counterexampleSearch', 'unknowns', 'taint',
  'sourceFence', 'projection', 'stateHistory', 'candidateDigest',
]);
const STATE_HISTORY_FIELDS = new Set(['from', 'to', 'sourceWindowDigest']);
const TRANSITIONS = new Map([
  ['proposed', new Set(['reviewed', 'rejected', 'archived'])],
  ['reviewed', new Set(['tested', 'rejected', 'archived'])],
  ['tested', new Set(['archived'])],
  ['rejected', new Set()],
  ['archived', new Set()],
]);
const TRUSTED_GROUNDING = new Set(['user_asserted', 'runtime_observed', 'verified_external']);
const SENSITIVITY_ORDER = new Map([
  ['normal', 0], ['personal', 1], ['private', 2], ['secret_ref', 3], ['never_store', 4],
]);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function exact(value, fields, label) {
  object(value, label);
  for (const field of Object.keys(value)) {
    if (!fields.has(field)) throw new TypeError(`${label} has unknown field: ${field}`);
  }
  for (const field of fields) {
    if (!(field in value)) throw new TypeError(`${label}.${field} is required`);
  }
}

function text(value, label, max = 256) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > max
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} must be bounded non-empty text`);
  }
  return value;
}

function digestText(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value;
}

function optionalText(value, label, max = 256) {
  return value === null ? null : text(value, label, max);
}

function optionalDigest(value, label) {
  return value === null ? null : digestText(value, label);
}

function identifiers(value, label, { minimum = 0, maximum = 128 } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const result = value.map((item) => text(item, `${label} item`, 256));
  if (new Set(result).size !== result.length) throw new TypeError(`${label} must be unique`);
  return result.toSorted();
}

function strings(value, label, maximum = 32) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const result = value.map((item) => text(item, `${label} item`, 1_000));
  if (new Set(result).size !== result.length) throw new TypeError(`${label} must be unique`);
  return result.toSorted();
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function normalizeRoles(input) {
  exact(input, ROLE_FIELDS, 'ReflectionEpisodeEvidence.recordRoles');
  return {
    objectiveRecordIds: identifiers(input.objectiveRecordIds,
      'ReflectionEpisodeEvidence.recordRoles.objectiveRecordIds', { minimum: 1 }),
    methodRecordIds: identifiers(input.methodRecordIds,
      'ReflectionEpisodeEvidence.recordRoles.methodRecordIds', { minimum: 1 }),
    effectSettlementRecordIds: identifiers(input.effectSettlementRecordIds,
      'ReflectionEpisodeEvidence.recordRoles.effectSettlementRecordIds', { minimum: 1 }),
    completionRecordIds: identifiers(input.completionRecordIds,
      'ReflectionEpisodeEvidence.recordRoles.completionRecordIds', { minimum: 1 }),
  };
}

function normalizeEpisode(input) {
  exact(input, EPISODE_FIELDS, 'ReflectionEpisodeEvidence');
  if (input.outcome !== 'achieved') {
    throw new TypeError('ReflectionEpisodeEvidence must come from achieved Work');
  }
  return {
    episodeId: text(input.episodeId, 'ReflectionEpisodeEvidence.episodeId'),
    workId: text(input.workId, 'ReflectionEpisodeEvidence.workId'),
    workRevision: positiveInteger(input.workRevision, 'ReflectionEpisodeEvidence.workRevision'),
    runId: text(input.runId, 'ReflectionEpisodeEvidence.runId'),
    resultDigest: digestText(input.resultDigest, 'ReflectionEpisodeEvidence.resultDigest'),
    outcome: 'achieved',
    recordRoles: normalizeRoles(input.recordRoles),
  };
}

function normalizeCorrectionHead(input) {
  exact(input, CORRECTION_HEAD_FIELDS, 'ReflectionCorrectionHead');
  if (!['active', 'disputed'].includes(input.status)) {
    throw new TypeError('ReflectionCorrectionHead.status is not supported');
  }
  return {
    memoryId: text(input.memoryId, 'ReflectionCorrectionHead.memoryId'),
    subjectKey: text(input.subjectKey, 'ReflectionCorrectionHead.subjectKey'),
    subjectRevision: positiveInteger(input.subjectRevision, 'ReflectionCorrectionHead.subjectRevision'),
    sourceOrder: positiveInteger(input.sourceOrder, 'ReflectionCorrectionHead.sourceOrder'),
    status: input.status,
    sourceRecordIds: identifiers(input.sourceRecordIds,
      'ReflectionCorrectionHead.sourceRecordIds', { minimum: 1 }),
  };
}

function normalizeCorrectionRelation(input) {
  exact(input, CORRECTION_RELATION_FIELDS, 'ReflectionCorrectionRelation');
  if (!['preserved', 'conflicts'].includes(input.relation)) {
    throw new TypeError('ReflectionCorrectionRelation.relation is not supported');
  }
  return {
    memoryId: text(input.memoryId, 'ReflectionCorrectionRelation.memoryId'),
    relation: input.relation,
  };
}

function normalizeForgetHead(input) {
  exact(input, FORGET_HEAD_FIELDS, 'ReflectionForgetHead');
  return {
    scopeHandle: text(input.scopeHandle, 'ReflectionForgetHead.scopeHandle'),
    epoch: nonNegativeInteger(input.epoch, 'ReflectionForgetHead.epoch'),
    lastForgetRequestId: optionalText(input.lastForgetRequestId,
      'ReflectionForgetHead.lastForgetRequestId'),
    tombstoneDigest: optionalDigest(input.tombstoneDigest,
      'ReflectionForgetHead.tombstoneDigest'),
  };
}

function normalizeCounterexampleSearch(input, expectedRecordIds) {
  exact(input, COUNTEREXAMPLE_SEARCH_FIELDS, 'ReflectionCounterexampleSearch');
  if (!['not_run', 'found', 'none_found', 'failed'].includes(input.state)) {
    throw new TypeError('ReflectionCounterexampleSearch.state is not supported');
  }
  const recordIds = identifiers(input.recordIds, 'ReflectionCounterexampleSearch.recordIds');
  if (JSON.stringify(recordIds) !== JSON.stringify(expectedRecordIds)) {
    throw new TypeError('counterexample search does not match candidate counterexamples');
  }
  if (input.state === 'found' && recordIds.length === 0) {
    throw new TypeError('found counterexample search requires an exact record');
  }
  if (input.state !== 'found' && recordIds.length > 0) {
    throw new TypeError('only a found counterexample search may contain records');
  }
  const sourceWindowDigest = input.sourceWindowDigest === null ? null
    : digestText(input.sourceWindowDigest, 'ReflectionCounterexampleSearch.sourceWindowDigest');
  if (input.state === 'not_run' && sourceWindowDigest !== null) {
    throw new TypeError('an unrun counterexample search cannot have a source window');
  }
  if (input.state !== 'not_run' && sourceWindowDigest === null) {
    throw new TypeError('a completed counterexample search requires a source window');
  }
  return { state: input.state, recordIds, sourceWindowDigest };
}

function assertRecordKinds(episodes, recordById) {
  const expected = {
    objectiveRecordIds: {
      kinds: new Set(['conversation_message', 'work_event']),
      trust: new Set(['user_asserted', 'runtime_observed', 'verified_external']),
    },
    methodRecordIds: { kinds: new Set(['run_event']), trust: new Set(['runtime_observed']) },
    effectSettlementRecordIds: { kinds: new Set(['run_event']), trust: new Set(['runtime_observed']) },
    completionRecordIds: { kinds: new Set(['work_event']), trust: new Set(['runtime_observed']) },
  };
  const used = new Set();
  for (const episode of episodes) {
    for (const [role, recordIds] of Object.entries(episode.recordRoles)) {
      for (const recordId of recordIds) {
        const record = recordById.get(recordId);
        if (!record || !expected[role].kinds.has(record.sourceKind)
          || !expected[role].trust.has(record.trust)) {
          throw new TypeError(`Reflection Episode ${role} lacks exact source genealogy`);
        }
        if (used.has(recordId)) {
          throw new TypeError('Reflection Episode genealogy roles require distinct RecordRefs');
        }
        used.add(recordId);
      }
    }
  }
}

function normalizeFenceParts({ affectedScopeHandles, episodes, recordRefs, correctionHeads, forgetHeads }) {
  return {
    affectedScopeHandles: identifiers(affectedScopeHandles, 'affectedScopeHandles', { minimum: 1 }),
    episodeHeads: episodes.map((episode) => ({
      episodeId: episode.episodeId,
      workId: episode.workId,
      workRevision: episode.workRevision,
      runId: episode.runId,
      resultDigest: episode.resultDigest,
    })).toSorted((left, right) => left.episodeId.localeCompare(right.episodeId)),
    recordHeads: recordRefs.map((record) => ({
      recordId: record.recordId,
      sourceKind: record.sourceKind,
      sourceStore: record.sourceStore,
      sourceId: record.sourceId,
      sourceRevision: record.sourceRevision,
      sha256: record.sha256,
      occurredAt: record.occurredAt,
      recordedAt: record.recordedAt,
      scope: structuredClone(record.scope),
      trust: record.trust,
      sensitivity: record.sensitivity,
      coverage: record.coverage,
      availability: record.availability,
    })).toSorted((left, right) => left.recordId.localeCompare(right.recordId)),
    correctionHeads: correctionHeads.map((head) => structuredClone(head))
      .toSorted((left, right) => left.memoryId.localeCompare(right.memoryId)),
    forgetHeads: forgetHeads.map((head) => structuredClone(head))
      .toSorted((left, right) => left.scopeHandle.localeCompare(right.scopeHandle)),
  };
}

export function calculateReflectionSourceFence({ affectedScopeHandles, episodes, recordRefs,
  correctionHeads, forgetHeads } = {}) {
  if (!Array.isArray(episodes) || !Array.isArray(recordRefs) || !Array.isArray(correctionHeads)
    || !Array.isArray(forgetHeads)) {
    throw new TypeError('Reflection source fence inputs must be arrays');
  }
  const normalizedEpisodes = episodes.map(normalizeEpisode);
  const normalizedRecords = recordRefs.map(validateRecordReference);
  const normalizedCorrections = correctionHeads.map(normalizeCorrectionHead);
  const normalizedForgetHeads = forgetHeads.map(normalizeForgetHead);
  if (new Set(normalizedEpisodes.map((item) => item.episodeId)).size !== normalizedEpisodes.length
    || new Set(normalizedEpisodes.map((item) => item.workId)).size !== normalizedEpisodes.length
    || new Set(normalizedEpisodes.map((item) => item.runId)).size !== normalizedEpisodes.length
    || new Set(normalizedRecords.map((item) => item.recordId)).size !== normalizedRecords.length
    || new Set(normalizedCorrections.map((item) => item.memoryId)).size !== normalizedCorrections.length) {
    throw new TypeError('Reflection source fence identities must be unique and distinct');
  }
  const recordById = new Map(normalizedRecords.map((record) => [record.recordId, record]));
  assertRecordKinds(normalizedEpisodes, recordById);
  for (const correction of normalizedCorrections) {
    if (correction.sourceRecordIds.some((recordId) => !recordById.has(recordId))) {
      throw new TypeError('Reflection source fence correction RecordRef is unresolved');
    }
  }
  const scopes = identifiers(affectedScopeHandles, 'affectedScopeHandles', { minimum: 1 });
  if (new Set(normalizedForgetHeads.map((head) => head.scopeHandle)).size !== normalizedForgetHeads.length
    || JSON.stringify(normalizedForgetHeads.map((head) => head.scopeHandle).toSorted())
      !== JSON.stringify(scopes)) {
    throw new TypeError('every affected scope needs exactly one forget head');
  }
  const parts = normalizeFenceParts({ affectedScopeHandles, episodes: normalizedEpisodes,
    recordRefs: normalizedRecords, correctionHeads: normalizedCorrections,
    forgetHeads: normalizedForgetHeads });
  return { ...parts, windowDigest: hash(parts) };
}

function digestEnvelope(envelope) {
  const { candidateDigest: ignored, ...body } = envelope;
  return hash(body);
}

export function makeReflectionCandidateEnvelope(input = {}) {
  exact(input, INPUT_FIELDS, 'ReflectionCandidateInput');
  const reflectionId = text(input.reflectionId, 'reflectionId');
  const hypothesis = text(input.hypothesis, 'hypothesis', 4_000);
  const sourceEpisodeIds = identifiers(input.sourceEpisodeIds, 'sourceEpisodeIds', { minimum: 2 });
  const sourceRecordIds = identifiers(input.sourceRecordIds, 'sourceRecordIds', { minimum: 1 });
  const counterexampleRecordIds = identifiers(input.counterexampleRecordIds, 'counterexampleRecordIds');
  const affectedScopes = identifiers(input.affectedScopes, 'affectedScopes', { minimum: 1, maximum: 32 });
  if (!['main_model', 'background_reviewer'].includes(input.createdBy)) {
    throw new TypeError('createdBy is not supported');
  }

  const episodes = input.episodes.map(normalizeEpisode)
    .toSorted((left, right) => left.episodeId.localeCompare(right.episodeId));
  if (episodes.length < 2 || new Set(episodes.map((item) => item.episodeId)).size !== episodes.length
    || new Set(episodes.map((item) => item.workId)).size !== episodes.length
    || new Set(episodes.map((item) => item.runId)).size !== episodes.length) {
    throw new TypeError('Reflection requires distinct achieved Episode Work and Run sources');
  }
  if (JSON.stringify(episodes.map((item) => item.episodeId).toSorted())
    !== JSON.stringify(sourceEpisodeIds)) {
    throw new TypeError('sourceEpisodeIds do not match exact Episode evidence');
  }

  const recordRefs = input.recordRefs.map(validateRecordReference)
    .toSorted((left, right) => left.recordId.localeCompare(right.recordId));
  if (new Set(recordRefs.map((record) => record.recordId)).size !== recordRefs.length) {
    throw new TypeError('Reflection RecordRefs must be unique');
  }
  if (recordRefs.some((record) => record.availability !== 'available')) {
    throw new TypeError('Reflection source must be exactly available');
  }
  if (recordRefs.some((record) => ['secret_ref', 'never_store'].includes(record.sensitivity))) {
    throw new TypeError('secret_ref and never_store Reflection sources are not open');
  }
  const recordById = new Map(recordRefs.map((record) => [record.recordId, record]));
  const supportSet = new Set(sourceRecordIds);
  const counterexampleSet = new Set(counterexampleRecordIds);
  if ([...supportSet].some((recordId) => counterexampleSet.has(recordId))) {
    throw new TypeError('support and counterexample RecordRefs must be disjoint');
  }
  for (const recordId of [...supportSet, ...counterexampleSet]) {
    if (!recordById.has(recordId)) throw new TypeError('Reflection source RecordRef is unresolved');
  }
  for (const episode of episodes) {
    for (const recordIds of Object.values(episode.recordRoles)) {
      if (recordIds.some((recordId) => !supportSet.has(recordId))) {
        throw new TypeError('Episode genealogy must be part of supporting source RecordRefs');
      }
    }
  }
  assertRecordKinds(episodes, recordById);
  if (![...supportSet].some((recordId) => TRUSTED_GROUNDING.has(recordById.get(recordId).trust))) {
    throw new TypeError('Reflection cannot rely only on model inference or untrusted external content');
  }

  const correctionHeads = input.correctionHeads.map(normalizeCorrectionHead)
    .toSorted((left, right) => left.memoryId.localeCompare(right.memoryId));
  if (new Set(correctionHeads.map((head) => head.memoryId)).size !== correctionHeads.length) {
    throw new TypeError('Reflection correction heads must be unique');
  }
  for (const head of correctionHeads) {
    if (head.sourceRecordIds.some((recordId) => !recordById.has(recordId))) {
      throw new TypeError('Reflection correction source RecordRef is unresolved');
    }
  }
  const usedRecordIds = new Set([...sourceRecordIds, ...counterexampleRecordIds,
    ...correctionHeads.flatMap((head) => head.sourceRecordIds)]);
  if (usedRecordIds.size !== recordRefs.length
    || recordRefs.some((record) => !usedRecordIds.has(record.recordId))) {
    throw new TypeError('Reflection envelope cannot contain unused or missing RecordRefs');
  }
  const correctionRelations = input.correctionRelations.map(normalizeCorrectionRelation)
    .toSorted((left, right) => left.memoryId.localeCompare(right.memoryId));
  if (new Set(correctionRelations.map((item) => item.memoryId)).size !== correctionRelations.length
    || JSON.stringify(correctionRelations.map((item) => item.memoryId))
      !== JSON.stringify(correctionHeads.map((item) => item.memoryId))) {
    throw new TypeError('every current correction needs exactly one Reflection relation');
  }

  const forgetHeads = input.forgetHeads.map(normalizeForgetHead)
    .toSorted((left, right) => left.scopeHandle.localeCompare(right.scopeHandle));
  if (new Set(forgetHeads.map((head) => head.scopeHandle)).size !== forgetHeads.length
    || JSON.stringify(forgetHeads.map((head) => head.scopeHandle)) !== JSON.stringify(affectedScopes)) {
    throw new TypeError('every affected scope needs exactly one forget head');
  }

  const sourceFence = calculateReflectionSourceFence({ affectedScopeHandles: affectedScopes,
    episodes, recordRefs, correctionHeads, forgetHeads });
  const counterexampleSearch = normalizeCounterexampleSearch(input.counterexampleSearch,
    counterexampleRecordIds);
  if (counterexampleSearch.sourceWindowDigest !== null
    && counterexampleSearch.sourceWindowDigest !== sourceFence.windowDigest) {
    throw new TypeError('counterexample search was performed against a stale source window');
  }
  const unknowns = strings(input.unknowns, 'unknowns');
  const sourceTrusts = [...new Set(recordRefs.map((record) => record.trust))].toSorted();
  const sensitivityFloor = recordRefs.reduce((floor, record) => (
    SENSITIVITY_ORDER.get(record.sensitivity) > SENSITIVITY_ORDER.get(floor)
      ? record.sensitivity : floor
  ), 'normal');
  const candidate = {
    reflectionId, hypothesis, sourceEpisodeIds, sourceRecordIds,
    counterexampleRecordIds, affectedScopes, state: 'proposed',
    createdBy: input.createdBy, userConfirmed: false,
  };
  const envelope = {
    schema: 't5.reflection-candidate.v1', candidate, episodes, recordRefs,
    correctionHeads, correctionRelations, counterexampleSearch, unknowns,
    taint: { sourceTrusts, derivedByModel: true,
      externalUntrustedOrigin: sourceTrusts.includes('external_untrusted'),
      sensitivityFloor },
    sourceFence, projection: 'none', stateHistory: [{ from: null, to: 'proposed',
      sourceWindowDigest: sourceFence.windowDigest }], candidateDigest: '',
  };
  envelope.candidateDigest = digestEnvelope(envelope);
  return structuredClone(envelope);
}

function validateStateHistory(history, candidateState, sourceWindowDigest) {
  if (!Array.isArray(history) || history.length === 0 || history.length > 16) {
    throw new TypeError('Reflection state history must be a bounded non-empty array');
  }
  let previous = null;
  for (const [index, item] of history.entries()) {
    exact(item, STATE_HISTORY_FIELDS, 'ReflectionStateTransition');
    if (item.from !== previous || !TRANSITIONS.has(item.to)) {
      throw new TypeError('Reflection state history is not contiguous');
    }
    digestText(item.sourceWindowDigest, 'ReflectionStateTransition.sourceWindowDigest');
    if (item.sourceWindowDigest !== sourceWindowDigest) {
      throw new TypeError('Reflection state history source fence changed');
    }
    if (index === 0) {
      if (item.from !== null || item.to !== 'proposed') {
        throw new TypeError('Reflection state history must begin at proposed');
      }
    } else if (!TRANSITIONS.get(item.from)?.has(item.to)) {
      throw new TypeError('Reflection state history contains a closed transition');
    }
    previous = item.to;
  }
  if (previous !== candidateState) {
    throw new TypeError('Reflection candidate state does not match its transition history');
  }
}

export function validateReflectionCandidateEnvelope(input) {
  exact(input, ENVELOPE_FIELDS, 'ReflectionCandidateEnvelope');
  exact(input.candidate, CANDIDATE_FIELDS, 'ReflectionCandidate');
  digestText(input.candidateDigest, 'candidateDigest');
  if (digestEnvelope(input) !== input.candidateDigest) {
    throw new TypeError('Reflection candidate digest does not match its exact envelope');
  }
  if (input.schema !== 't5.reflection-candidate.v1' || input.projection !== 'none'
    || !TRANSITIONS.has(input.candidate.state) || input.candidate.userConfirmed !== false) {
    throw new TypeError('Reflection candidate envelope is invalid');
  }
  validateStateHistory(input.stateHistory, input.candidate.state, input.sourceFence?.windowDigest);
  const rebuilt = makeReflectionCandidateEnvelope({
    reflectionId: input.candidate.reflectionId,
    hypothesis: input.candidate.hypothesis,
    sourceEpisodeIds: input.candidate.sourceEpisodeIds,
    sourceRecordIds: input.candidate.sourceRecordIds,
    counterexampleRecordIds: input.candidate.counterexampleRecordIds,
    affectedScopes: input.candidate.affectedScopes,
    createdBy: input.candidate.createdBy,
    episodes: input.episodes,
    recordRefs: input.recordRefs,
    correctionHeads: input.correctionHeads,
    correctionRelations: input.correctionRelations,
    forgetHeads: input.sourceFence?.forgetHeads,
    counterexampleSearch: input.counterexampleSearch,
    unknowns: input.unknowns,
  });
  rebuilt.candidate.state = input.candidate.state;
  rebuilt.stateHistory = structuredClone(input.stateHistory);
  rebuilt.candidateDigest = digestEnvelope(rebuilt);
  if (JSON.stringify(rebuilt) !== JSON.stringify(input)) {
    throw new TypeError('Reflection candidate envelope does not match closed derived fields');
  }
  return structuredClone(input);
}

export function transitionReflectionCandidate(input, { to, currentEvidence = null } = {}) {
  const envelope = validateReflectionCandidateEnvelope(input);
  if (!TRANSITIONS.get(envelope.candidate.state).has(to)) {
    throw new TypeError(`Reflection transition ${envelope.candidate.state}->${String(to)} is not allowed`);
  }
  if (['reviewed', 'tested'].includes(to)) {
    object(currentEvidence, 'currentEvidence');
    const currentFence = calculateReflectionSourceFence({
      affectedScopeHandles: currentEvidence.affectedScopeHandles,
      episodes: currentEvidence.episodes,
      recordRefs: currentEvidence.recordRefs,
      correctionHeads: currentEvidence.correctionHeads,
      forgetHeads: currentEvidence.forgetHeads,
    });
    if (currentFence.windowDigest !== envelope.sourceFence.windowDigest) {
      const error = new Error('Reflection publication source window is stale');
      error.code = 'reflection_stale_source_window';
      throw error;
    }
  }
  if (to === 'tested') {
    if (envelope.counterexampleSearch.state !== 'found'
      || envelope.correctionRelations.some((item) => item.relation === 'conflicts')) {
      throw new TypeError('tested Reflection requires a counterexample and preserved current corrections');
    }
  }
  envelope.candidate.state = to;
  envelope.stateHistory.push({ from: input.candidate.state, to,
    sourceWindowDigest: envelope.sourceFence.windowDigest });
  envelope.candidateDigest = digestEnvelope(envelope);
  return structuredClone(envelope);
}
