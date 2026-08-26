import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MemoryLedger } from '../src/memory-ledger.js';
import { currentUserMemoryCandidates } from '../src/memory-portfolio.js';
import { makeRecordReference } from '../src/record-reference.js';
import { makeMemoryClaim } from '../src/temporal-memory.js';

const source = (id = 'source-1') => makeRecordReference({
  sourceKind: 'conversation_message', sourceStore: 'conversation-ledger', sourceId: id,
  sourceRevision: 1, sha256: createHash('sha256').update(id).digest('hex'),
  occurredAt: '2026-08-26T00:00:00.000Z', recordedAt: '2026-08-26T00:00:01.000Z',
  scope: { sessionId: 'session-1', workId: null, subjectKeys: [], channel: 'console' },
  trust: 'user_asserted', sensitivity: 'personal', coverage: 'full', availability: 'available',
});
const claim = (overrides = {}) => makeMemoryClaim({
  memoryId: 'memory-1', kind: 'preference', subjectKey: 'person:owner:coffee',
  value: 'prefers filter coffee',
  scope: { global: true, workId: null, projectId: null, personId: 'person:owner', organizationId: null },
  sources: [source()], recordedAt: '2026-08-26T00:01:00.000Z',
  validFrom: '2026-08-01T00:00:00.000Z', validTo: '2027-08-01T00:00:00.000Z',
  subjectRevision: 1, sourceOrder: 2, status: 'active', supersedes: [], conflictsWith: [],
  sensitivity: 'personal', alwaysRelevant: false, ...overrides,
});

function legacyProjection(events) {
  const current = new Map();
  for (const event of events) {
    if (event.type === 'memory_added') current.set(event.memoryId, {
      memoryId: event.memoryId, kind: event.kind, content: event.content,
      subjects: event.subjects ?? [], alwaysRelevant: event.alwaysRelevant === true,
      subjectRevision: Number(event.subjectRevision ?? 1),
      sourceOrder: Number(event.sourceOrder ?? event.sequence), source: event.source ?? null,
      createdAt: event.recordedAt, updatedAt: event.recordedAt,
    });
    if (event.type === 'memory_removed') current.delete(event.memoryId);
  }
  return [...current.values()];
}

test('MemoryClaim은 기존 memory event에 optional temporal·recordRefs로 한 번 append된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-memory-claim-ledger-'));
  try {
    const ledger = new MemoryLedger(room); await ledger.ensure();
    const committed = await ledger.commitClaim({ claim: claim() });
    assert.equal(committed.memoryId, 'memory-1');
    const state = await ledger.read();
    assert.equal(state.events.length, 2);
    assert.equal(state.events[1].schema, 't5.memory-event.v1');
    assert.equal(state.events[1].type, 'memory_added');
    assert.equal(state.events[1].temporal.claimKind, 'preference');
    assert.equal(state.events[1].recordRefs[0].recordId, source().recordId);
    assert.equal(state.items[0].content, 'prefers filter coffee');
    assert.equal(state.items[0].temporal.validFrom, '2026-08-01T00:00:00.000Z');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('legacy add·replace에는 새 필드를 강제하지 않고 기존 행동을 보존한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-memory-legacy-add-'));
  try {
    const ledger = new MemoryLedger(room); await ledger.ensure();
    const added = await ledger.add({ kind: 'user', content: 'legacy safe fixture', subjects: ['legacy'] });
    await ledger.replace({ memoryId: added.memoryId, content: 'legacy changed fixture' });
    const state = await ledger.read(); const last = state.events.at(-1);
    assert.equal('temporal' in last, false);
    assert.equal('recordRefs' in last, false);
    assert.equal(state.items[0].content, 'legacy changed fixture');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('correction은 새 claim과 supersedes를 한 event에 원자 append하고 current만 교체한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-memory-claim-correct-'));
  try {
    const ledger = new MemoryLedger(room); await ledger.ensure();
    await ledger.commitClaim({ claim: claim() });
    const corrected = claim({
      memoryId: 'memory-2', value: 'prefers light roast', sources: [source('source-2')],
      recordedAt: '2026-08-26T00:02:00.000Z', subjectRevision: 2, sourceOrder: 3,
      supersedes: ['memory-1'],
    });
    await ledger.commitClaim({ claim: corrected });
    const state = await ledger.read();
    assert.equal(state.events.length, 3);
    assert.deepEqual(state.events[2].temporal.supersedes, ['memory-1']);
    assert.deepEqual(state.items.map((item) => item.memoryId), ['memory-2']);
    assert.equal(state.items[0].content, 'prefers light roast');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('stale subjectRevision·sourceOrder와 없는 supersedes target은 append 전에 닫힌다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-memory-claim-cas-'));
  try {
    const ledger = new MemoryLedger(room); await ledger.ensure(); await ledger.commitClaim({ claim: claim() });
    await assert.rejects(ledger.commitClaim({ claim: claim({
      memoryId: 'memory-stale', sourceOrder: 3,
    }) }), /subjectRevision/u);
    await assert.rejects(ledger.commitClaim({ claim: claim({
      memoryId: 'memory-order', subjectRevision: 2, sourceOrder: 99,
    }) }), /sourceOrder/u);
    await assert.rejects(ledger.commitClaim({ claim: claim({
      memoryId: 'memory-missing', subjectRevision: 2, sourceOrder: 3, supersedes: ['not-found'],
    }) }), /supersedes target/u);
    assert.equal((await ledger.read()).events.length, 2);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('retract는 기존 memory_removed event와 RecordRef를 쓰고 재시작 뒤 부활하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-memory-claim-retract-'));
  try {
    const ledger = new MemoryLedger(room); await ledger.ensure(); await ledger.commitClaim({ claim: claim() });
    await ledger.retractClaim({ memoryId: 'memory-1', recordRefs: [source('retract-source')] });
    assert.deepEqual((await ledger.read()).items, []);
    const restarted = new MemoryLedger(room); const state = await restarted.read();
    assert.deepEqual(state.items, []);
    assert.equal(state.events.at(-1).type, 'memory_removed');
    assert.equal(state.events.at(-1).recordRefs[0].sourceId, 'retract-source');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('old reader는 optional field를 무시해도 깨지지 않고 current portfolio는 latest를 고른다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-memory-old-reader-'));
  try {
    const ledger = new MemoryLedger(room); await ledger.ensure(); await ledger.commitClaim({ claim: claim() });
    await ledger.commitClaim({ claim: claim({
      memoryId: 'memory-2', value: 'prefers light roast', sources: [source('source-2')],
      subjectRevision: 2, sourceOrder: 3, supersedes: ['memory-1'],
    }) });
    const events = (await ledger.read()).events;
    const oldItems = legacyProjection(events);
    assert.equal(oldItems.length, 2);
    assert.deepEqual(currentUserMemoryCandidates(oldItems).map((item) => item.memoryId), ['memory-2']);
    const raw = await readFile(join(room, 'memory.jsonl'), 'utf8');
    assert.doesNotMatch(raw, /t5\.memory-event\.v2/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});
