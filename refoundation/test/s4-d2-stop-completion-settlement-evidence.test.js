import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('S4-D2 증거는 exact-once 한 가족과 최소 settlement만 닫는다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-d2-stop-completion-settlement-2026-08-28.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'COMPLETE');
  assert.equal(evidence.failure.redTestFailedForExactReason, true);
  assert.deepEqual(evidence.contract.settlementFieldsReused, ['terminalObserved', 'wakeClaimed']);
  assert.equal(evidence.contract.newStore, false);
  assert.equal(evidence.contract.fixedSleepCoordination, false);
  assert.match(evidence.implementation.change, /records terminalObserved/u);
  assert.equal(evidence.countertests.stopFirstThenWake, 'passed; wake null');
  assert.equal(evidence.countertests.wakeFirstThenStop, 'passed; second wake null');
  assert.equal(evidence.verification.focusedFailed, 0);
  assert.equal(evidence.verification.fullCi.unitFailed, 0);
  assert.equal(evidence.verification.fullCi.integrationFailed, 0);
  assert.equal(evidence.verification.fullCi.mutationKills, 2);
  assert.equal(evidence.nonClaims.length, 3);
});
