import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ForgettingCoordinator } from '../src/forgetting-coordinator.js';
import { MemoryLedger } from '../src/memory-ledger.js';
import { makeRecordReference } from '../src/record-reference.js';
import { makeMemoryClaim } from '../src/temporal-memory.js';

const ref = (id) => makeRecordReference({
  sourceKind: 'conversation_message', sourceStore: 'conversation-ledger', sourceId: id,
  sourceRevision: 1, sha256: createHash('sha256').update(id).digest('hex'),
  occurredAt: '2026-08-26T00:00:00.000Z', recordedAt: '2026-08-26T00:00:01.000Z',
  scope: { sessionId: 'session-1', workId: null, subjectKeys: [], channel: 'console' },
  trust: 'user_asserted', sensitivity: 'personal', coverage: 'full', availability: 'available',
});
const claim = (id, subject, order, revision = 1) => makeMemoryClaim({
  memoryId: id, kind: 'preference', subjectKey: subject, value: `${subject} value`,
  scope: { global: true, workId: null, projectId: null, personId: `person:${id}`, organizationId: null },
  sources: [ref(`source-${id}`)], recordedAt: `2026-08-26T00:0${order}:00.000Z`,
  validFrom: '2026-01-01T00:00:00.000Z', validTo: '2027-01-01T00:00:00.000Z',
  subjectRevision: revision, sourceOrder: order, status: 'active', supersedes: [], conflictsWith: [],
  sensitivity: 'personal', alwaysRelevant: false,
});

async function fixture(room) {
  const ledger = new MemoryLedger(join(room, 'memory')); await ledger.ensure();
  await ledger.commitClaim({ claim: claim('memory-a', 'person:alex:a', 2) });
  await ledger.commitClaim({ claim: claim('memory-b', 'person:alex:b', 3) });
  const coordinator = new ForgettingCoordinator({
    memoryLedger: ledger, makeId: () => 'forget-1', now: () => '2026-08-26T06:00:00.000Z',
  });
  return { ledger, coordinator };
}

test('preview는 exact memory identity와 current subject revision을 digest에 결속한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-forget-preview-'));
  try {
    const { coordinator } = await fixture(room);
    const plan = await coordinator.preview({ memoryIds: ['memory-a'], subjectKeys: [], scopeIds: [] });
    assert.equal(plan.requestId, 'forget-1');
    assert.deepEqual(plan.targets, [
      { kind: 'memory', id: 'memory-a', action: 'retract', revision: 1 },
    ]);
    assert.equal(plan.backupAvailable, true);
    assert.match(plan.previewDigest, /^[a-f0-9]{64}$/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('preview 뒤 target revision이 바뀌면 execute는 append 0으로 re-preview를 요구한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-forget-cas-'));
  try {
    const { ledger, coordinator } = await fixture(room);
    const plan = await coordinator.preview({ memoryIds: ['memory-a'], subjectKeys: [], scopeIds: [] });
    await ledger.commitClaim({ claim: makeMemoryClaim({
      ...claim('memory-a2', 'person:alex:a', 4, 2), supersedes: ['memory-a'],
    }) });
    const before = (await ledger.read()).events.length;
    const result = await coordinator.execute({ plan, recordRefs: [ref('forget-request')] });
    assert.equal(result.state, 'revision_changed');
    assert.equal(result.receipt, null);
    assert.equal((await ledger.read()).events.length, before);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('exact forget은 target만 retract하고 동명이인·unrelated claim 손실은 0이다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-forget-exact-'));
  try {
    const { ledger, coordinator } = await fixture(room);
    const plan = await coordinator.preview({ memoryIds: ['memory-a'], subjectKeys: [], scopeIds: [] });
    const result = await coordinator.execute({ plan, recordRefs: [ref('forget-request')] });
    assert.equal(result.state, 'executed');
    assert.deepEqual(result.receipt.executedTargets, ['memory:memory-a']);
    assert.equal(result.receipt.searchHitAfter, null);
    assert.equal(result.receipt.behaviorProbeAfter, 'unknown');
    const state = await ledger.read();
    assert.deepEqual(state.items.map((item) => item.memoryId), ['memory-b']);
    assert.deepEqual(state.claims.map((item) => [item.memoryId, item.status]), [
      ['memory-a', 'retracted'], ['memory-b', 'active'],
    ]);
    assert.equal(state.tombstones[0].requestId, 'forget-1');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('recoverable window 안 restore는 exact inverse event로 같은 claim을 새 revision에 복원한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-forget-restore-'));
  try {
    const { ledger, coordinator } = await fixture(room);
    const plan = await coordinator.preview({ memoryIds: ['memory-a'], subjectKeys: [], scopeIds: [] });
    await coordinator.execute({ plan, recordRefs: [ref('forget-request')] });
    const restored = await coordinator.restore({
      requestId: 'forget-1', memoryId: 'memory-a', recordRefs: [ref('restore-request')],
    });
    assert.equal(restored.state, 'restored');
    const state = await ledger.read();
    assert.equal(state.items.some((item) => item.memoryId === 'memory-a'), true);
    assert.equal(state.claims.find((item) => item.memoryId === 'memory-a').status, 'active');
    assert.equal(state.tombstones.length, 0);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('active tombstone은 stale background source로 같은 subject를 재도입하지 못하게 한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-forget-fence-'));
  try {
    const { ledger, coordinator } = await fixture(room);
    const plan = await coordinator.preview({ memoryIds: ['memory-a'], subjectKeys: [], scopeIds: [] });
    await coordinator.execute({ plan, recordRefs: [ref('forget-request')] });
    await assert.rejects(ledger.commitClaim({ claim: claim('memory-stale', 'person:alex:a', 5, 2) }),
      /tombstone/u);
    assert.equal((await ledger.read()).items.some((item) => item.memoryId === 'memory-stale'), false);
  } finally { await rm(room, { recursive: true, force: true }); }
});
