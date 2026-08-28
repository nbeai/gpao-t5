import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('S4-D4A 증거는 orphan prevention과 남은 successor·PTY 경계를 분리한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-d4a-parent-death-containment-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'COMPLETE');
  assert.equal(evidence.scope, 'managed non-PTY process');
  assert.equal(evidence.qualification.runtimeSigkillLateEffect, false);
  assert.equal(evidence.qualification.runtimeAliveNormalOutput, true);
  assert.equal(evidence.qualification.missingHelperProcessStarts, 0);
  assert.equal(evidence.implementation.pidReattach, false);
  assert.equal(evidence.implementation.newStore, false);
  assert.ok(evidence.performance.addedMsPerCommand > 0);
  assert.equal(evidence.verification.fullCiExit, 0);
  assert.ok(evidence.nonClaims.includes('PTY parent-death containment is implemented'));
});
