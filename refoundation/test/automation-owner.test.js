import test from 'node:test';
import assert from 'node:assert/strict';

import { makeLocalAutomationOwner } from '../src/automation-owner.js';

test('owner liveness는 platform identity를 adapter에서만 해석하고 unknown을 death로 승격하지 않는다', async () => {
  const owner = makeLocalAutomationOwner({ runtimeId: 'runtime-a', pid: 77, startedAt: 100,
    pidState: () => 'unknown' });
  owner.activate(); assert.equal(await owner.inspect(owner.owner), 'live');
  owner.deactivate(); assert.equal(await owner.inspect(owner.owner), 'definitely_dead');
  assert.equal(await owner.inspect({ runtimeId: 'other', generation: 1,
    platformIdentity: { kind: 'node_process', pid: 88, startedAt: 90 } }), 'unknown');
  assert.equal(await owner.inspect({ runtimeId: 'opaque', generation: 1,
    platformIdentity: { kind: 'windows_task', task: 'fixture' } }), 'unknown');
});
