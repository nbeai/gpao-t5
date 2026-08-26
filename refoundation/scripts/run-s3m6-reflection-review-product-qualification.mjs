import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { makeRecordReference } from '../src/record-reference.js';
import { ReflectionLedger } from '../src/reflection-ledger.js';
import { makeReflectionReviewProductAdapter } from '../src/reflection-review-product-adapter.js';
import { ReflectionSourceWindowCoordinator } from '../src/reflection-source-window-coordinator.js';

const at = '2026-08-27T00:00:00.000Z';
const sha = (value) => createHash('sha256').update(typeof value === 'string'
  ? value : JSON.stringify(value)).digest('hex');
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
};
const digest = (value) => sha(JSON.stringify(canonical(value)));

function record(name, kind = 'conversation_message', trust = 'user_asserted') {
  return makeRecordReference({ sourceKind: kind, sourceStore: `${kind}-qualification`, sourceId: name,
    sourceRevision: 1, sha256: sha(name), occurredAt: at, recordedAt: at,
    scope: { sessionId: 'session-qualification-internal', workId: null,
      subjectKeys: ['subject-qualification-internal'], channel: 'private' },
    trust, sensitivity: 'personal', coverage: 'full', availability: 'available' });
}

function counterexampleSearch(reference) {
  const heads = [{ handle: 'counterexample-safe', episodeId: 'counter-episode-safe',
    workId: 'counter-work-safe', runId: 'counter-run-safe', recordId: reference.recordId,
    sourceRevision: reference.sourceRevision, sha256: reference.sha256 }];
  const queryDigest = sha('counter-query'); const sourceWindowDigest = sha('counter-window');
  const resultDigest = digest(heads);
  return { state: 'found', queryDigest, sourceWindowDigest, resultCount: 1, resultDigest,
    receiptDigest: digest({ state: 'found', queryDigest, sourceWindowDigest,
      resultCount: 1, resultDigest }), results: [{ handle: 'counterexample-safe',
      episodeId: 'counter-episode-safe', workId: 'counter-work-safe', runId: 'counter-run-safe',
      recordRef: reference }] };
}

function runtimeFixture() {
  const correction = record('correction-private-canary');
  const counterexample = record('counterexample-private-canary', 'web_source', 'external_untrusted');
  const workState = { works: [], events: [], results: [] }; const runs = [];
  const messages = []; const episodeAllowlist = []; let workSequence = 0;
  for (const number of [1, 2]) {
    const workId = `work-private-${number}`; const runId = `run-private-${number}`;
    const messageId = `objective-private-${number}`; const resultDigest = sha(`result-${number}`);
    messages.push({ schema: 't5.conversation-event.v1', sequence: number, recordedAt: at,
      sessionId: 'session-qualification-internal', type: 'message', messageId,
      message: { role: 'user', content: `합성 과업 ${number}의 결과를 확인해줘` } });
    workState.works.push({ workId, status: 'completed', revision: 1,
      sessionId: 'session-qualification-internal', sourceMessageId: messageId });
    const event = (type, fields = {}) => ({ schema: 't5.work-event.v1', sequence: ++workSequence,
      recordedAt: at, type, workId, revision: 1, runId, ...fields });
    workState.events.push(event('work_created', { sessionId: 'session-qualification-internal',
      sourceMessageId: messageId }), event('completion_verified', {
      verifiedOutcome: 'achieved', blockers: [] }), event('work_settled', { outcome: 'achieved' }),
    event('result_ready_pending_surface', { objectiveOutcome: 'achieved', resultDigest }),
    event('result_surface_persisted'), event('result_delivery_terminal', { delivery: { state: 'persisted' } }));
    workState.results.push({ runId, state: 'delivery_terminal', objectiveOutcome: 'achieved',
      workId, revision: 1, resultDigest, delivery: { state: 'persisted' } });
    runs.push({ runId, sessionId: 'session-qualification-internal', status: 'completed', events: [
      { schema: 't5.run-event.v1', sequence: 1, recordedAt: at, runId, type: 'tool_started',
        payload: { toolCallId: `call-${number}`, name: 'exec' } },
      { schema: 't5.run-event.v1', sequence: 2, recordedAt: at, runId, type: 'tool_completed',
        payload: { receipt: { toolCallId: `call-${number}`, outcome: 'succeeded',
          actualCall: { name: 'exec' }, result: { effectUnknown: false } } } },
    ] });
    episodeAllowlist.push({ handle: `episode-safe-${number}`, workId, revision: 1, runId });
  }
  const affectedScopes = episodeAllowlist.map((episode, index) => ({ handle: `scope-safe-${index + 1}`,
    sessionId: 'session-qualification-internal', workId: episode.workId,
    subjectKeys: ['subject-qualification-internal'], channel: 'private' }));
  const currentCorrections = [{ handle: 'correction-safe',
    appliesToScopeHandles: affectedScopes.map((scope) => scope.handle),
    head: { memoryId: 'memory-private-canary', subjectKey: 'subject-qualification-internal',
      subjectRevision: 2, sourceOrder: 3, status: 'active', sourceRecordIds: [correction.recordId] },
    recordRefs: [correction] }];
  return { episodeAllowlist, correction, counterexample, sourceState: 'available',
    runtimeSnapshot: { workState, runs,
      conversations: [{ sessionId: 'session-qualification-internal', events: messages }],
      affectedScopes, currentCorrections,
      forgetHeads: affectedScopes.map((scope) => ({ scopeHandle: scope.handle, epoch: 0,
        lastForgetRequestId: null, tombstoneDigest: null })),
      counterexampleSearch: counterexampleSearch(counterexample) } };
}

