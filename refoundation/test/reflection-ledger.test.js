import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeRecordReference } from '../src/record-reference.js';
import {
  calculateReflectionSourceFence,
  makeReflectionCandidateEnvelope,
} from '../src/reflection-candidate.js';
import { materializeReflectionEvidence } from '../src/reflection-evidence-materializer.js';
import {
  materializeReflectionReviewProbe,
  ReflectionLedger,
} from '../src/reflection-ledger.js';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
};
const recordedAt = '2026-08-27T00:00:00.000Z';

function record(name, sourceKind, trust = 'runtime_observed') {
  return makeRecordReference({
    sourceKind, sourceStore: `${sourceKind}-store`, sourceId: name, sourceRevision: 1,
    sha256: sha(name), occurredAt: recordedAt, recordedAt,
    scope: { sessionId: `session-${name}`, workId: `work-${name}`,
      subjectKeys: ['subject-safe'], channel: 'private' },
    trust, sensitivity: 'normal', coverage: 'full', availability: 'available',
  });
}

function fixture(reflectionId = 'reflection-safe-1', hypothesis = '두 번의 독립 과업에서 검증할 절차 후보') {
  const refs = {
    objective1: record('objective-1', 'conversation_message', 'user_asserted'),
    method1: record('method-1', 'run_event'), effect1: record('effect-1', 'run_event'),
    completion1: record('completion-1', 'work_event'),
    objective2: record('objective-2', 'conversation_message', 'user_asserted'),
    method2: record('method-2', 'run_event'), effect2: record('effect-2', 'run_event'),
    completion2: record('completion-2', 'work_event'),
    counterexample: record('counterexample', 'web_source', 'external_untrusted'),
    correction: record('correction', 'conversation_message', 'user_asserted'),
  };
  const roles = (number) => ({
    objectiveRecordIds: [refs[`objective${number}`].recordId],
    methodRecordIds: [refs[`method${number}`].recordId],
    effectSettlementRecordIds: [refs[`effect${number}`].recordId],
    completionRecordIds: [refs[`completion${number}`].recordId],
  });
  const episodes = [1, 2].map((number) => ({
    episodeId: `episode-${number}`, workId: `work-${number}`, workRevision: number,
    runId: `run-${number}`, resultDigest: sha(`result-${number}`), outcome: 'achieved',
    recordRoles: roles(number),
  }));
  const sourceRecordIds = [refs.objective1, refs.method1, refs.effect1, refs.completion1,
    refs.objective2, refs.method2, refs.effect2, refs.completion2].map((item) => item.recordId);
  const correctionHeads = [{ memoryId: 'memory-safe', subjectKey: 'subject-safe', subjectRevision: 2,
    sourceOrder: 4, status: 'active', sourceRecordIds: [refs.correction.recordId] }];
  const forgetHeads = [{ scopeHandle: 'scope-safe', epoch: 0,
    lastForgetRequestId: null, tombstoneDigest: null }];
  const fence = calculateReflectionSourceFence({ affectedScopeHandles: ['scope-safe'], episodes,
    recordRefs: Object.values(refs), correctionHeads, forgetHeads });
  return makeReflectionCandidateEnvelope({
    reflectionId, hypothesis,
    sourceEpisodeIds: episodes.map((item) => item.episodeId), sourceRecordIds,
    counterexampleRecordIds: [refs.counterexample.recordId], affectedScopes: ['scope-safe'],
    createdBy: 'background_reviewer', episodes, recordRefs: Object.values(refs),
    correctionHeads,
    correctionRelations: [{ memoryId: 'memory-safe', relation: 'preserved' }],
    forgetHeads,
    counterexampleSearch: { state: 'found', recordIds: [refs.counterexample.recordId],
      sourceWindowDigest: fence.windowDigest },
    unknowns: ['실제 제품 이익은 아직 검증하지 않음'],
  });
}

function evidence(envelope) {
  return { affectedScopeHandles: envelope.candidate.affectedScopes, episodes: envelope.episodes,
    recordRefs: envelope.recordRefs, correctionHeads: envelope.correctionHeads,
    forgetHeads: envelope.sourceFence.forgetHeads };
}

function qualifiedProbe(materialization) {
  const envelope = materialization.envelope;
  return materializeReflectionReviewProbe({
    sourceFenceDigest: envelope.sourceFence.windowDigest,
    affectedScopeDigest: materialization.receipt.affectedScopeDigest,
    recordRefs: envelope.recordRefs,
    recordSourceReader: { async reopen(reference) { return { state: 'reopened', source: {}, accounting: {
      recordId: reference.recordId, availability: 'available', digestMatched: true,
      observedSha256: reference.sha256,
    } }; } },
  });
}

