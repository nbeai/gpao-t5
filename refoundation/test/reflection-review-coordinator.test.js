import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeRecordReference } from '../src/record-reference.js';
import {
  calculateReflectionSourceFence,
  makeReflectionCandidateEnvelope,
  transitionReflectionCandidate,
} from '../src/reflection-candidate.js';
import { makeReflectionReviewCurrentEvidenceObserver,
  ReflectionReviewCoordinator } from '../src/reflection-review-coordinator.js';
import { ReflectionSourceWindowCoordinator } from '../src/reflection-source-window-coordinator.js';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort()
    .map((key) => [key, canonical(value[key])])) : value;
const digestObject = (value) => sha(JSON.stringify(canonical(value)));
const at = '2026-08-27T00:00:00.000Z';

function reference(name, sourceKind, trust = 'runtime_observed') {
  return makeRecordReference({ sourceKind, sourceStore: `${sourceKind}-PRIVATE-STORE`,
    sourceId: `PRIVATE-SOURCE-${name}`, sourceRevision: 1, sha256: sha(name),
    occurredAt: at, recordedAt: at,
    scope: { sessionId: `PRIVATE-SESSION-${name}`, workId: `PRIVATE-WORK-${name}`,
      subjectKeys: ['PRIVATE-SUBJECT'], channel: 'private' }, trust, sensitivity: 'personal',
    coverage: 'full', availability: 'available' });
}

function fixtureEntry() {
  const refs = {
    objective1: reference('objective-1', 'conversation_message', 'user_asserted'),
    method1: reference('method-1', 'run_event'), effect1: reference('effect-1', 'run_event'),
    completion1: reference('completion-1', 'work_event'),
    objective2: reference('objective-2', 'conversation_message', 'user_asserted'),
    method2: reference('method-2', 'run_event'), effect2: reference('effect-2', 'run_event'),
    completion2: reference('completion-2', 'work_event'),
    correction: reference('correction', 'conversation_message', 'user_asserted'),
    counterexample: reference('counterexample', 'web_source', 'external_untrusted'),
  };
  const roles = (number) => ({ objectiveRecordIds: [refs[`objective${number}`].recordId],
    methodRecordIds: [refs[`method${number}`].recordId],
    effectSettlementRecordIds: [refs[`effect${number}`].recordId],
    completionRecordIds: [refs[`completion${number}`].recordId] });
  const episodes = [1, 2].map((number) => ({ episodeId: `PRIVATE-EPISODE-${number}`,
    workId: `PRIVATE-WORK-${number}`, workRevision: 1, runId: `PRIVATE-RUN-${number}`,
    resultDigest: sha(`result-${number}`), outcome: 'achieved', recordRoles: roles(number) }));
  const sourceRecordIds = [refs.objective1, refs.method1, refs.effect1, refs.completion1,
    refs.objective2, refs.method2, refs.effect2, refs.completion2].map((item) => item.recordId);
  const correctionHeads = [{ memoryId: 'PRIVATE-MEMORY', subjectKey: 'PRIVATE-SUBJECT',
    subjectRevision: 2, sourceOrder: 3, status: 'active',
    sourceRecordIds: [refs.correction.recordId] }];
  const forgetHeads = [{ scopeHandle: 'PRIVATE-SCOPE-HANDLE', epoch: 0,
    lastForgetRequestId: null, tombstoneDigest: null }];
  const recordRefs = Object.values(refs);
  const fence = calculateReflectionSourceFence({ affectedScopeHandles: ['PRIVATE-SCOPE-HANDLE'],
    episodes, recordRefs, correctionHeads, forgetHeads });
  const candidate = makeReflectionCandidateEnvelope({ reflectionId: 'PRIVATE-REFLECTION-ID',
    hypothesis: '현재 결과를 먼저 확인하면 중복 실행을 줄일 수 있다는 잠정적 방법',
    sourceEpisodeIds: episodes.map((item) => item.episodeId), sourceRecordIds,
    counterexampleRecordIds: [refs.counterexample.recordId], affectedScopes: ['PRIVATE-SCOPE-HANDLE'],
    createdBy: 'background_reviewer', episodes, recordRefs, correctionHeads,
    correctionRelations: [{ memoryId: 'PRIVATE-MEMORY', relation: 'preserved' }], forgetHeads,
    counterexampleSearch: { state: 'found', recordIds: [refs.counterexample.recordId],
      sourceWindowDigest: fence.windowDigest }, unknowns: ['다른 작업군은 아직 모른다.'] });
  const scopeHead = { handle: 'PRIVATE-SCOPE-HANDLE', sessionId: 'PRIVATE-SESSION',
      workId: 'PRIVATE-WORK-SCOPE', subjectKeys: ['PRIVATE-SUBJECT'], channel: 'private',
      headDigest: sha('scope-head') };
  return { candidate, materializationDigest: sha('materialization'), materialization: {
    receipt: { schema: 't5.reflection-materialization-receipt.v2' } }, receipt: {
    schema: 't5.reflection-materialization-receipt.v2', affectedScopeHeads: [scopeHead],
    affectedScopeDigest: sha(JSON.stringify([scopeHead])),
    counterexampleSearch: { heads: [{ recordId: refs.counterexample.recordId }] },
    reopenAccountingRecords: recordRefs.map((item) => ({ recordId: item.recordId,
      availability: 'available', digestMatched: true })),
  } };
}

