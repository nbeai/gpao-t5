import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('S4-D4 기준선은 고아 effect·stuck Work·identity 부재와 안전한 비재실행을 함께 보존한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-d4-crash-ownership-baseline-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'READ_ONLY_IDENTITY_BASELINE_COMPLETE_IMPLEMENTATION_CLOSED');
  assert.equal(evidence.productChanges, 0);
  assert.equal(evidence.runtimeCrash.childEffectAfterCrash, true);
  assert.equal(evidence.runtimeCrash.osPpidAfterCrash, 1);
  assert.equal(evidence.successorRuntime.registryProcessCount, 0);
  assert.equal(evidence.successorRuntime.oldOpaqueHandleState, 'not_found');
  assert.equal(evidence.successorRuntime.workStatus, 'active');
  assert.equal(evidence.successorRuntime.executionClaimState, 'active');
  assert.equal(evidence.successorRuntime.automaticToolReexecutionObserved, false);
  assert.equal(evidence.liveOutputAfterCrash.exactPartialOutput, 'BEFORE-RUNTIME-CRASH');
  assert.equal(evidence.missingDurableIdentity.length, 5);
  assert.equal(evidence.designBoundary.reattachByPidAllowed, false);
  assert.equal(evidence.windows.sameAccidentQualified, false);
});