async function roomFor(name) {
  return mkdtemp(join(tmpdir(), `t5-reflection-ledger-${name}-`));
}

async function freshMaterialization(reflectionId = 'reflection-safe-1',
  hypothesis = '두 번의 독립 과업에서 검증할 절차 후보') {
  const sessionId = 'session-materialized-safe';
  const workState = { works: [], events: [], results: [] };
  const runs = []; const conversationEvents = []; const episodeAllowlist = [];
  let workSequence = 0;
  for (const number of [1, 2]) {
    const workId = `material-work-${number}`; const runId = `material-run-${number}`;
    const messageId = `material-objective-${number}`; const resultDigest = sha(`material-result-${number}`);
    conversationEvents.push({ schema: 't5.conversation-event.v1', sequence: number,
      recordedAt, sessionId, type: 'message', messageId,
      message: { role: 'user', content: `안전한 과업 ${number}` } });
    workState.works.push({ workId, status: 'completed', revision: 1, sessionId, sourceMessageId: messageId });
    const workEvent = (type, extra = {}) => ({ schema: 't5.work-event.v1', sequence: ++workSequence,
      recordedAt, type, workId, revision: 1, runId, ...extra });
    workState.events.push(
      workEvent('work_created', { sessionId, sourceMessageId: messageId }),
      workEvent('completion_verified', { verifiedOutcome: 'achieved', blockers: [] }),
      workEvent('work_settled', { outcome: 'achieved' }),
      workEvent('result_ready_pending_surface', { objectiveOutcome: 'achieved', resultDigest }),
      workEvent('result_surface_persisted'),
      workEvent('result_delivery_terminal', { delivery: { state: 'persisted' } }),
    );
    workState.results.push({ runId, state: 'delivery_terminal', objectiveOutcome: 'achieved',
      workId, revision: 1, resultDigest, delivery: { state: 'persisted' } });
    runs.push({ runId, sessionId, status: 'completed', events: [
      { schema: 't5.run-event.v1', sequence: 1, recordedAt, runId, type: 'tool_started',
        payload: { toolCallId: `call-${number}`, name: 'exec' } },
      { schema: 't5.run-event.v1', sequence: 2, recordedAt, runId, type: 'tool_completed',
        payload: { receipt: { toolCallId: `call-${number}`, outcome: 'succeeded',
          actualCall: { name: 'exec' }, result: { effectUnknown: false } } } },
    ] });
    episodeAllowlist.push({ handle: `material-episode-${number}`, workId, revision: 1, runId });
  }
  const correctionRef = makeRecordReference({ sourceKind: 'conversation_message',
    sourceStore: 'conversation-ledger', sourceId: 'material-correction', sourceRevision: 3,
    sha256: sha('material-correction'), occurredAt: recordedAt, recordedAt,
    scope: { sessionId, workId: null, subjectKeys: ['subject-safe'], channel: 'private' },
    trust: 'user_asserted', sensitivity: 'personal', coverage: 'full', availability: 'available' });
  const counterexampleRef = makeRecordReference({ sourceKind: 'web_source',
    sourceStore: 'fixture-source', sourceId: 'material-counterexample', sourceRevision: 1,
    sha256: sha('material-counterexample'), occurredAt: recordedAt, recordedAt,
    scope: { sessionId: null, workId: null, subjectKeys: ['subject-safe'], channel: null },
    trust: 'external_untrusted', sensitivity: 'personal', coverage: 'full', availability: 'available' });
  const affectedScopes = episodeAllowlist.map((episode, index) => ({ handle: `material-scope-${index + 1}`,
    sessionId, workId: episode.workId, subjectKeys: ['subject-safe'], channel: 'private' }));
  const heads = [{ handle: 'material-counterexample-head', episodeId: 'counter-episode',
    workId: 'counter-work', runId: 'counter-run', recordId: counterexampleRef.recordId,
    sourceRevision: counterexampleRef.sourceRevision, sha256: counterexampleRef.sha256 }];
  const queryDigest = sha('material-query'); const sourceWindowDigest = sha('material-search-window');
  const resultDigest = sha(JSON.stringify(canonical(heads)));
  const receiptDigest = sha(JSON.stringify(canonical({ state: 'found', queryDigest,
    sourceWindowDigest, resultCount: 1, resultDigest })));
  const runtimeSnapshot = {
    workState, runs, conversations: [{ sessionId, events: conversationEvents }], affectedScopes,
    currentCorrections: [{ handle: 'material-correction-head',
      appliesToScopeHandles: affectedScopes.map((scope) => scope.handle),
      head: { memoryId: 'material-memory', subjectKey: 'subject-safe', subjectRevision: 2,
        sourceOrder: 3, status: 'active', sourceRecordIds: [correctionRef.recordId] },
      recordRefs: [correctionRef] }],
    forgetHeads: affectedScopes.map((scope) => ({ scopeHandle: scope.handle, epoch: 0,
      lastForgetRequestId: null, tombstoneDigest: null })),
    counterexampleSearch: { state: 'found', queryDigest, sourceWindowDigest, resultCount: 1,
      resultDigest, receiptDigest, results: [{ handle: 'material-counterexample-head',
        episodeId: 'counter-episode', workId: 'counter-work', runId: 'counter-run',
        recordRef: counterexampleRef }] },
  };
  const recordSourceReader = { async reopen(reference) {
    const sourceSchema = reference.sourceKind === 'conversation_message' ? 't5.conversation-event.v1'
      : reference.sourceKind === 'run_event' ? 't5.run-event.v1'
        : reference.sourceKind === 'work_event' ? 't5.work-event.v1' : 't5.web-source.v1';
    return { state: 'reopened', source: { schema: sourceSchema }, accounting: {
      schema: 't5.record-source-accounting.v1', recordId: reference.recordId,
      sourceKind: reference.sourceKind, sourceStore: reference.sourceStore,
      availability: 'available', coverage: reference.coverage, digestMatched: true,
      observedSha256: reference.sha256, bytesRead: 1, durationNs: '1',
    } };
  } };
  return materializeReflectionEvidence({
    meaningProposal: { action: 'propose', hypothesis,
      sourceEpisodeHandles: episodeAllowlist.map((episode) => episode.handle),
      affectedScopeHandles: affectedScopes.map((scope) => scope.handle),
      correctionRelations: [{ correctionHandle: 'material-correction-head', relation: 'preserved' }],
      counterexampleHandles: ['material-counterexample-head'], unknowns: ['추가 검증 필요'] },
    episodeAllowlist, runtimeSnapshot, recordSourceReader, reflectionId,
    createdBy: 'background_reviewer', observedAt: recordedAt,
  });
}