function sourceReader(fixture) {
  return { async reopen(reference) {
    const state = fixture.sourceState;
    if (state !== 'available') return { state, source: null, accounting: {
      schema: 't5.record-source-accounting.v1', recordId: reference.recordId,
      sourceKind: reference.sourceKind, sourceStore: reference.sourceStore,
      availability: state, coverage: reference.coverage, digestMatched: state === 'changed' ? false : null,
      observedSha256: state === 'changed' ? sha('changed') : null, bytesRead: null, durationNs: '1' } };
    const schema = reference.sourceKind === 'conversation_message' ? 't5.conversation-event.v1'
      : reference.sourceKind === 'run_event' ? 't5.run-event.v1'
        : reference.sourceKind === 'work_event' ? 't5.work-event.v1' : 't5.web-source.v1';
    const source = reference.sourceKind === 'conversation_message'
      ? { schema, recordedAt: at, message: { content: '합성 사용자 원문' } }
      : { schema, userSafeSummary: '합성 작업 근거', statement: '합성 반례' };
    return { state: 'reopened', source, accounting: { schema: 't5.record-source-accounting.v1',
      recordId: reference.recordId, sourceKind: reference.sourceKind, sourceStore: reference.sourceStore,
      availability: 'available', coverage: reference.coverage, digestMatched: true,
      observedSha256: reference.sha256, bytesRead: 1, durationNs: '1' } };
  } };
}

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${server.address().port}`;
}
async function post(base, path, body) {
  const response = await fetch(`${base}${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

async function buildStack(root, name) {
  const fixture = runtimeFixture(); const reader = sourceReader(fixture);
  const ledger = new ReflectionLedger(join(root, name, 'reflection')); await ledger.ensure();
  const bindings = {}; const requiredStores = ['conversation', 'counterexample', 'memory', 'run', 'work'];
  for (const store of requiredStores) {
    const path = join(root, name, 'bindings', `${store}.json`); await mkdir(join(root, name, 'bindings'), { recursive: true });
    await writeFile(path, '{}'); bindings[store] = { store: { path }, foregroundParticipating: true };
  }
  const enumerate = async ({ epoch, writerRegistrations }) => {
    const heads = writerRegistrations.map((item) => ({ store: item.store,
      headDigest: digest({ store: item.store, snapshot: fixture.runtimeSnapshot,
        sourceState: fixture.sourceState }), writerRegistrationDigest: item.writerRegistrationDigest }))
      .toSorted((left, right) => left.store.localeCompare(right.store));
    return { runtimeSnapshot: structuredClone(fixture.runtimeSnapshot),
      episodeAllowlist: structuredClone(fixture.episodeAllowlist), recordSourceReader: reader,
      storeHeadReceipt: { schema: 't5.reflection-store-head-receipt.v1', epoch, heads,
        receiptDigest: digest({ schema: 't5.reflection-store-head-receipt.v1', epoch, heads }) } };
  };
  const sourceWindow = new ReflectionSourceWindowCoordinator({ ledger, enumerateSourceWindow: enumerate,
    requiredStores, storeBindings: bindings, clock: () => at,
    makeReflectionId: () => `reflection-${name}`, createdBy: 'background_reviewer' });
  await sourceWindow.materializeAndPropose({ meaningProposal: { action: 'propose',
    hypothesis: '현재 결과를 확인한 뒤에만 재실행하면 중복 효과를 줄일 수 있다.',
    sourceEpisodeHandles: fixture.episodeAllowlist.map((item) => item.handle),
    affectedScopeHandles: fixture.runtimeSnapshot.affectedScopes.map((item) => item.handle),
    correctionRelations: [{ correctionHandle: 'correction-safe', relation: 'preserved' }],
    counterexampleHandles: ['counterexample-safe'], unknowns: ['다른 작업군은 아직 모른다.'] } });
  const observeCurrentEvidence = async () => {
    const state = await ledger.read(); const entry = state.reflectionEntries[0];
    const scopes = fixture.runtimeSnapshot.affectedScopes.map((scope) => ({ handle: scope.handle,
      sessionId: scope.sessionId, workId: scope.workId,
      subjectKeys: [...scope.subjectKeys].toSorted(), channel: scope.channel }));
    const heads = scopes.map((scope) => ({ ...scope, headDigest: digest(scope) }))
      .toSorted((left, right) => left.handle.localeCompare(right.handle));
    return { currentEvidence: { affectedScopeHandles: entry.candidate.candidate.affectedScopes,
      episodes: entry.candidate.episodes, recordRefs: entry.candidate.recordRefs,
      correctionHeads: fixture.runtimeSnapshot.currentCorrections.map((item) => item.head),
      forgetHeads: fixture.runtimeSnapshot.forgetHeads }, currentAffectedScopeHeads: heads,
    currentAffectedScopeDigest: digest(heads) };
  };
  const coordinator = makeReflectionReviewProductAdapter({ ledger, recordSourceReader: reader,
    sourceWindowCoordinator: sourceWindow, observeCurrentEvidence });
  let modelCalls = 0; const server = makeConsoleServer({ stateDir: join(root, name, 'product-state'),
    workspace: join(root, name, 'workspace'), reflectionReviewCoordinator: coordinator,
    modelFactory: () => ({ async respond() { modelCalls += 1; return { text: 'unused', toolCalls: [] }; } }) });
  await mkdir(join(root, name, 'workspace'), { recursive: true }); const base = await listen(server);
  return { fixture, ledger, sourceWindow, coordinator, server, base, modelCalls: () => modelCalls };
}

async function close(stack) {
  await stack.server.closeBrowsers(); await new Promise((resolve) => stack.server.close(resolve));
}
function sideEffectsZero(value) {
  const serialized = JSON.stringify(value);
  return !/"(?:memoryWrites|principleWrites|managedCapabilityChanges|externalWrites)":(?!0)/u.test(serialized);
}
async function reviewEvents(ledger) {
  return (await ledger.read()).events.filter((event) => event.type === 'reflection_review_decided').length;
}

export async function runReflectionReviewProductQualification() {
  const room = await mkdtemp(join(tmpdir(), 't5-s3m6-review-product-')); const journeys = [];
  const privacyCanaries = ['session-qualification-internal', 'work-private-',
    'subject-qualification-internal', 'memory-private-canary', 'correction-private-canary',
    'counterexample-private-canary', 'recordId', 'reflectionId'];
  let contextCanaryHits = 0; let observedModelCalls = 0;
  const observePublic = (value) => {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    contextCanaryHits += privacyCanaries.filter((canary) => serialized.includes(canary)).length;
  };
  try {
    const happy = await buildStack(room, 'happy');
    try {
      const beforeOverview = await fetch(`${happy.base}/overview`).then((response) => response.text());
      const beforeMemory = await fetch(`${happy.base}/memory/state`).then((response) => response.text());
      const state = await fetch(`${happy.base}/reflection/review/state`).then((response) => response.json());
      const item = state.items[0]; const detail = await post(happy.base, '/reflection/review/detail', {
        reviewHandle: item.reviewHandle });
      const firstSource = detail.body.item.support[0].sourceGroups[0].sources[0];
      const source = await post(happy.base, '/reflection/review/source', {
        reviewHandle: item.reviewHandle, sourceHandle: firstSource.sourceHandle });
      const retained = await post(happy.base, '/reflection/review/action', { requestId: 'retain-happy',
        reviewHandle: item.reviewHandle, revisionHandle: item.revisionHandle, decision: 'retain' });
      const rejected = await post(happy.base, '/reflection/review/action', { requestId: 'reject-reviewed',
        reviewHandle: retained.body.item.reviewHandle,
        revisionHandle: retained.body.item.revisionHandle, decision: 'reject' });
      const privacy = `${beforeOverview}${beforeMemory}${JSON.stringify({ state, detail: detail.body, source: source.body })}`;
      observePublic(privacy);
      journeys.push({ id: 'list_detail_source_retain_reviewed_reject', pass: source.status === 200
        && retained.status === 200 && rejected.status === 200 && retained.body.item.applied === false
        && rejected.body.item.applied === false && await reviewEvents(happy.ledger) === 2
        && !/session-qualification-internal|work-private-|subject-qualification-internal|recordId|reflectionId/u.test(privacy)
        && happy.modelCalls() === 0 && sideEffectsZero({ retained: retained.body, rejected: rejected.body }) });
    } finally { observedModelCalls += happy.modelCalls(); await close(happy); }

    const later = await buildStack(room, 'later');
    try {
      const item = (await fetch(`${later.base}/reflection/review/state`).then((response) => response.json())).items[0];
      const result = await post(later.base, '/reflection/review/action', { requestId: 'later-safe',
        reviewHandle: item.reviewHandle, revisionHandle: item.revisionHandle, decision: 'later' });
      journeys.push({ id: 'later_writes_zero', pass: result.status === 200
        && await reviewEvents(later.ledger) === 0 && later.modelCalls() === 0 });
    } finally { observedModelCalls += later.modelCalls(); await close(later); }

    for (const stale of ['correction', 'forget']) {
      const stack = await buildStack(room, `stale-${stale}`);
      try {
        const item = (await fetch(`${stack.base}/reflection/review/state`).then((response) => response.json())).items[0];
        if (stale === 'correction') stack.fixture.runtimeSnapshot.currentCorrections[0].head.subjectRevision += 1;
        else stack.fixture.runtimeSnapshot.forgetHeads[0].epoch += 1;
        const before = await reviewEvents(stack.ledger);
        const result = await post(stack.base, '/reflection/review/action', { requestId: `stale-${stale}`,
          reviewHandle: item.reviewHandle, revisionHandle: item.revisionHandle, decision: 'retain' });
        journeys.push({ id: `stale_${stale}_rejected`, pass: result.status === 409
          && await reviewEvents(stack.ledger) === before && stack.modelCalls() === 0 });
      } finally { observedModelCalls += stack.modelCalls(); await close(stack); }
    }

    for (const sourceState of ['changed', 'missing', 'permission_denied', 'unknown']) {
      const stack = await buildStack(room, `source-${sourceState}`);
      try {
        const item = (await fetch(`${stack.base}/reflection/review/state`).then((response) => response.json())).items[0];
        const detail = await post(stack.base, '/reflection/review/detail', { reviewHandle: item.reviewHandle });
        const counterSource = detail.body.item.counterexamples[0].sources[0];
        stack.fixture.sourceState = sourceState; const before = await reviewEvents(stack.ledger);
        const source = await post(stack.base, '/reflection/review/source', {
          reviewHandle: item.reviewHandle, sourceHandle: counterSource.sourceHandle });
        const result = await post(stack.base, '/reflection/review/action', { requestId: `source-${sourceState}`,
          reviewHandle: item.reviewHandle, revisionHandle: item.revisionHandle, decision: 'retain' });
        observePublic({ detail: detail.body, source: source.body, action: result.body });
        journeys.push({ id: `source_${sourceState}_rejected`, pass: result.status === 409
          && source.status === 200 && source.body.source.state === sourceState
          && source.body.source.content === null && await reviewEvents(stack.ledger) === before });
      } finally { observedModelCalls += stack.modelCalls(); await close(stack); }
    }

    const race = await buildStack(room, 'race');
    try {
      const item = (await fetch(`${race.base}/reflection/review/state`).then((response) => response.json())).items[0];
      const [retain, reject] = await Promise.all([
        post(race.base, '/reflection/review/action', { requestId: 'tab-retain',
          reviewHandle: item.reviewHandle, revisionHandle: item.revisionHandle, decision: 'retain' }),
        post(race.base, '/reflection/review/action', { requestId: 'tab-reject',
          reviewHandle: item.reviewHandle, revisionHandle: item.revisionHandle, decision: 'reject' }),
      ]);
      journeys.push({ id: 'two_tab_cas_one_commit', pass: [retain.status, reject.status].sort().join(',') === '200,409'
        && await reviewEvents(race.ledger) === 1 });
    } finally { observedModelCalls += race.modelCalls(); await close(race); }

    const retry = await buildStack(room, 'retry');
    try {
      const item = (await fetch(`${retry.base}/reflection/review/state`).then((response) => response.json())).items[0];
      const body = { requestId: 'response-loss-safe', reviewHandle: item.reviewHandle,
        revisionHandle: item.revisionHandle, decision: 'retain' };
      await post(retry.base, '/reflection/review/action', body); const repeated = await post(retry.base,
        '/reflection/review/action', body);
      journeys.push({ id: 'response_loss_idempotent_retry', pass: repeated.status === 200
        && repeated.body.idempotent === true && await reviewEvents(retry.ledger) === 1 });
    } finally { observedModelCalls += retry.modelCalls(); await close(retry); }

    const result = { schema: 't5.s3m6.reflection-review-product-qualification.v1',
      isolated: true, defaultBackgroundEnabled: false, externalWrites: 0, modelCalls: 0,
      providerCalls: 0, contextCanaryHits, journeys };
    result.modelCalls = observedModelCalls;
    result.pass = journeys.length === 10 && journeys.every((journey) => journey.pass)
      && observedModelCalls === 0 && contextCanaryHits === 0;
    return result;
  } finally { await rm(room, { recursive: true, force: true, maxRetries: 4, retryDelay: 25 }); }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const result = await runReflectionReviewProductQualification();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (!result.pass) process.exitCode = 1;
}
