import { createHash } from 'node:crypto';

import {
  projectConversationRecordReference,
  projectRunRecordReference,
  projectWorkRecordReference,
} from './record-projection.js';
import { validateRecordReference } from './record-reference.js';
import {
  calculateReflectionSourceFence,
  makeReflectionCandidateEnvelope,
  validateReflectionCandidateEnvelope,
} from './reflection-candidate.js';

const TOP_FIELDS = new Set([
  'meaningProposal', 'episodeAllowlist', 'runtimeSnapshot', 'recordSourceReader',
  'reflectionId', 'createdBy', 'observedAt',
]);
const PROPOSAL_FIELDS = new Set([
  'action', 'hypothesis', 'sourceEpisodeHandles', 'affectedScopeHandles',
  'correctionRelations', 'counterexampleHandles', 'unknowns',
]);
const EPISODE_HANDLE_FIELDS = new Set(['handle', 'workId', 'revision', 'runId']);
const SNAPSHOT_FIELDS = new Set([
  'workState', 'runs', 'conversations', 'affectedScopes', 'currentCorrections',
  'forgetHeads', 'counterexampleSearch',
]);
const SCOPE_FIELDS = new Set([
  'handle', 'sessionId', 'workId', 'subjectKeys', 'channel',
]);
const CURRENT_CORRECTION_FIELDS = new Set([
  'handle', 'appliesToScopeHandles', 'head', 'recordRefs',
]);
const PROPOSAL_CORRECTION_FIELDS = new Set(['correctionHandle', 'relation']);
const COUNTEREXAMPLE_SEARCH_FIELDS = new Set([
  'state', 'queryDigest', 'sourceWindowDigest', 'resultCount', 'resultDigest',
  'receiptDigest', 'results',
]);
const COUNTEREXAMPLE_RESULT_FIELDS = new Set([
  'handle', 'episodeId', 'workId', 'runId', 'recordRef',
]);
const CONFIRMED_DELIVERY = new Set(['persisted', 'sent', 'succeeded', 'not_requested']);
const META_TOOLS = new Set(['work_completion', 'learning_trial', 'tool_search']);
const MATERIALIZATION_FIELDS = new Set([
  'schema', 'envelope', 'receipt', 'materializationDigest',
]);
const RECEIPT_FIELDS = new Set([
  'schema', 'runtimeSnapshotDigest', 'reopenAccountingRecords',
  'reopenAccountingDigest', 'counterexampleSearch', 'correctionDigest',
  'forgetDigest', 'episodeDigest', 'candidateDigest', 'sourceFenceDigest',
]);
const RECEIPT_COUNTEREXAMPLE_FIELDS = new Set([
  'state', 'queryDigest', 'sourceWindowDigest', 'resultCount', 'resultDigest',
  'receiptDigest', 'heads',
]);
const RECEIPT_COUNTEREXAMPLE_HEAD_FIELDS = new Set([
  'handle', 'episodeId', 'workId', 'runId', 'recordId', 'sourceRevision', 'sha256',
]);
const ACCOUNTING_FIELDS = new Set([
  'schema', 'recordId', 'sourceKind', 'sourceStore', 'availability', 'coverage',
  'digestMatched', 'observedSha256', 'bytesRead', 'durationNs',
]);
const FRESH_MATERIALIZATIONS = new WeakSet();

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

