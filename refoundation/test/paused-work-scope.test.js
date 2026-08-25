import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makePausedWorkScope } from '../src/paused-work-scope.js';
import { WorkStore } from '../src/work-store.js';

test('paused Work는 raw identity 없이 bounded objective와 opaque handle로만 투영된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-paused-work-scope-'));
  try {
    const store = new WorkStore(room, { makeId: () => 'raw-paused-work-id' });
    const paused = await store.create({ sessionId: 'session', sourceMessageId: 'visible-source' });
    await store.setStatus({ workId: paused.workId, expectedRevision: 1, status: 'paused' });
    const scope = makePausedWorkScope({ store, runId: 'run',
      makeHandle: () => 'paused_fixture_opaque_0001' });
    const candidates = await scope.candidates({ sessionId: 'session', conversation: { entries: [{
      messageId: 'visible-source', message: { role: 'user', content: `분기 보고서를 이어서 완성해${' 세부'.repeat(100)}` },
    }] } });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].handle, 'paused_fixture_opaque_0001');
    assert.ok(candidates[0].objective.length <= 240);
    assert.equal(JSON.stringify(candidates).includes(paused.workId), false);
    assert.deepEqual(await scope.resolve(candidates[0].handle), { workId: paused.workId, revision: 1 });
    await assert.rejects(() => scope.resolve('paused_foreign_opaque_0002'), /unknown/u);
    await store.setStatus({ workId: paused.workId, expectedRevision: 1, status: 'active' });
    await assert.rejects(() => scope.resolve(candidates[0].handle), /stale/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('production paused handles는 같은 Run·순번에서도 재사용되지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-paused-work-token-'));
  try {
    const store = new WorkStore(room, { makeId: () => 'raw-work' });
    const paused = await store.create({ sessionId: 'session', sourceMessageId: 'source' });
    await store.setStatus({ workId: paused.workId, expectedRevision: 1, status: 'paused' });
    const conversation = { entries: [{ messageId: 'source', message: { role: 'user', content: '보류한 보고서' } }] };
    const first = (await makePausedWorkScope({ store, runId: 'same-run' })
      .candidates({ sessionId: 'session', conversation }))[0].handle;
    const second = (await makePausedWorkScope({ store, runId: 'same-run' })
      .candidates({ sessionId: 'session', conversation }))[0].handle;
    assert.match(first, /^paused_[a-f0-9]{32}$/u);
    assert.match(second, /^paused_[a-f0-9]{32}$/u);
    assert.notEqual(first, second);
  } finally { await rm(room, { recursive: true, force: true }); }
});
