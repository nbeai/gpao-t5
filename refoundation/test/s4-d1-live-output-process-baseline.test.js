import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('S4-D1 기준선은 현재 강점과 세 P1·미측정 범위를 분리한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-d1-live-output-process-baseline-2026-08-28.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'READ_ONLY_BASELINE_COMPLETE_THREE_GAPS_REPRODUCED');
  assert.equal(evidence.productChanges, 0);
  assert.equal(evidence.largeManagedOutput.permanentlyOmittedChars.total, 402872);
  assert.equal(evidence.largeManagedOutput.exactOutputRecallUnavailable, true);
  assert.equal(evidence.largeManagedOutput.outputRecallHandlePresent, false);
  assert.equal(evidence.cursorAndWake.ordinaryCompletionWakeSecondClaim, null);
  assert.equal(evidence.cursorAndWake.wakeStillClaimableAfterStopReturnedTerminal, true);
  assert.equal(evidence.restartReality.abruptRuntimeCrash.childWroteMarkerAfterParentExit, true);
  assert.equal(evidence.restartReality.abruptRuntimeCrash.successorOldHandleState, 'not_found');
  assert.equal(evidence.restartReality.automaticToolReexecutionObserved, false);
  assert.equal(evidence.positiveControls.testsFailed, 0);
  assert.deepEqual(evidence.reproducedGapFamilies.map((item) => item.severity), ['P1', 'P1', 'P1']);
  assert.ok(evidence.notYetProven.includes('disk spool is the only or smallest implementation'));
  assert.match(evidence.gateImpact, /implementation remains closed/u);
});