function canonicalTime(value, label) {
  if (typeof value !== 'string' || new Date(value).toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical UTC timestamp`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return value;
}

function uniqueTexts(value, label, { minimum = 0, maximum = 128 } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const result = value.map((item) => text(item, `${label} item`, 1_000));
  if (new Set(result).size !== result.length) throw new TypeError(`${label} must be unique`);
  return result;
}

function mapUnique(items, key, label) {
  const result = new Map();
  for (const item of items) {
    const identity = item[key];
    if (result.has(identity)) throw new TypeError(`${label} identities must be unique`);
    result.set(identity, item);
  }
  return result;
}

function sameSet(left, right) {
  return left.length === right.length
    && [...left].toSorted().every((item, index) => item === [...right].toSorted()[index]);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function digestText(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function normalizeEpisodeHandle(input) {
  exact(input, EPISODE_HANDLE_FIELDS, 'ReflectionEpisodeHandle');
  return {
    handle: text(input.handle, 'ReflectionEpisodeHandle.handle'),
    workId: text(input.workId, 'ReflectionEpisodeHandle.workId'),
    revision: positiveInteger(input.revision, 'ReflectionEpisodeHandle.revision'),
    runId: text(input.runId, 'ReflectionEpisodeHandle.runId'),
  };
}

function normalizeScope(input) {
  exact(input, SCOPE_FIELDS, 'ReflectionAffectedScope');
  return {
    handle: text(input.handle, 'ReflectionAffectedScope.handle'),
    sessionId: input.sessionId === null ? null : text(input.sessionId, 'ReflectionAffectedScope.sessionId'),
    workId: input.workId === null ? null : text(input.workId, 'ReflectionAffectedScope.workId'),
    subjectKeys: uniqueTexts(input.subjectKeys, 'ReflectionAffectedScope.subjectKeys', { maximum: 32 }),
    channel: input.channel === null ? null : text(input.channel, 'ReflectionAffectedScope.channel', 128),
  };
}

function normalizeProposal(input) {
  exact(input, PROPOSAL_FIELDS, 'ReflectionMeaningProposal');
  if (input.action !== 'propose') throw new TypeError('ReflectionMeaningProposal.action must be propose');
  const relations = input.correctionRelations.map((item) => {
    exact(item, PROPOSAL_CORRECTION_FIELDS, 'ReflectionMeaningProposal.correctionRelation');
    if (!['preserved', 'conflicts'].includes(item.relation)) {
      throw new TypeError('ReflectionMeaningProposal correction relation is not supported');
    }
    return { correctionHandle: text(item.correctionHandle, 'correctionHandle'), relation: item.relation };
  });
  mapUnique(relations, 'correctionHandle', 'Reflection correction relation');
  return {
    action: 'propose',
    hypothesis: text(input.hypothesis, 'ReflectionMeaningProposal.hypothesis', 4_000),
    sourceEpisodeHandles: uniqueTexts(input.sourceEpisodeHandles, 'sourceEpisodeHandles', { minimum: 2 }),
    affectedScopeHandles: uniqueTexts(input.affectedScopeHandles, 'affectedScopeHandles', { minimum: 1, maximum: 32 }),
    correctionRelations: relations,
    counterexampleHandles: uniqueTexts(input.counterexampleHandles, 'counterexampleHandles'),
    unknowns: uniqueTexts(input.unknowns, 'unknowns', { maximum: 32 }),
  };
}

function scopeForEpisode(scopes, work, pointer) {
  const matches = scopes.filter((scope) => (
    (scope.workId === null || scope.workId === pointer.workId)
    && (scope.sessionId === null || scope.sessionId === work.sessionId)
  ));
  const subjectKeys = [...new Set(matches.flatMap((scope) => scope.subjectKeys))].toSorted();
  const channels = [...new Set(matches.map((scope) => scope.channel).filter(Boolean))];
  return { subjectKeys, channel: channels.length === 1 ? channels[0] : null };
}

async function reopenExact(reader, reference, expected, label) {
  if (reference.sha256 === null) {
    const error = new Error(`${label} lacks an exact source digest`);
    error.code = 'reflection_source_unavailable';
    throw error;
  }
  const reopened = await reader.reopen(reference, expected);
  if (reopened?.state !== 'reopened' || !reopened.source
    || reopened.accounting?.availability !== 'available'
    || reopened.accounting?.recordId !== reference.recordId
    || reopened.accounting?.observedSha256 !== reference.sha256
    || reopened.accounting?.digestMatched !== true) {
    const error = new Error(`${label} is unavailable, changed, or unknown`);
    error.code = 'reflection_source_unavailable';
    throw error;
  }
  return { source: reopened.source, accounting: {
    schema: reopened.accounting.schema,
    recordId: reopened.accounting.recordId,
    sourceKind: reopened.accounting.sourceKind,
    sourceStore: reopened.accounting.sourceStore,
    availability: reopened.accounting.availability,
    coverage: reopened.accounting.coverage,
    digestMatched: reopened.accounting.digestMatched,
    observedSha256: reopened.accounting.observedSha256,
    bytesRead: reopened.accounting.bytesRead,
    durationNs: reopened.accounting.durationNs,
  } };
}

function conversationForSession(conversations, sessionId) {
  const matches = conversations.filter((item) => item?.sessionId === sessionId);
  if (matches.length !== 1 || !Array.isArray(matches[0].events)) {
    throw new TypeError('authoritative conversation snapshot is incomplete');
  }
  return matches[0];
}

function eventFor(events, predicate, label) {
  const matches = events.filter(predicate);
  if (matches.length !== 1) throw new TypeError(`${label} must resolve to exactly one canonical event`);
  return matches[0];
}

function completionEvents(workState, pointer, resultDigest) {
  const match = (event) => event.workId === pointer.workId && event.revision === pointer.revision
    && event.runId === pointer.runId;
  const verified = eventFor(workState.events, (event) => event.type === 'completion_verified'
    && match(event) && event.verifiedOutcome === 'achieved' && !(event.blockers ?? []).length,
  'achieved Work verification');
  const settled = eventFor(workState.events, (event) => event.type === 'work_settled'
    && match(event) && event.outcome === 'achieved', 'achieved Work settlement');
  const ready = eventFor(workState.events, (event) => event.type === 'result_ready_pending_surface'
    && match(event) && event.objectiveOutcome === 'achieved' && event.resultDigest === resultDigest,
  'achieved Work result');
  const surface = eventFor(workState.events, (event) => event.type === 'result_surface_persisted'
    && event.runId === pointer.runId, 'persisted Work surface');
  const delivery = eventFor(workState.events, (event) => event.type === 'result_delivery_terminal'
    && event.runId === pointer.runId && CONFIRMED_DELIVERY.has(event.delivery?.state),
  'terminal Work delivery');
  return [verified, settled, ready, surface, delivery];
}

function methodEffectPairs(run) {
  const pairs = [];
  for (const completed of run.events.filter((event) => event.type === 'tool_completed')) {
    const receipt = completed.payload?.receipt;
    const name = receipt?.actualCall?.name ?? receipt?.requestedCall?.name;
    const toolCallId = receipt?.toolCallId;
    if (!name || META_TOOLS.has(name) || receipt?.outcome !== 'succeeded'
      || receipt?.result?.effectUnknown === true || !toolCallId) continue;
    const started = eventFor(run.events, (event) => event.type === 'tool_started'
      && event.payload?.toolCallId === toolCallId && event.payload?.name === name,
    'runtime tool method');
    pairs.push({ started, completed });
  }
  if (!pairs.length) {
    throw new TypeError('achieved Episode lacks actual tool method and effect settlement evidence');
  }
  return pairs;
}

async function materializeEpisode({ pointer, workState, workById, resultByRunId, runById, conversations, scopes,
  reader, observedAt, reopenAccounting }) {
  const work = workById.get(pointer.workId);
  if (!work || work.status !== 'completed' || work.revision !== pointer.revision) {
    throw new TypeError('Episode pointer does not resolve to the achieved current Work revision');
  }
  const run = runById.get(pointer.runId);
  if (!run || run.status !== 'completed' || run.sessionId !== work.sessionId) {
    throw new TypeError('Episode pointer does not resolve to a completed authoritative Run');
  }
  const projection = scopeForEpisode(scopes, work, pointer);
  const conversation = conversationForSession(conversations, work.sessionId);
  const message = eventFor(conversation.events, (event) => event.type === 'message'
    && event.messageId === work.sourceMessageId && event.message?.role === 'user',
  'Episode objective message');
  const created = eventFor(workState.events, (event) => event.type === 'work_created'
    && event.workId === pointer.workId && event.sessionId === work.sessionId
    && event.sourceMessageId === work.sourceMessageId, 'Episode Work origin');
  const settlement = eventFor(workState.events, (event) => event.type === 'work_settled'
    && event.workId === pointer.workId && event.revision === pointer.revision
    && event.runId === pointer.runId && event.outcome === 'achieved', 'Episode settlement');
  const result = resultByRunId.get(pointer.runId);
  if (!result || result.objectiveOutcome !== 'achieved' || result.state !== 'delivery_terminal'
    || result.workId !== pointer.workId || result.revision !== pointer.revision
    || !CONFIRMED_DELIVERY.has(result.delivery?.state)) {
    throw new TypeError('Episode result is not achieved with terminal surface delivery');
  }

  const conversationRef = projectConversationRecordReference({ event: message,
    expectedSessionId: work.sessionId, workId: pointer.workId, channel: projection.channel,
    subjectKeys: projection.subjectKeys, trust: 'user_asserted', sensitivity: 'personal', observedAt });
  const workOriginRef = projectWorkRecordReference({ event: created, sessionId: work.sessionId,
    workId: pointer.workId, expectedWorkId: pointer.workId, channel: projection.channel,
    subjectKeys: projection.subjectKeys, trust: 'runtime_observed', sensitivity: 'personal', observedAt });
  const pairs = methodEffectPairs(run);
  const methodRefs = pairs.map(({ started }) => projectRunRecordReference({ event: started,
    runId: pointer.runId, sessionId: work.sessionId, expectedSessionId: work.sessionId,
    workId: pointer.workId, channel: projection.channel, subjectKeys: projection.subjectKeys,
    trust: 'runtime_observed', sensitivity: 'personal', observedAt }));
  const effectRefs = pairs.map(({ completed }) => projectRunRecordReference({ event: completed,
    runId: pointer.runId, sessionId: work.sessionId, expectedSessionId: work.sessionId,
    workId: pointer.workId, channel: projection.channel, subjectKeys: projection.subjectKeys,
    trust: 'runtime_observed', sensitivity: 'personal', observedAt }));
  const completion = completionEvents(workState, pointer, result.resultDigest);
  const completionRefs = completion.map((event) => projectWorkRecordReference({ event,
    sessionId: work.sessionId, workId: pointer.workId, expectedWorkId: pointer.workId,
    channel: projection.channel, subjectKeys: projection.subjectKeys,
    trust: 'runtime_observed', sensitivity: 'personal', observedAt }));
  const refs = [conversationRef, workOriginRef, ...methodRefs, ...effectRefs, ...completionRefs];
  for (const reference of refs) {
    const reopened = await reopenExact(reader, reference,
      { expectedSessionId: work.sessionId, expectedWorkId: pointer.workId }, 'Episode source');
    reopenAccounting.push(reopened.accounting);
    const source = reopened.source;
    if (source.schema == null || !['t5.conversation-event.v1', 't5.run-event.v1',
      't5.work-event.v1'].includes(source.schema)) {
      throw new TypeError('reopened Episode source has an invalid canonical schema');
    }
  }
  return {
    episode: {
      episodeId: pointer.handle, workId: pointer.workId, workRevision: pointer.revision,
      runId: pointer.runId, resultDigest: result.resultDigest, outcome: 'achieved',
      recordRoles: {
        objectiveRecordIds: [conversationRef.recordId, workOriginRef.recordId],
        methodRecordIds: methodRefs.map((item) => item.recordId),
        effectSettlementRecordIds: effectRefs.map((item) => item.recordId),
        completionRecordIds: completionRefs.map((item) => item.recordId),
      },
    },
    refs,
    settlement,
  };
}

export async function materializeReflectionEvidence(input = {}) {
  exact(input, TOP_FIELDS, 'ReflectionEvidenceMaterializerInput');
  const proposal = normalizeProposal(input.meaningProposal);
  const reflectionId = text(input.reflectionId, 'reflectionId');
  if (!['main_model', 'background_reviewer'].includes(input.createdBy)) {
    throw new TypeError('createdBy is not supported');
  }
  const observedAt = canonicalTime(input.observedAt, 'observedAt');
  if (typeof input.recordSourceReader?.reopen !== 'function') {
    throw new TypeError('RecordSourceReader is required');
  }
  const episodeAllowlist = input.episodeAllowlist.map(normalizeEpisodeHandle);
  const episodeByHandle = mapUnique(episodeAllowlist, 'handle', 'Episode handle');
  const selectedEpisodes = proposal.sourceEpisodeHandles.map((handle) => episodeByHandle.get(handle));
  if (selectedEpisodes.some((item) => !item)) throw new TypeError('unknown opaque Episode handle');
  if (new Set(selectedEpisodes.map((item) => item.workId)).size !== selectedEpisodes.length
    || new Set(selectedEpisodes.map((item) => item.runId)).size !== selectedEpisodes.length) {
    throw new TypeError('Reflection requires distinct achieved Work and Run holdouts');
  }

  exact(input.runtimeSnapshot, SNAPSHOT_FIELDS, 'ReflectionRuntimeSnapshot');
  const snapshot = input.runtimeSnapshot;
  if (!Array.isArray(snapshot.workState?.events) || !Array.isArray(snapshot.workState?.works)
    || !Array.isArray(snapshot.workState?.results) || !Array.isArray(snapshot.runs)
    || !Array.isArray(snapshot.conversations)) {
    throw new TypeError('authoritative runtime ledgers are incomplete');
  }
  const scopes = snapshot.affectedScopes.map(normalizeScope);
  mapUnique(scopes, 'handle', 'affected scope');
  const requiredScopeHandles = scopes.map((scope) => scope.handle);
  if (!sameSet(proposal.affectedScopeHandles, requiredScopeHandles)) {
    throw new TypeError('meaning proposal omitted an authoritative affected scope');
  }
  const runById = mapUnique(snapshot.runs, 'runId', 'runtime Run');
  const workById = mapUnique(snapshot.workState.works, 'workId', 'runtime Work');
  const resultByRunId = mapUnique(snapshot.workState.results, 'runId', 'runtime Work result');
  const materialized = [];
  const reopenAccounting = [];
  for (const pointer of selectedEpisodes) materialized.push(await materializeEpisode({
    pointer, workState: snapshot.workState, workById, resultByRunId, runById,
    conversations: snapshot.conversations,
    scopes, reader: input.recordSourceReader, observedAt, reopenAccounting,
  }));

  const corrections = snapshot.currentCorrections.map((item) => {
    exact(item, CURRENT_CORRECTION_FIELDS, 'ReflectionCurrentCorrection');
    const appliesToScopeHandles = uniqueTexts(item.appliesToScopeHandles,
      'ReflectionCurrentCorrection.appliesToScopeHandles', { minimum: 1, maximum: 32 });
    const refs = item.recordRefs.map(validateRecordReference);
    return { handle: text(item.handle, 'ReflectionCurrentCorrection.handle'),
      appliesToScopeHandles, head: structuredClone(item.head), refs };
  }).filter((item) => item.appliesToScopeHandles.some((handle) => requiredScopeHandles.includes(handle)));
  const correctionByHandle = mapUnique(corrections, 'handle', 'current correction');
  if (!sameSet(proposal.correctionRelations.map((item) => item.correctionHandle),
    [...correctionByHandle.keys()])) {
    throw new TypeError('meaning proposal omitted an authoritative current correction');
  }
  const correctionRefs = corrections.flatMap((item) => item.refs);
  for (const reference of correctionRefs) {
    const reopened = await reopenExact(input.recordSourceReader, reference, {}, 'current correction source');
    reopenAccounting.push(reopened.accounting);
  }

  exact(snapshot.counterexampleSearch, COUNTEREXAMPLE_SEARCH_FIELDS,
    'ReflectionRuntimeCounterexampleSearch');
  if (!['found', 'none_found'].includes(snapshot.counterexampleSearch.state)) {
    throw new TypeError('authoritative counterexample search is not terminal');
  }
  const counterexamples = snapshot.counterexampleSearch.results.map((item) => {
    exact(item, COUNTEREXAMPLE_RESULT_FIELDS, 'ReflectionRuntimeCounterexample');
    return { handle: text(item.handle, 'ReflectionRuntimeCounterexample.handle'),
      episodeId: text(item.episodeId, 'ReflectionRuntimeCounterexample.episodeId'),
      workId: text(item.workId, 'ReflectionRuntimeCounterexample.workId'),
      runId: text(item.runId, 'ReflectionRuntimeCounterexample.runId'),
      ref: validateRecordReference(item.recordRef) };
  });
  const counterexampleByHandle = mapUnique(counterexamples, 'handle', 'counterexample');
  if (new Set(counterexamples.map((item) => item.episodeId)).size !== counterexamples.length
    || new Set(counterexamples.map((item) => item.workId)).size !== counterexamples.length
    || new Set(counterexamples.map((item) => item.runId)).size !== counterexamples.length) {
    throw new TypeError('counterexample Episode, Work, and Run heads must be distinct');
  }
  if (snapshot.counterexampleSearch.state === 'found' && counterexamples.length === 0) {
    throw new TypeError('found counterexample search has no exact result');
  }
  if (snapshot.counterexampleSearch.state === 'none_found' && counterexamples.length !== 0) {
    throw new TypeError('none_found counterexample search cannot contain results');
  }
  const counterexampleHeads = counterexamples.map((item) => ({ handle: item.handle,
    episodeId: item.episodeId, workId: item.workId, runId: item.runId,
    recordId: item.ref.recordId, sourceRevision: item.ref.sourceRevision, sha256: item.ref.sha256 }))
    .toSorted((left, right) => left.handle.localeCompare(right.handle));
  const queryDigest = digestText(snapshot.counterexampleSearch.queryDigest,
    'ReflectionRuntimeCounterexampleSearch.queryDigest');
  const searchWindowDigest = digestText(snapshot.counterexampleSearch.sourceWindowDigest,
    'ReflectionRuntimeCounterexampleSearch.sourceWindowDigest');
  const resultDigest = digestText(snapshot.counterexampleSearch.resultDigest,
    'ReflectionRuntimeCounterexampleSearch.resultDigest');
  const receiptDigest = digestText(snapshot.counterexampleSearch.receiptDigest,
    'ReflectionRuntimeCounterexampleSearch.receiptDigest');
  if (!Number.isSafeInteger(snapshot.counterexampleSearch.resultCount)
    || snapshot.counterexampleSearch.resultCount !== counterexamples.length
    || resultDigest !== hash(counterexampleHeads)
    || receiptDigest !== hash({ state: snapshot.counterexampleSearch.state, queryDigest,
      sourceWindowDigest: searchWindowDigest, resultCount: counterexamples.length,
      resultDigest })) {
    throw new TypeError('authoritative counterexample search receipt does not match its exact results');
  }
  const supportWorkIds = new Set(selectedEpisodes.map((item) => item.workId));
  const supportRunIds = new Set(selectedEpisodes.map((item) => item.runId));
  if (counterexamples.some((item) => supportWorkIds.has(item.workId) || supportRunIds.has(item.runId))) {
    throw new TypeError('counterexample must be an independent Work and Run holdout');
  }
  if (!sameSet(proposal.counterexampleHandles, [...counterexampleByHandle.keys()])) {
    throw new TypeError('meaning proposal omitted an authoritative counterexample');
  }
  const counterexampleRefs = counterexamples.map((item) => item.ref);
  for (const reference of counterexampleRefs) {
    const reopened = await reopenExact(input.recordSourceReader, reference, {}, 'counterexample source');
    reopenAccounting.push(reopened.accounting);
  }

  if (!Array.isArray(snapshot.forgetHeads)
    || !sameSet(snapshot.forgetHeads.map((item) => item.scopeHandle), requiredScopeHandles)) {
    throw new TypeError('runtime snapshot omitted an authoritative affected-scope forget head');
  }
  const episodeRefs = materialized.flatMap((item) => item.refs);
  const recordRefs = [...episodeRefs, ...correctionRefs, ...counterexampleRefs];
  const episodes = materialized.map((item) => item.episode);
  const correctionHeads = corrections.map((item) => item.head);
  const sourceFence = calculateReflectionSourceFence({
    affectedScopeHandles: requiredScopeHandles, episodes, recordRefs,
    correctionHeads, forgetHeads: snapshot.forgetHeads,
  });
  const counterexampleSearch = snapshot.counterexampleSearch.state === 'found'
    ? { state: 'found', recordIds: counterexampleRefs.map((item) => item.recordId),
      sourceWindowDigest: sourceFence.windowDigest }
    : { state: 'none_found', recordIds: [], sourceWindowDigest: sourceFence.windowDigest };
  const envelope = makeReflectionCandidateEnvelope({
    reflectionId,
    hypothesis: proposal.hypothesis,
    sourceEpisodeIds: episodes.map((item) => item.episodeId),
    sourceRecordIds: episodeRefs.map((item) => item.recordId),
    counterexampleRecordIds: counterexampleRefs.map((item) => item.recordId),
    affectedScopes: requiredScopeHandles,
    createdBy: input.createdBy,
    episodes,
    recordRefs,
    correctionHeads,
    correctionRelations: proposal.correctionRelations.map((item) => ({
      memoryId: correctionByHandle.get(item.correctionHandle).head.memoryId,
      relation: item.relation,
    })),
    forgetHeads: snapshot.forgetHeads,
    counterexampleSearch,
    unknowns: proposal.unknowns,
  });
  const accountingRecords = reopenAccounting
    .toSorted((left, right) => left.recordId.localeCompare(right.recordId));
  const receipt = {
    schema: 't5.reflection-materialization-receipt.v1',
    runtimeSnapshotDigest: hash(snapshot),
    reopenAccountingRecords: accountingRecords,
    reopenAccountingDigest: hash(accountingRecords),
    counterexampleSearch: {
      state: snapshot.counterexampleSearch.state,
      queryDigest,
      sourceWindowDigest: searchWindowDigest,
      resultCount: snapshot.counterexampleSearch.resultCount,
      resultDigest,
      receiptDigest,
      heads: counterexampleHeads,
    },
    correctionDigest: hash({ heads: envelope.correctionHeads,
      relations: envelope.correctionRelations }),
    forgetDigest: hash(envelope.sourceFence.forgetHeads),
    episodeDigest: hash(envelope.episodes),
    candidateDigest: envelope.candidateDigest,
    sourceFenceDigest: envelope.sourceFence.windowDigest,
  };
  const materialization = {
    schema: 't5.reflection-materialization.v1', envelope, receipt,
    materializationDigest: '',
  };
  materialization.materializationDigest = hash({ schema: materialization.schema,
    envelope: materialization.envelope, receipt: materialization.receipt });
  validatePersistedReflectionMaterialization(materialization);
  deepFreeze(materialization);
  FRESH_MATERIALIZATIONS.add(materialization);
  return materialization;
}

function validateAccounting(records, envelope) {
  if (!Array.isArray(records) || records.length !== envelope.recordRefs.length) {
    throw new TypeError('materialization accounting must cover every adopted RecordRef exactly once');
  }
  const byRecordId = new Map(envelope.recordRefs.map((reference) => [reference.recordId, reference]));
  const seen = new Set();
  for (const item of records) {
    exact(item, ACCOUNTING_FIELDS, 'ReflectionMaterializationAccounting');
    const reference = byRecordId.get(item.recordId);
    if (!reference || seen.has(item.recordId) || item.schema !== 't5.record-source-accounting.v1'
      || item.sourceKind !== reference.sourceKind || item.sourceStore !== reference.sourceStore
      || item.availability !== 'available' || item.coverage !== reference.coverage
      || item.digestMatched !== true || item.observedSha256 !== reference.sha256
      || reference.sha256 === null) {
      throw new TypeError('materialization accounting does not prove an exact adopted RecordRef');
    }
    if (!(item.bytesRead === null || (Number.isSafeInteger(item.bytesRead) && item.bytesRead >= 0))
      || !(item.durationNs === null || /^[0-9]+$/u.test(item.durationNs))) {
      throw new TypeError('materialization accounting measurement is invalid');
    }
    seen.add(item.recordId);
  }
}

export function validatePersistedReflectionMaterialization(input) {
  exact(input, MATERIALIZATION_FIELDS, 'ReflectionMaterialization');
  if (input.schema !== 't5.reflection-materialization.v1') {
    throw new TypeError('Reflection materialization schema is invalid');
  }
  const envelope = validateReflectionCandidateEnvelope(input.envelope);
  exact(input.receipt, RECEIPT_FIELDS, 'ReflectionMaterializationReceipt');
  const receipt = input.receipt;
  if (receipt.schema !== 't5.reflection-materialization-receipt.v1') {
    throw new TypeError('Reflection materialization receipt schema is invalid');
  }
  for (const [value, label] of [
    [receipt.runtimeSnapshotDigest, 'runtimeSnapshotDigest'],
    [receipt.reopenAccountingDigest, 'reopenAccountingDigest'],
    [receipt.correctionDigest, 'correctionDigest'],
    [receipt.forgetDigest, 'forgetDigest'],
    [receipt.episodeDigest, 'episodeDigest'],
    [receipt.candidateDigest, 'candidateDigest'],
    [receipt.sourceFenceDigest, 'sourceFenceDigest'],
    [input.materializationDigest, 'materializationDigest'],
  ]) digestText(value, label);
  validateAccounting(receipt.reopenAccountingRecords, envelope);
  if (receipt.reopenAccountingDigest !== hash(receipt.reopenAccountingRecords)
    || receipt.correctionDigest !== hash({ heads: envelope.correctionHeads,
      relations: envelope.correctionRelations })
    || receipt.forgetDigest !== hash(envelope.sourceFence.forgetHeads)
    || receipt.episodeDigest !== hash(envelope.episodes)
    || receipt.candidateDigest !== envelope.candidateDigest
    || receipt.sourceFenceDigest !== envelope.sourceFence.windowDigest) {
    throw new TypeError('Reflection materialization receipt does not match its envelope');
  }
  exact(receipt.counterexampleSearch, RECEIPT_COUNTEREXAMPLE_FIELDS,
    'ReflectionMaterializationCounterexampleSearch');
  const search = receipt.counterexampleSearch;
  if (!['found', 'none_found'].includes(search.state) || !Number.isSafeInteger(search.resultCount)
    || search.resultCount < 0 || !Array.isArray(search.heads)
    || search.heads.length !== search.resultCount) {
    throw new TypeError('persisted counterexample search receipt is invalid');
  }
  for (const name of ['queryDigest', 'sourceWindowDigest', 'resultDigest', 'receiptDigest']) {
    digestText(search[name], `counterexampleSearch.${name}`);
  }
  const counterIds = new Set(envelope.candidate.counterexampleRecordIds);
  const counterRefs = new Map(envelope.recordRefs.filter((reference) => counterIds.has(reference.recordId))
    .map((reference) => [reference.recordId, reference]));
  const supportWorkIds = new Set(envelope.episodes.map((episode) => episode.workId));
  const supportRunIds = new Set(envelope.episodes.map((episode) => episode.runId));
  const seenHeads = new Set();
  const seenHandles = new Set(); const seenEpisodes = new Set();
  const seenWorks = new Set(); const seenRuns = new Set();
  for (const head of search.heads) {
    exact(head, RECEIPT_COUNTEREXAMPLE_HEAD_FIELDS, 'ReflectionMaterializationCounterexampleHead');
    text(head.handle, 'counterexample head handle');
    text(head.episodeId, 'counterexample head episodeId');
    text(head.workId, 'counterexample head workId');
    text(head.runId, 'counterexample head runId');
    text(head.recordId, 'counterexample head recordId');
    const reference = counterRefs.get(head.recordId);
    if (seenHeads.has(head.recordId) || seenHandles.has(head.handle)
      || seenEpisodes.has(head.episodeId) || seenWorks.has(head.workId) || seenRuns.has(head.runId)
      || !reference || head.sourceRevision !== reference.sourceRevision
      || head.sha256 !== reference.sha256
      || supportWorkIds.has(head.workId) || supportRunIds.has(head.runId)) {
      throw new TypeError('persisted counterexample head does not match the envelope');
    }
    digestText(head.sha256, 'counterexample head sha256');
    seenHeads.add(head.recordId);
    seenHandles.add(head.handle); seenEpisodes.add(head.episodeId);
    seenWorks.add(head.workId); seenRuns.add(head.runId);
  }
  if ((search.state === 'found' && search.resultCount === 0)
    || (search.state === 'none_found' && search.resultCount !== 0)
    || seenHeads.size !== counterIds.size || search.resultDigest !== hash(search.heads)
    || search.receiptDigest !== hash({ state: search.state, queryDigest: search.queryDigest,
      sourceWindowDigest: search.sourceWindowDigest, resultCount: search.resultCount,
      resultDigest: search.resultDigest })) {
    throw new TypeError('persisted counterexample search receipt does not match its exact heads');
  }
  const expectedMaterializationDigest = hash({ schema: input.schema, envelope: input.envelope,
    receipt: input.receipt });
  if (input.materializationDigest !== expectedMaterializationDigest) {
    throw new TypeError('Reflection materialization digest does not match its exact content');
  }
  return structuredClone(input);
}

export function consumeReflectionMaterialization(input) {
  if (!input || typeof input !== 'object' || !FRESH_MATERIALIZATIONS.has(input)) {
    const error = new Error('only a fresh runtime Reflection materialization may be consumed');
    error.code = 'reflection_materialization_not_fresh';
    throw error;
  }
  const validated = validatePersistedReflectionMaterialization(input);
  FRESH_MATERIALIZATIONS.delete(input);
  return validated;
}