test('append-only ledger는 fresh proposed materialization만 저장하고 동일 hypothesis+fence를 멱등 처리한다', async () => {
  const room = await roomFor('proposal');
  try {
    const ledger = new ReflectionLedger(join(room, 'ledger'), { clock: () => recordedAt });
    await ledger.ensure();
    const proposed = await freshMaterialization();
    const first = await ledger.propose(proposed);
    const duplicate = await ledger.propose(await freshMaterialization('reflection-safe-other'));
    assert.equal(first.created, true); assert.equal(duplicate.created, false);
    assert.equal(duplicate.idempotent, true);
    assert.equal(duplicate.candidate.candidate.reflectionId, 'reflection-safe-1');
    await assert.rejects(ledger.propose(proposed), (error) => (
      error.code === 'reflection_materialization_not_fresh'
    ));
    const state = await ledger.read();
    assert.equal(state.candidates.length, 1); assert.equal(state.events.length, 2);
    assert.equal(state.candidates[0].candidate.state, 'proposed');
    assert.equal((await lstat(ledger.directory)).mode & 0o777, 0o700);
    assert.equal((await lstat(ledger.path)).mode & 0o777, 0o600);
    for (const value of [first, duplicate, state]) {
      assert.equal(value.publicationQualified, false);
      assert.equal(value.crossStoreAtomicCasQualified, false);
      assert.equal(value.truncationQualified, false);
      assert.equal(value.anchoredHead, false);
      assert.equal(value.pathChmodReplacementRaceQualified, false);
    }
    assert.deepEqual(state.productProjection, []); assert.deepEqual(state.activeCandidates, []);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('두 Ledger instance의 동시 propose는 같은 sequence를 만들지 않고 same-key 한 commit만 남긴다', async () => {
  const room = await roomFor('two-instances');
  try {
    const directory = join(room, 'ledger');
    const firstLedger = new ReflectionLedger(directory, { clock: () => recordedAt });
    const secondLedger = new ReflectionLedger(directory, { clock: () => recordedAt });
    await firstLedger.ensure();
    const sameKey = await Promise.all([
      firstLedger.propose(await freshMaterialization('reflection-concurrent-a')),
      secondLedger.propose(await freshMaterialization('reflection-concurrent-b')),
    ]);
    assert.equal(sameKey.filter((item) => item.created).length, 1);
    assert.equal(sameKey.filter((item) => item.idempotent).length, 1);
    const different = await Promise.all([
      firstLedger.propose(await freshMaterialization('reflection-concurrent-c', '서로 다른 가설 C')),
      secondLedger.propose(await freshMaterialization('reflection-concurrent-d', '서로 다른 가설 D')),
    ]);
    assert.equal(different.filter((item) => item.created).length, 2);
    const state = await firstLedger.read();
    assert.deepEqual(state.events.map((event) => event.sequence), [1, 2, 3, 4]);
    assert.equal(state.candidates.length, 3);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('caller는 reviewed/stateHistory를 직접 저장하지 못하고 ledger transition만 순수 전이를 append한다', async () => {
  const room = await roomFor('transition');
  try {
    const ledger = new ReflectionLedger(join(room, 'ledger'), { clock: () => recordedAt });
    await ledger.ensure(); const proposed = await freshMaterialization(); await ledger.propose(proposed);
    await assert.rejects(ledger.transition('reflection-safe-1', { to: 'reviewed',
      currentEvidence: evidence(proposed.envelope) }), (failure) => (
      failure.code === 'reflection_review_api_required'
    ));
    const reviewed = await ledger.review('reflection-safe-1', { requestId: 'review-transition-1',
      expectedCandidateDigest: proposed.envelope.candidateDigest, decision: 'retain',
      currentEvidence: evidence(proposed.envelope), sourceProbeReceipt: await qualifiedProbe(proposed) });
    assert.equal(reviewed.candidate.candidate.state, 'reviewed');
    const tested = await ledger.transition('reflection-safe-1', { to: 'tested',
      currentEvidence: evidence(reviewed.candidate) });
    assert.equal(tested.candidate.candidate.state, 'tested');
    assert.equal(reviewed.materializationDigest, proposed.materializationDigest);
    assert.equal(tested.materializationDigest, proposed.materializationDigest);
    assert.deepEqual(tested.receipt, proposed.receipt);
    for (const transition of [reviewed, tested]) {
      assert.equal(transition.active, false); assert.equal(transition.productProjection, 'none');
      assert.deepEqual(transition.sideEffects,
        { memoryWrites: 0, principleWrites: 0, managedCapabilityChanges: 0, externalWrites: 0 });
    }
    const restarted = new ReflectionLedger(ledger.directory);
    const restored = await restarted.read();
    assert.equal(restored.candidates[0].candidate.state, 'tested');
    assert.equal(restored.events.length, 4);
    assert.equal(restored.events[2].payload.materializationDigest, proposed.materializationDigest);
    assert.equal(restored.events[3].payload.materializationDigest, proposed.materializationDigest);
    assert.deepEqual(restored.reflectionEntries[0].receipt, proposed.receipt);
    await assert.rejects(ledger.propose(reviewed.candidate), (error) => (
      error.code === 'reflection_materialization_not_fresh'
    ));
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('human retain은 expected digest CAS와 qualified all-source probe로 reviewed receipt를 원자 append한다', async () => {
  const room = await roomFor('human-retain');
  try {
    const ledger = new ReflectionLedger(join(room, 'ledger'), { clock: () => recordedAt });
    await ledger.ensure(); const materialization = await freshMaterialization();
    await ledger.propose(materialization); const envelope = materialization.envelope;
    const retained = await ledger.review(envelope.candidate.reflectionId, {
      requestId: 'review-retain-1', expectedCandidateDigest: envelope.candidateDigest,
      decision: 'retain', currentEvidence: evidence(envelope),
      sourceProbeReceipt: await qualifiedProbe(materialization),
    });
    assert.equal(retained.candidate.candidate.state, 'reviewed');
    assert.equal(retained.reviewReceipt.reviewerKind, 'settings_runtime');
    assert.equal(retained.reviewReceipt.decision, 'retain');
    assert.equal(retained.reviewReceipt.sourceProbeReceipt.reopenedSources, envelope.recordRefs.length);
    assert.deepEqual(retained.reviewReceipt.sideEffects,
      { memoryWrites: 0, principleWrites: 0, managedCapabilityChanges: 0, externalWrites: 0 });
    const restarted = await new ReflectionLedger(ledger.directory).read();
    assert.equal(restarted.events.filter((event) => event.type === 'reflection_review_decided').length, 1);
    assert.deepEqual(restarted.reviewReceipts, [retained.reviewReceipt]);
    assert.doesNotMatch(JSON.stringify(retained.reviewReceipt),
      /reflection-safe-1|objective-1|memory-safe|subject-safe|run-1|work-1/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('human reject는 source probe 없이 expected digest CAS로 rejected만 기록한다', async () => {
  const room = await roomFor('human-reject');
  try {
    const ledger = new ReflectionLedger(join(room, 'ledger'), { clock: () => recordedAt });
    await ledger.ensure(); const materialization = await freshMaterialization();
    await ledger.propose(materialization); const envelope = materialization.envelope;
    const rejected = await ledger.review(envelope.candidate.reflectionId, {
      requestId: 'review-reject-1', expectedCandidateDigest: envelope.candidateDigest,
      decision: 'reject', currentEvidence: null, sourceProbeReceipt: null,
    });
    assert.equal(rejected.candidate.candidate.state, 'rejected');
    assert.equal(rejected.reviewReceipt.sourceProbeReceipt, null);
    assert.deepEqual(rejected.sideEffects,
      { memoryWrites: 0, principleWrites: 0, managedCapabilityChanges: 0, externalWrites: 0 });
    await assert.rejects(ledger.review(envelope.candidate.reflectionId, {
      requestId: 'bad request id', expectedCandidateDigest: envelope.candidateDigest,
      decision: 'reject', currentEvidence: null, sourceProbeReceipt: null,
    }), /opaque identity/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('review probe는 실제 reader가 만든 fresh wrapper만 한 번 소비하고 clone·scope mismatch를 거부한다', async () => {
  const room = await roomFor('human-probe-brand');
  try {
    const ledger = new ReflectionLedger(join(room, 'ledger'), { clock: () => recordedAt });
    await ledger.ensure(); const materialization = await freshMaterialization();
    await ledger.propose(materialization); const envelope = materialization.envelope;
    const probe = await qualifiedProbe(materialization);
    await assert.rejects(ledger.review(envelope.candidate.reflectionId, {
      requestId: 'review-probe-clone', expectedCandidateDigest: envelope.candidateDigest,
      decision: 'retain', currentEvidence: evidence(envelope),
      sourceProbeReceipt: structuredClone(probe),
    }), /fresh exact source probe/u);
    const wrongScope = await materializeReflectionReviewProbe({
      recordSourceReader: { async reopen(reference) { return { state: 'reopened', source: {}, accounting: {
        recordId: reference.recordId, availability: 'available', digestMatched: true,
        observedSha256: reference.sha256,
      } }; } }, recordRefs: envelope.recordRefs,
      sourceFenceDigest: envelope.sourceFence.windowDigest, affectedScopeDigest: sha('wrong-scope'),
    });
    await assert.rejects(ledger.review(envelope.candidate.reflectionId, {
      requestId: 'review-probe-scope', expectedCandidateDigest: envelope.candidateDigest,
      decision: 'retain', currentEvidence: evidence(envelope), sourceProbeReceipt: wrongScope,
    }), /qualified exact source probe/u);
    assert.equal((await ledger.read()).events.filter((event) => event.type === 'reflection_review_decided').length, 0);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('reviewed 후보의 later reject도 generic transition 없이 human receipt로 기록한다', async () => {
  const room = await roomFor('human-reviewed-reject');
  try {
    const ledger = new ReflectionLedger(join(room, 'ledger'), { clock: () => recordedAt });
    await ledger.ensure(); const materialization = await freshMaterialization();
    await ledger.propose(materialization); const envelope = materialization.envelope;
    const retained = await ledger.review(envelope.candidate.reflectionId, {
      requestId: 'review-keep-first', expectedCandidateDigest: envelope.candidateDigest,
      decision: 'retain', currentEvidence: evidence(envelope),
      sourceProbeReceipt: await qualifiedProbe(materialization),
    });
    const rejected = await ledger.review(envelope.candidate.reflectionId, {
      requestId: 'review-reject-later', expectedCandidateDigest: retained.candidate.candidateDigest,
      decision: 'reject', currentEvidence: null, sourceProbeReceipt: null,
    });
    assert.equal(rejected.candidate.candidate.state, 'rejected');
    assert.equal(rejected.reviewReceipt.beforeState, 'reviewed');
    assert.equal(rejected.reviewReceipt.reviewerKind, 'settings_runtime');
    assert.equal((await ledger.read()).reviewReceipts.length, 2);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('두 reviewer의 same-version retain/reject는 정확히 하나만 commit하고 stale loser는 덮지 않는다', async () => {
  const room = await roomFor('human-race');
  try {
    const directory = join(room, 'ledger'); const first = new ReflectionLedger(directory, { clock: () => recordedAt });
    const second = new ReflectionLedger(directory, { clock: () => recordedAt });
    await first.ensure(); const materialization = await freshMaterialization();
    await first.propose(materialization); const envelope = materialization.envelope;
    const settled = await Promise.allSettled([
      first.review(envelope.candidate.reflectionId, { requestId: 'review-race-retain',
        expectedCandidateDigest: envelope.candidateDigest, decision: 'retain',
        currentEvidence: evidence(envelope), sourceProbeReceipt: await qualifiedProbe(materialization) }),
      second.review(envelope.candidate.reflectionId, { requestId: 'review-race-reject',
        expectedCandidateDigest: envelope.candidateDigest, decision: 'reject',
        currentEvidence: null, sourceProbeReceipt: null }),
    ]);
    assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
    const failure = settled.find((item) => item.status === 'rejected').reason;
    assert.equal(failure.code, 'reflection_review_version_changed');
    const state = await first.read();
    assert.equal(state.events.filter((event) => event.type === 'reflection_review_decided').length, 1);
    assert.equal(state.reviewReceipts.length, 1);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('review requestId는 restart retry에서 같은 receipt를 반환하고 payload 충돌은 막는다', async () => {
  const room = await roomFor('human-idempotent');
  try {
    const ledger = new ReflectionLedger(join(room, 'ledger'), { clock: () => recordedAt });
    await ledger.ensure(); const materialization = await freshMaterialization();
    await ledger.propose(materialization); const envelope = materialization.envelope;
    const input = { requestId: 'review-restart-1', expectedCandidateDigest: envelope.candidateDigest,
      decision: 'retain', currentEvidence: evidence(envelope),
      sourceProbeReceipt: await qualifiedProbe(materialization) };
    const first = await ledger.review(envelope.candidate.reflectionId, input);
    const restarted = new ReflectionLedger(ledger.directory, { clock: () => recordedAt });
    const replayed = await restarted.review(envelope.candidate.reflectionId, { ...input,
      currentEvidence: null, sourceProbeReceipt: null });
    assert.equal(replayed.idempotent, true); assert.deepEqual(replayed.reviewReceipt, first.reviewReceipt);
    assert.equal((await restarted.read()).events
      .filter((event) => event.type === 'reflection_review_decided').length, 1);
    await assert.rejects(restarted.review(envelope.candidate.reflectionId, {
      requestId: input.requestId, expectedCandidateDigest: envelope.candidateDigest,
      decision: 'reject', currentEvidence: null, sourceProbeReceipt: null,
    }), (error) => error.code === 'reflection_review_request_conflict');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('retain은 missing probe·stale correction·append failure에서 review event 0을 유지한다', async () => {
  for (const mode of ['missing-probe', 'stale-correction', 'append-failure']) {
    const room = await roomFor(`human-${mode}`);
    try {
      const ledger = new ReflectionLedger(join(room, 'ledger'), { clock: () => recordedAt,
        beforeAppend: async (event) => {
          if (mode === 'append-failure' && event.type === 'reflection_review_decided') {
            throw new Error('injected review append failure');
          }
        } });
      await ledger.ensure(); const materialization = await freshMaterialization();
      await ledger.propose(materialization); const envelope = materialization.envelope;
      const current = structuredClone(evidence(envelope));
      if (mode === 'stale-correction') current.correctionHeads[0].subjectRevision += 1;
      await assert.rejects(ledger.review(envelope.candidate.reflectionId, {
        requestId: `review-${mode}`, expectedCandidateDigest: envelope.candidateDigest,
        decision: 'retain', currentEvidence: current,
        sourceProbeReceipt: mode === 'missing-probe' ? null : await qualifiedProbe(materialization),
      }), mode === 'missing-probe' ? (error) => error.code === 'current_evidence_unqualified'
        : mode === 'stale-correction' ? (error) => error.code === 'reflection_stale_source_window'
          : /injected review append failure/u);
      const state = await new ReflectionLedger(ledger.directory).read();
      assert.equal(state.candidates[0].candidate.state, 'proposed');
      assert.equal(state.events.filter((event) => event.type === 'reflection_review_decided').length, 0);
    } finally { await rm(room, { recursive: true, force: true }); }
  }
});

test('review event semantic tamper는 event digest를 다시 써도 restart에서 거부한다', async () => {
  const room = await roomFor('human-tamper');
  try {
    const ledger = new ReflectionLedger(join(room, 'ledger'), { clock: () => recordedAt });
    await ledger.ensure(); const materialization = await freshMaterialization();
    await ledger.propose(materialization); const envelope = materialization.envelope;
    await ledger.review(envelope.candidate.reflectionId, { requestId: 'review-tamper-1',
      expectedCandidateDigest: envelope.candidateDigest, decision: 'reject',
      currentEvidence: null, sourceProbeReceipt: null });
    const events = (await readFile(ledger.path, 'utf8')).trimEnd().split('\n').map(JSON.parse);
    const review = events.at(-1); review.payload.review.reviewerKind = 'background_reviewer';
    const reviewCore = { ...review.payload.review }; delete reviewCore.receiptDigest;
    review.payload.review.receiptDigest = sha(JSON.stringify(canonical(reviewCore)));
    const eventCore = { ...review }; delete eventCore.eventDigest;
    review.eventDigest = sha(JSON.stringify(canonical(eventCore)));
    await writeFile(ledger.path, `${events.map(JSON.stringify).join('\n')}\n`, 'utf8');
    await assert.rejects(new ReflectionLedger(ledger.directory).read(), /invalid Reflection review receipt/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('pure_forged_envelope_direct_ledger_propose_rejected', async () => {
  const room = await roomFor('forged-envelope');
  try {
    const ledger = new ReflectionLedger(join(room, 'ledger'), { clock: () => recordedAt });
    await ledger.ensure();
    await assert.rejects(ledger.propose(fixture()), (error) => (
      error.code === 'reflection_materialization_not_fresh'
    ));
    assert.equal((await ledger.read()).candidates.length, 0);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('materialized_counterexample_receipt_and_independent_heads_survive_restart', async () => {
  const room = await roomFor('receipt-restart');
  try {
    const ledger = new ReflectionLedger(join(room, 'ledger'), { clock: () => recordedAt });
    await ledger.ensure(); const materialization = await freshMaterialization('reflection-receipt');
    const stored = await ledger.propose(materialization);
    const restarted = await new ReflectionLedger(ledger.directory).read();
    assert.equal(restarted.reflectionEntries.length, 1);
    const entry = restarted.reflectionEntries[0];
    assert.deepEqual(entry.receipt, stored.receipt);
    assert.equal(entry.materializationDigest, stored.materializationDigest);
    assert.deepEqual(entry.counterexampleHeads, stored.counterexampleHeads);
    assert.equal(new Set(entry.counterexampleHeads.map((head) => head.workId)).size,
      entry.counterexampleHeads.length);
    assert.ok(entry.counterexampleHeads.every((head) => (
      !entry.candidate.episodes.some((episode) => episode.workId === head.workId
        || episode.runId === head.runId)
    )));
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('sequence·digest 변조와 partial JSONL line을 restart에서 거부한다', async () => {
  for (const mode of ['digest', 'partial']) {
    const room = await roomFor(mode);
    try {
      const ledger = new ReflectionLedger(join(room, 'ledger'), { clock: () => recordedAt });
      await ledger.ensure(); await ledger.propose(await freshMaterialization());
      const source = await readFile(ledger.path, 'utf8');
      if (mode === 'digest') await writeFile(ledger.path, source.replace('검증할 절차', '변조된 절차'), 'utf8');
      else await writeFile(ledger.path, `${source}{"schema":"partial"}`, 'utf8');
      await assert.rejects(new ReflectionLedger(ledger.directory).read(), /invalid .*Reflection ledger/u);
    } finally { await rm(room, { recursive: true, force: true }); }
  }
});

test('ledger directory symlink와 JSONL hardlink를 모두 거부한다', async () => {
  const room = await roomFor('links');
  try {
    const outside = join(room, 'outside');
    const real = new ReflectionLedger(outside, { clock: () => recordedAt }); await real.ensure();
    const linkedDirectory = join(room, 'linked'); await symlink(outside, linkedDirectory);
    await assert.rejects(new ReflectionLedger(linkedDirectory).read(), /unsafe/u);
    const hardlink = join(room, 'reflection-hardlink.jsonl'); await link(real.path, hardlink);
    await assert.rejects(real.read(), /unsafe/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('read 뒤 append 직전 file delete·replace는 새 file을 만들거나 commit하지 않는다', async () => {
  const room = await roomFor('replace-race');
  try {
    let ledger;
    ledger = new ReflectionLedger(join(room, 'ledger'), { clock: () => recordedAt,
      beforeAppend: async (event) => {
        if (event.type !== 'reflection_proposed') return;
        const prior = await readFile(ledger.path, 'utf8');
        await rm(ledger.path); await writeFile(ledger.path, prior, { encoding: 'utf8', mode: 0o600 });
      } });
    await ledger.ensure();
    await assert.rejects(ledger.propose(await freshMaterialization()), /compare-and-append conflict/u);
    const state = await new ReflectionLedger(ledger.directory).read();
    assert.equal(state.events.length, 1); assert.equal(state.candidates.length, 0);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('missing directory의 nearest existing parent가 symlink면 mkdir side effect 전에 거부한다', async () => {
  const room = await roomFor('parent-link');
  try {
    const outside = join(room, 'outside');
    const seed = new ReflectionLedger(outside, { clock: () => recordedAt }); await seed.ensure();
    const linkedParent = join(room, 'linked-parent'); await symlink(outside, linkedParent);
    const nested = new ReflectionLedger(join(linkedParent, 'must-not-create'), { clock: () => recordedAt });
    await assert.rejects(nested.ensure(), /(?:ancestor|intermediate path) is unsafe/u);
    assert.equal(await lstat(join(outside, 'must-not-create')).catch((error) => {
      if (error?.code === 'ENOENT') return null; throw error;
    }), null);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('intermediate_symlink_component_no_read_or_write', async () => {
  const room = await roomFor('intermediate-link');
  try {
    const outside = join(room, 'outside'); await mkdir(join(outside, 'child'), { recursive: true });
    const real = new ReflectionLedger(join(outside, 'child', 'existing-ledger'), { clock: () => recordedAt });
    await real.ensure(); await real.propose(await freshMaterialization());
    const linked = join(room, 'link'); await symlink(outside, linked);

    const readThroughIntermediate = new ReflectionLedger(join(linked, 'child', 'existing-ledger'));
    await assert.rejects(readThroughIntermediate.read(), /intermediate path is unsafe/u);

    const writeThroughIntermediate = new ReflectionLedger(join(linked, 'child', 'new-ledger'), {
      clock: () => recordedAt,
    });
    await assert.rejects(writeThroughIntermediate.ensure(), /intermediate path is unsafe/u);
    assert.equal(await lstat(join(outside, 'child', 'new-ledger')).catch((error) => {
      if (error?.code === 'ENOENT') return null; throw error;
    }), null);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('외부 anchor가 없어 valid final truncation은 탐지 자격을 주장하지 않는다', async () => {
  const room = await roomFor('valid-truncation');
  try {
    const ledger = new ReflectionLedger(join(room, 'ledger'), { clock: () => recordedAt });
    await ledger.ensure(); await ledger.propose(await freshMaterialization());
    const lines = (await readFile(ledger.path, 'utf8')).trimEnd().split('\n');
    await writeFile(ledger.path, `${lines[0]}\n`, 'utf8');
    const truncated = await new ReflectionLedger(ledger.directory).read();
    assert.equal(truncated.events.length, 1); assert.equal(truncated.candidates.length, 0);
    assert.equal(truncated.truncationQualified, false); assert.equal(truncated.anchoredHead, false);
    assert.equal(truncated.pathChmodReplacementRaceQualified, false);
    assert.ok(truncated.knownLimitations.includes('path_chmod_replacement_race_unqualified'));
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('writer clock은 canonical UTC가 아니면 event 생성 전에 거부한다', async () => {
  const room = await roomFor('clock');
  try {
    const ledger = new ReflectionLedger(join(room, 'ledger'), {
      clock: () => '2026-08-27T00:00:00+00:00',
    });
    await assert.rejects(ledger.ensure(), /canonical UTC/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('append write failure는 반환·projection·restart state를 proposed 이전 그대로 유지한다', async () => {
  const room = await roomFor('write-failure');
  try {
    const ledger = new ReflectionLedger(join(room, 'ledger'), { clock: () => recordedAt,
      beforeAppend: async (event) => {
        if (event.type === 'reflection_proposed') throw new Error('injected append failure');
      } });
    await ledger.ensure();
    await assert.rejects(ledger.propose(await freshMaterialization()), /injected append failure/u);
    const restarted = await new ReflectionLedger(ledger.directory).read();
    assert.equal(restarted.events.length, 1); assert.equal(restarted.candidates.length, 0);
    assert.deepEqual(restarted.productProjection, []);
    assert.equal(restarted.publicationQualified, false);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('Turn 2B store는 제품·Memory·Principle·managed capability에 연결되지 않는다', async () => {
  const [consoleServer, memoryTool, learningReview] = await Promise.all([
    readFile(new URL('../src/console-server.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/memory-tool.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/learning-review.js', import.meta.url), 'utf8'),
  ]);
  for (const source of [consoleServer, memoryTool, learningReview]) {
    assert.doesNotMatch(source, /reflection-ledger/u);
  }
});
