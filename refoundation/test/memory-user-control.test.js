import assert from 'node:assert/strict';
import test from 'node:test';

import { makeMemoryControlTool } from '../src/memory-control-tool.js';
import { exportMemoryBundle } from '../src/memory-export.js';
import { forgetTombstoneProjection } from '../src/memory-portfolio.js';

const state = {
  claims: [{
    memoryId: 'memory-1', kind: 'preference', subjectKey: 'subject-1', value: 'safe value',
    scope: { global: true, workId: null, projectId: null, personId: 'person:owner', organizationId: null },
    sources: [{ recordId: 'rr-1', sourceKind: 'local_file', sourceStore: 'managed-file',
      sourceId: '/Users/private/secret-note.txt', sourceRevision: 1, sha256: 'a'.repeat(64),
      occurredAt: null, recordedAt: '2026-08-26T00:00:00.000Z',
      scope: { sessionId: 's', workId: null, subjectKeys: [], channel: 'console' },
      trust: 'user_asserted', sensitivity: 'personal', coverage: 'full', availability: 'available' }],
    recordedAt: '2026-08-26T00:00:00.000Z', validFrom: null, validTo: null,
    subjectRevision: 1, sourceOrder: 2, status: 'retracted', supersedes: [], conflictsWith: [],
    sensitivity: 'personal', alwaysRelevant: false,
  }],
  tombstones: [{ requestId: 'forget-1', memoryId: 'memory-1', subjectKey: 'subject-1',
    targetRevision: 1, reversibleUntil: '2026-09-26T00:00:00.000Z' }],
};

test('portable memory export는 history·provenance·tombstone을 보존하고 local absolute path를 제외한다', () => {
  const bundle = exportMemoryBundle({ state, exportedAt: '2026-08-26T08:00:00.000Z' });
  assert.equal(bundle.schema, 't5.memory-portable.v1');
  assert.equal(bundle.claims[0].status, 'retracted');
  assert.equal(bundle.claims[0].sources[0].recordId, 'rr-1');
  assert.equal('sourceId' in bundle.claims[0].sources[0], false);
  assert.equal(bundle.tombstones[0].requestId, 'forget-1');
  assert.doesNotMatch(JSON.stringify(bundle), /\/Users\/private/u);
});

test('memory_control restore는 exact pointer와 current RecordRef만 coordinator에 전달한다', async () => {
  let observed = null;
  const tool = makeMemoryControlTool({
    ledger: { read: async () => state },
    coordinator: { restore: async (input) => { observed = input; return { state: 'restored' }; } },
    currentRecordRefs: async () => [{ recordId: 'rr-current' }],
    now: () => '2026-08-26T08:00:00.000Z',
  });
  assert.deepEqual(await tool.execute({ action: 'restore', requestId: 'forget-1', memoryId: 'memory-1' }),
    { state: 'restored' });
  assert.deepEqual(observed, { requestId: 'forget-1', memoryId: 'memory-1',
    recordRefs: [{ recordId: 'rr-current' }] });
  await assert.rejects(tool.execute({ action: 'restore', requestId: null, memoryId: 'memory-1' }),
    /exact requestId/u);
});

test('memory_control export는 canonical을 바꾸지 않고 portable bundle만 반환한다', async () => {
  const tool = makeMemoryControlTool({
    ledger: { read: async () => structuredClone(state) }, coordinator: {},
    currentRecordRefs: async () => [], now: () => '2026-08-26T08:00:00.000Z',
  });
  const result = await tool.execute({ action: 'export', requestId: null, memoryId: null });
  assert.equal(result.state, 'exported');
  assert.equal(result.bundle.claims.length, 1);
});

test('forget pointer는 content 없이 exact restore identity와 window만 모델에 준다', () => {
  const projection = forgetTombstoneProjection(state.tombstones);
  assert.match(projection.content, /forget-1/u);
  assert.match(projection.content, /memory-1/u);
  assert.doesNotMatch(projection.content, /safe value/u);
  assert.match(projection.content, /do not reconstruct a value from session_search/u);
  assert.match(projection.content, /T5 no longer keeps the value/u);
});
