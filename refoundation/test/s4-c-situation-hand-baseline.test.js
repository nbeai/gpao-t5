import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('S4-C 기준선은 미증명·제품 구현 0·S4-K/HQ 이월을 보존한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-c-situation-hand-baseline-2026-08-28.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status,
    'CLOSED_WITH_MODEL_PROVIDER_OBSERVATION_USER_COMPLETION_NOT_UNIVERSALLY_PROVEN');
  assert.equal(evidence.productChanges, 0);
  assert.equal(evidence.currentGpt55.purposeAchieved, true);
  assert.equal(evidence.currentGpt55.connectionResultUsedInFinalAnswer, false);
  assert.deepEqual(evidence.currentGpt55.toolSequence,
    ['connection', 'exec', 'exec', 'exec', 'work_completion']);
  assert.deepEqual(evidence.reproducedFailureFamilies.map((item) => item.id), [
    'local_evidence_after_unused_connection_probe',
    'nonportable_file_discovery_hidden_by_pipeline_exit',
  ]);
  assert.equal(evidence.terraComparison.status, 'purpose_failed');
  assert.deepEqual(evidence.terraComparison.toolSequence, ['connection', 'exec']);
  assert.deepEqual(evidence.rejectedCandidates.map((item) => item.productAdopted), [false, false]);
  assert.equal(evidence.terminalD0.productAdopted, true);
  assert.equal(evidence.combinedQualification.gpt55.purposeAchieved, true);
  assert.equal(evidence.combinedQualification.terra.purposeAchieved, true);
  assert.equal(evidence.combinedQualification.productAdopted, false);
  assert.equal(evidence.combinedQualification.sourceRemoved, true);
  assert.equal(evidence.structuralReassessmentBeforeOwnerPause.gpt55ContractComparison.purposeAchieved, false);
  assert.equal(evidence.structuralReassessmentBeforeOwnerPause.gpt55ContractComparison.execAvailableOnBothCalls, true);
  assert.equal(evidence.structuralReassessmentBeforeOwnerPause.gpt55ReceivablesPositiveControl.purposeAchieved, true);
  assert.equal(evidence.structuralReassessmentBeforeOwnerPause.compactPrincipleQualification.productAdopted, false);
  assert.equal(evidence.ownerResumption.productAdopted, false);
  assert.equal(evidence.ownerResumption.transmissionCategoryRequired, 'workspace_presence');
  assert.equal(evidence.ownerResumption.stopAfterBooleanFailure, true);
  assert.equal(evidence.ownerResumption.sourceRemoved, true);
  assert.equal(evidence.ownerResumption.liveA03.purposeAchieved, false);
  assert.equal(evidence.ownerResumption.liveA03.namesPathsContentCountsTransmitted, false);
  assert.equal(evidence.ownerResumption.expandedMatrixRun, false);
  assert.equal(evidence.closure.userCompletionUniversallyProven, false);
  assert.equal(evidence.closure.productImplementationAdopted, 0);
  assert.equal(evidence.closure.finalWorkspacePresenceProductSourceDelta, 0);
  assert.match(evidence.closure.branchProductDeltaStillIncludes, /4cd43bb8/u);
  assert.ok(evidence.closure.carryForward['S4-K'].includes('portable command choice'));
  assert.ok(evidence.closure.carryForward['S4-HQ'].includes('false local absence'));
  assert.match(evidence.routingDecision.falseAbsenceDirectBlocker, /shallow successful observation/u);
  assert.ok(evidence.notYetProven.includes('connection should be deferred globally'));
});
