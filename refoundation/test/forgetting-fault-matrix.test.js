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

const reference = (id) => makeRecordReference({
  sourceKind: 'conversation_message', sourceStore: 'conversation-ledger', sourceId: id,
  sourceRevision: 1, sha256: createHash('sha256').update(id).digest('hex'),
  occurredAt: '2026-08-26T00:00:00.000Z', recordedAt: '2026-08-26T00:00:01.000Z',
  scope: { sessionId: 'session-1', workId: null, subjectKeys: [], channel: 'console' },
  trust: 'user_asserted', sensitivity: 'personal', coverage: 'full', availability: 'available',
});

async function setup(room, options = {}) {
  const ledger = new MemoryLedger(join(room, 'memory')); await ledger.ensure();
  await ledger.commitClaim({ claim: makeMemoryClaim({
    memoryId: 'memory-1', kind: 'fact', subjectKey: 'subject-1', value: 'safe value',
    scope: { global: true, workId: null, projectId: null, personId: 'person:owner', organizationId: null },
    sources: [reference('source-1')], recordedAt: '2026-08-26T00:01:00.000Z',
    validFrom: '2026-01-01T00:00:00.000Z', validTo: '2027-01-01T00:00:00.000Z',
    subjectRevision: 1, sourceOrder: 2, status: 'active', supersedes: [], conflictsWith: [],
    sensitivity: 'personal', alwaysRelevant: false,
  }) });
  return { ledger, coordinator: new ForgettingCoordinator({
    memoryLedger: ledger, makeId: () => 'forget-fault', now: () => '2026-08-26T07:00:00.000Z',
    ...options,
  }) };
}

test('index·Library 실패와 external unknown은 memory retract 성공과 합쳐지지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-forget-faults-'));
  try {
    const { coordinator } = await setup(room, { derivedAdapters: {
      fts: { preview: async () => ({ action: 'delete' }),
        settle: async () => ({ state: 'retained', reason: 'index_delete_failed' }), probe: async () => 1 },
      library_view: { preview: async () => ({ action: 'rebuild' }),
        settle: async () => { throw new Error('library private failure'); } },
      external_copy: { preview: async () => ({ action: 'unknown' }) },
    } });
    const plan = await coordinator.preview({ memoryIds: ['memory-1'], subjectKeys: [], scopeIds: [] });
    const result = await coordinator.execute({ plan, recordRefs: [reference('forget-request')] });
    assert.deepEqual(result.receipt.executedTargets, ['memory:memory-1']);
    assert.deepEqual(result.receipt.unknownTargets, ['external_copy:memory-1']);
    assert.deepEqual(result.receipt.retainedTargets, [
      { id: 'fts:memory-1', reason: 'index_delete_failed' },
      { id: 'library_view:memory-1', reason: 'adapter_failed' },
    ]);
    assert.equal(result.receipt.searchHitAfter, null,
      'Library deletion without a probe keeps aggregate search absence unknown');
    assert.equal(result.receipt.behaviorProbeAfter, 'unknown');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('backup unknown은 local retract를 가능하게 해도 reversibleUntil을 발명하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-forget-backup-'));
  try {
    const { coordinator } = await setup(room, { backupAvailable: null });
    const plan = await coordinator.preview({ memoryIds: ['memory-1'], subjectKeys: [], scopeIds: [] });
    assert.equal(plan.backupAvailable, null);
    const result = await coordinator.execute({ plan, recordRefs: [reference('forget-request')] });
    assert.equal(result.receipt.reversibleUntil, null);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('memory effect 뒤 crash는 restart에서 remove를 반복하지 않고 unsettled target만 재개한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-forget-crash-'));
  try {
    let indexEffects = 0;
    const adapter = { preview: async () => ({ action: 'delete' }),
      settle: async () => { indexEffects += 1; return { state: 'executed' }; }, probe: async () => 0 };
    const { ledger, coordinator } = await setup(room, { derivedAdapters: { fts: adapter } });
    const plan = await coordinator.preview({ memoryIds: ['memory-1'], subjectKeys: [], scopeIds: [] });
    await assert.rejects(coordinator.execute({
      plan, recordRefs: [reference('forget-request')], crashAfterEffectHandle: 'memory:memory-1',
    }), /injected crash/u);
    const afterCrash = await ledger.read();
    assert.equal(afterCrash.events.filter((event) => event.type === 'memory_removed').length, 1);
    assert.equal(afterCrash.tombstones.length, 1);
    const restarted = new ForgettingCoordinator({
      memoryLedger: new MemoryLedger(join(room, 'memory')),
      derivedAdapters: { fts: adapter }, now: () => '2026-08-26T07:01:00.000Z',
    });
    const resumed = await restarted.resume({ requestId: 'forget-fault' });
    assert.deepEqual(resumed.receipt.executedTargets, ['memory:memory-1', 'fts:memory-1']);
    assert.equal(indexEffects, 1);
    assert.equal((await restarted.memoryLedger.read()).events
      .filter((event) => event.type === 'memory_removed').length, 1);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('derived effect 뒤 crash도 idempotent adapter와 target settlement로 exact-once가 된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-forget-derived-crash-'));
  try {
    const effects = new Set(); let attempts = 0;
    const adapter = { preview: async () => ({ action: 'delete' }),
      settle: async ({ target }) => { attempts += 1; effects.add(target.id); return { state: 'executed' }; },
      probe: async () => 0 };
    const { ledger, coordinator } = await setup(room, { derivedAdapters: { fts: adapter } });
    const plan = await coordinator.preview({ memoryIds: ['memory-1'], subjectKeys: [], scopeIds: [] });
    await assert.rejects(coordinator.execute({
      plan, recordRefs: [reference('forget-request')], crashAfterEffectHandle: 'fts:memory-1',
    }), /injected crash/u);
    const restarted = new ForgettingCoordinator({
      memoryLedger: new MemoryLedger(join(room, 'memory')), derivedAdapters: { fts: adapter },
      now: () => '2026-08-26T07:01:00.000Z',
    });
    const resumed = await restarted.resume({ requestId: 'forget-fault' });
    assert.equal(resumed.receipt.searchHitAfter, 0);
    assert.equal(effects.size, 1);
    assert.equal(attempts, 2, 'adapter call may repeat but its fenced effect remains exact-once');
  } finally { await rm(room, { recursive: true, force: true }); }
});