function currentEvidence(candidate) {
  return { affectedScopeHandles: candidate.candidate.affectedScopes,
    episodes: candidate.episodes, recordRefs: candidate.recordRefs,
    correctionHeads: candidate.correctionHeads, forgetHeads: candidate.sourceFence.forgetHeads };
}

class FakeLedger {
  constructor(entry = fixtureEntry()) {
    this.entry = entry; this.reviewCalls = []; this.writes = 0; this.requests = new Map();
  }
  async propose() { throw new Error('not used by review fixture'); }
  async read() { return { reflectionEntries: [structuredClone(this.entry)],
    reviewReceipts: [...this.requests.values()].map((item) => structuredClone(item.result.reviewReceipt)) }; }
  async review(reflectionId, input) {
    this.reviewCalls.push({ reflectionId, decision: input.decision });
    const prior = this.requests.get(input.requestId);
    const fingerprint = JSON.stringify({ reflectionId, expected: input.expectedCandidateDigest,
      decision: input.decision });
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw Object.assign(new Error('conflict'), {
        code: 'reflection_review_request_conflict' });
      return structuredClone({ ...prior.result, idempotent: true });
    }
    if (this.entry.candidate.candidateDigest !== input.expectedCandidateDigest
      || (input.decision === 'retain' ? this.entry.candidate.candidate.state !== 'proposed'
        : !['proposed', 'reviewed'].includes(this.entry.candidate.candidate.state))) {
      throw Object.assign(new Error('changed'), { code: 'reflection_review_version_changed' });
    }
    if (input.decision === 'retain' && (!input.currentEvidence || !input.sourceProbeReceipt)) {
      throw Object.assign(new Error('unqualified'), { code: 'current_evidence_unqualified' });
    }
    const transitioned = transitionReflectionCandidate(this.entry.candidate, {
      to: input.decision === 'retain' ? 'reviewed' : 'rejected',
      currentEvidence: input.currentEvidence,
    });
    this.entry.candidate = transitioned; this.writes += 1;
    const reviewReceipt = { requestId: input.requestId, decision: input.decision,
      beforeCandidateDigest: input.expectedCandidateDigest,
      sourceProbeReceipt: input.sourceProbeReceipt?.receipt ?? null,
      sideEffects: { memoryWrites: 0, principleWrites: 0,
        managedCapabilityChanges: 0, externalWrites: 0 } };
    const result = { candidate: transitioned, materialization: this.entry.materialization,
      materializationDigest: this.entry.materializationDigest, receipt: this.entry.receipt,
      reviewReceipt, idempotent: false };
    this.requests.set(input.requestId, { fingerprint, result: structuredClone(result) });
    return structuredClone(result);
  }
}

