import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('console server는 Capability handoff를 배선하고 상태·poll·claim·crash 조율은 Coordinator가 소유한다', async () => {
  const server = await readFile(resolve(root, 'src/console-server.js'), 'utf8');
  const coordinator = await readFile(resolve(root, 'src/capability-handoff-coordinator.js'), 'utf8');
  assert.match(server, /makeCapabilityHandoffCoordinator/u);
  assert.match(server, /executeResume:/u);
  assert.doesNotMatch(server, /function inspectWaitingConnection|function resumeConnectionGoal/u);
  assert.doesNotMatch(server, /connectionWatchers|connectionResumeTimers|connectionResumeInFlight/u);
  assert.match(coordinator, /function inspectWaiting/u);
  assert.match(coordinator, /async function resume/u);
  assert.match(coordinator, /resume_interrupted/u);
  assert.match(coordinator, /readiness_timeout/u);
  assert.match(coordinator, /cancelSessionHandoffs/u);
});
