import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makePausedWorkScope } from '../src/paused-work-scope.js';
import { WorkStore } from '../src/work-store.js';

test('transition boundary paused candidate는 visible source와 opaque handle만 가진다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-paused-transition-'));
  try {
    const store = new WorkStore(room, { makeId: () => 'raw-paused-work' });
    const paused = await store.create({ sessionId: 'session', sourceMessageId: 'source' });
    await store.setStatus({ workId: paused.workId, expectedRevision: 1, status: 'paused' });
    const scope = makePausedWorkScope({ store, runId: 'run', makeHandle: () => 'paused_fixture_12345678' });
    const candidates = await scope.candidates({ sessionId: 'session', conversation: { entries: [{
      messageId: 'source', recordedAt: '2026-08-25T00:00:00.000Z',
      message: { role: 'user', content: '이전 정산 보고서를 완성해' },
    }] } });
    assert.deepEqual(candidates, [{ handle: 'paused_fixture_12345678', title: '이전 정산 보고서를 완성해',
      lastActivity: '2026-08-25T00:00:00.000Z', sourceKind: 'conversation' }]);
    assert.equal(JSON.stringify(candidates).includes(paused.workId), false);
    assert.deepEqual(await scope.resolve(candidates[0].handle), { workId: paused.workId, revision: 1 });
    await assert.rejects(() => scope.resolve('paused_foreign_12345678'), /unknown/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});