function setup({ observer = null, readerMutation = null } = {}) {
  const ledger = new FakeLedger(); let sourceReads = 0; let observerCalls = 0;
  const room = mkdtempSync(join(tmpdir(), 't5-review-coordinator-'));
  ledger.directory = join(room, 'reflection'); mkdirSync(ledger.directory);
  const recordSourceReader = { async reopen(reference) {
    sourceReads += 1; const mutation = readerMutation?.(reference, sourceReads);
    if (mutation) return mutation;
    return { state: 'reopened', source: reference.sourceKind === 'conversation_message'
      ? { message: { content: '사용자가 확인할 수 있는 대화 내용' } }
      : { userSafeSummary: '안전하게 요약한 근거' }, accounting: {
      recordId: reference.recordId, availability: 'available', digestMatched: true,
      observedSha256: reference.sha256,
    } };
  } };
  const names = ['conversation', 'memory', 'run', 'work'];
  const storeBindings = Object.fromEntries(names.map((name) => {
    const directory = join(room, name); mkdirSync(directory);
    return [name, { store: { directory }, foregroundParticipating: true }];
  }));
  const sourceWindowCoordinator = new ReflectionSourceWindowCoordinator({ ledger,
    requiredStores: names, storeBindings, materialize: async () => null,
    enumerateSourceWindow: async ({ epoch, writerRegistrations }) => {
      const heads = writerRegistrations.map((item) => ({ store: item.store,
        headDigest: sha(`head:${item.store}:${epoch}`),
        writerRegistrationDigest: item.writerRegistrationDigest }))
        .toSorted((left, right) => left.store.localeCompare(right.store));
      const schema = 't5.reflection-store-head-receipt.v1';
      return { runtimeSnapshot: {}, episodeAllowlist: [],
        recordSourceReader: { async reopen() { return null; } },
        storeHeadReceipt: { schema, epoch, heads,
          receiptDigest: digestObject({ schema, epoch, heads }) } };
    } });
  const currentEvidenceObserver = makeReflectionReviewCurrentEvidenceObserver({
    sourceWindowCoordinator, observe: async () => {
    observerCalls += 1;
    const base = {
      currentEvidence: structuredClone(currentEvidence(ledger.entry.candidate)),
      currentAffectedScopeHeads: structuredClone(ledger.entry.receipt.affectedScopeHeads),
      currentAffectedScopeDigest: ledger.entry.receipt.affectedScopeDigest,
    };
    const observed = observer ? { ...base, ...(await observer({}, ledger.entry.candidate)) } : base;
    return observed;
  } });
  const coordinator = new ReflectionReviewCoordinator({ ledger, recordSourceReader,
    currentEvidenceObserver });
  return { coordinator, ledger, reads: () => sourceReads, observerCalls: () => observerCalls };
}

test('list·detail은 hypothesis만 보여주고 모든 canonical provenance를 opaque handle로 가린다', async () => {
  const { coordinator, ledger } = setup(); const listed = await coordinator.list();
  assert.equal(listed.items.length, 1); assert.equal(listed.sideEffects.writes, 0);
  assert.match(listed.items[0].reviewHandle, /^review_[A-Za-z0-9_-]{22}$/u);
  assert.match(listed.items[0].revisionHandle, /^revision_[A-Za-z0-9_-]{22}$/u);
  const detailed = await coordinator.detail({ reviewHandle: listed.items[0].reviewHandle });
  const sources = detailed.item.support.flatMap((episode) => episode.sourceGroups.flatMap((group) => group.sources));
  assert.ok(sources.length > 0);
  assert.ok(sources.every((source) => /^source_[A-Za-z0-9_-]{22}$/u.test(source.sourceHandle)));
  const serialized = JSON.stringify({ listed, detailed });
  assert.doesNotMatch(serialized,
    /PRIVATE-(?:REFLECTION|MEMORY|SUBJECT|SOURCE|SESSION|WORK|RUN|EPISODE|SCOPE)|recordId|sourceStore|sourceId|subjectKey/u);
  assert.match(serialized, /잠정적 방법/u);
});

test('source는 exact opaque handle 하나만 reopen하고 canonical ID 없이 safe content를 낸다', async () => {
  const { coordinator, reads } = setup(); const item = (await coordinator.detail({
    reviewHandle: (await coordinator.list()).items[0].reviewHandle })).item;
  const source = item.support[0].sourceGroups[0].sources[0];
  const result = await coordinator.source({ reviewHandle: item.reviewHandle,
    sourceHandle: source.sourceHandle });
  assert.equal(reads(), 1); assert.equal(result.source.state, 'available');
  assert.equal(result.sideEffects.writes, 0);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-|recordId|sourceStore|sourceId/u);
  await assert.rejects(coordinator.source({ reviewHandle: item.reviewHandle,
    sourceHandle: `source_${'0'.repeat(22)}` }), (failure) => failure.code === 'reflection_source_not_found');
});

test('later는 expected opaque version을 확인하고 Reflection write도 만들지 않는다', async () => {
  const { coordinator, ledger } = setup(); const item = (await coordinator.list()).items[0];
  const result = await coordinator.later({ reviewHandle: item.reviewHandle, revisionHandle: item.revisionHandle });
  assert.equal(result.decision, 'unchanged'); assert.equal(result.applied, false);
  assert.equal(ledger.writes, 0);
  await assert.rejects(coordinator.later({ reviewHandle: item.reviewHandle,
    revisionHandle: item.revisionHandle.replace(/.$/u, '0') }),
  (failure) => failure.code === 'reflection_review_version_changed');
});

