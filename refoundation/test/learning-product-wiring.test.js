import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

test('제품은 learning source shadow와 proposal store를 배선하지만 reviewer·active write를 자동 실행하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-learning-wiring-'));
  let server;
  try {
    server = makeConsoleServer({ stateDir: join(room, 'state'), workspace: room,
      modelFactory: () => ({ async respond() { return { text: 'ok', toolCalls: [] }; } }) });
    const report = await server.learningSourceEligibility();
    assert.equal(report.schema, 't5.learning-source-eligibility.v1');
    assert.deepEqual(report.sources, []);
    assert.equal(typeof server.learningCandidateStore.stage, 'function');
    assert.equal((await server.capabilityLifecycleLedger.events()).length, 0);
  } finally {
    await server?.closeMessengers(); await server?.closeWorkspaceConnections();
    await server?.managedProcesses.stopAll('test_cleanup');
    await new Promise((resolve) => setTimeout(resolve, 10));
    await rm(room, { recursive: true, force: true });
  }
});
