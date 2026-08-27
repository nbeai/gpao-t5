import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S3-HQ close는 6·16 wave 완주, 세 evidence lane, 불리한 비용과 모델 실패를 함께 보존한다', async () => {
  const value = JSON.parse(await readFile(new URL('../evidence/s3-hq-human-reality-close-2026-08-27.json', import.meta.url)));
  assert.deepEqual(value.waves.developer_fast_feedback, {
    passed: 6, failed: 0, pendingHumanReview: 0, notRun: 0,
    lanes: { observedDemand: '2/2', workflowCoverage: '2/2', structuralStress: '2/2' },
  });
  assert.equal(value.waves.pre_tester_reality.passed, 16);
  assert.deepEqual(value.waves.pre_tester_reality.lanes,
    { observedDemand: '6/6', workflowCoverage: '7/7', structuralStress: '3/3' });
  assert.equal(value.finalSuccessfulScenarios.length, 16);
  assert.equal(value.successfulWaveTotals.tokens, 699612);
  assert.equal(value.finalHeadPositiveControls.allPassed, true);
  assert.ok(value.qualificationDevelopment.knownTokens > 600000);
  assert.equal(value.qualificationDevelopment.providerFailuresAfterEvidence.length, 3);
  assert.equal(value.safety.externalWrites, 0);
  assert.equal(value.safety.falseCompletionInFinalRuns, 0);
  assert.equal(value.wholeProductRegression.integrationFailed, 0);
  assert.equal(value.wholeProductRegression.finalProviderSmoke.passed, true);
  assert.equal(value.passed, true);
});