test('reject는 source·observer를 쓰지 않고 ledger atomic review와 restart-style idempotency를 소비한다', async () => {
  const { coordinator, ledger, reads, observerCalls } = setup(); const item = (await coordinator.list()).items[0];
  const input = { requestId: 'review-reject-safe', reviewHandle: item.reviewHandle,
    revisionHandle: item.revisionHandle };
  const first = await coordinator.reject(input); const retry = await coordinator.reject(input);
  assert.equal(first.item.status, 'not_used'); assert.equal(retry.idempotent, true);
  assert.equal(ledger.writes, 1); assert.equal(reads(), 0); assert.equal(observerCalls(), 0);
  assert.deepEqual(first.sideEffects,
    { memoryWrites: 0, principleWrites: 0, managedCapabilityChanges: 0, externalWrites: 0 });
});

test('retain은 scope/correction/forget fence를 먼저 재관측한 뒤 모든 source를 exact reopen한다', async () => {
  const { coordinator, ledger, reads, observerCalls } = setup(); const item = (await coordinator.list()).items[0];
  const result = await coordinator.retain({ requestId: 'review-retain-safe',
    reviewHandle: item.reviewHandle, revisionHandle: item.revisionHandle });
  assert.equal(result.item.status, 'kept_for_review'); assert.equal(observerCalls(), 1);
  assert.equal(reads(), ledger.entry.candidate.recordRefs.length);
  assert.equal(ledger.writes, 1);
  const retryReads = reads(); const retry = await coordinator.retain({ requestId: 'review-retain-safe',
    reviewHandle: item.reviewHandle, revisionHandle: item.revisionHandle });
  assert.equal(retry.idempotent, true); assert.equal(reads(), retryReads);
});

test('forget/correction stale은 source content를 하나도 열지 않고 retain append 0이다', async () => {
  const { coordinator, ledger, reads } = setup({ observer: (_input, candidate) => {
    const current = structuredClone(currentEvidence(candidate)); current.forgetHeads[0].epoch += 1;
    return { currentEvidence: current };
  } });
  const item = (await coordinator.list()).items[0];
  await assert.rejects(coordinator.retain({ requestId: 'review-stale-safe',
    reviewHandle: item.reviewHandle, revisionHandle: item.revisionHandle }),
  (failure) => failure.code === 'reflection_source_window_stale');
  assert.equal(reads(), 0); assert.equal(ledger.writes, 0);
});

test('missing·changed·permission·unknown source는 retain append 0으로 정확히 분리한다', async () => {
  for (const state of ['missing', 'changed', 'permission_denied', 'unknown']) {
    const fixture = setup({ readerMutation: (_reference, index) => index === 1
      ? { state, source: null, accounting: { availability: state } } : null });
    const item = (await fixture.coordinator.list()).items[0];
    await assert.rejects(fixture.coordinator.retain({ requestId: `review-source-${state}`,
      reviewHandle: item.reviewHandle, revisionHandle: item.revisionHandle }),
    (failure) => failure.code === `reflection_review_source_${state}`);
    assert.equal(fixture.ledger.writes, 0);
  }
});

test('foreign handle·unknown field·same version race는 ledger write 전에 fail closed한다', async () => {
  const { coordinator, ledger } = setup(); const item = (await coordinator.list()).items[0];
  await assert.rejects(coordinator.detail({ reviewHandle: item.reviewHandle, reflectionId: 'forged' }),
    /unknown fields/u);
  await assert.rejects(coordinator.reject({ requestId: 'foreign-safe',
    reviewHandle: `review_${'0'.repeat(22)}`, revisionHandle: item.revisionHandle }),
  (failure) => failure.code === 'reflection_review_not_found');
  await coordinator.reject({ requestId: 'winner-safe', reviewHandle: item.reviewHandle,
    revisionHandle: item.revisionHandle });
  await assert.rejects(coordinator.reject({ requestId: 'loser-safe', reviewHandle: item.reviewHandle,
    revisionHandle: item.revisionHandle }), (failure) => failure.code === 'reflection_review_version_changed');
  assert.equal(ledger.writes, 1);
});

test('review coordinator는 Principle·Skill·Memory·product server에 연결되지 않는다', async () => {
  const source = await readFile(new URL('../src/reflection-review-coordinator.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source,
    /from\s+['"][^'"]*(?:principle|skill|memory-ledger|capability|console-server)[^'"]*['"]/iu);
});

test('duck-typed stable window는 observer brand를 받을 수 없다', () => {
  assert.throws(() => makeReflectionReviewCurrentEvidenceObserver({
    sourceWindowCoordinator: { async withStableRead() { return null; } }, observe: async () => ({}),
  }), /source-window coordinator/u);
});
