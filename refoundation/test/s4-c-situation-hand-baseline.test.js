import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('S4-C 기준선은 D0 fact-only 교정과 owner 정지선을 보존한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-c-situation-hand-baseline-2026-08-28.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'PAUSED_AFTER_CROSS_MODEL_CROSS_DOMAIN_VARIANCE_D0_CORRECTED');
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
  assert.equal(evidence.nextOneTask, 'none until owner resumes S4-C');
  assert.match(evidence.routingDecision.falseAbsenceDirectBlocker, /shallow successful observation/u);
  assert.ok(evidence.notYetProven.includes('connection should be deferred globally'));
});
