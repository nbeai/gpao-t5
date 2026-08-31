import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('NX-1A는 exact DR-0 source를 재사용하고 없는 first-useful 값을 꾸미지 않는다', async () => {
  const baseline = JSON.parse(await read('refoundation/evidence/nx1-integral-baseline-freeze-2026-09-01.json'));
  assert.equal(baseline.status, 'BASELINE_FROZEN_CANDIDATE_RED');
  assert.equal(baseline.currentHead, '321a032716ae9b2a4b61def94f633f69bd9ee88e');
  assert.equal(baseline.productSourceBaseline, '93adf628527a511106b0a15da19d528ce8541ddb');
  assert.equal(baseline.productSourceChangedSinceBaseline, false);
  assert.equal(baseline.liveReplay.executed, false);
  assert.equal(baseline.baseline.purposes.length, 3);
  assert.equal(baseline.baseline.medians.finalWallMs, 64153.004);
  assert.equal(baseline.baseline.medians.modelCalls, 12);
  assert.equal(baseline.baseline.medians.inputTokens, 212662);
  assert.equal(baseline.baseline.medians.firstUsefulMs, null);
  assert.equal(baseline.requiredCandidateThresholds.firstUsefulComparisonState,
    'REQUIRES_NEW_AB_BA_MEASUREMENT_FOR_BOTH_ARMS');
  assert.equal(baseline.productSourceChanges, 0);
});

test('NX-1A 인간 Oracle은 후보 identity 없이 네 품질 축과 실제 이해 시간·재가공 부담을 잰다', async () => {
  const oracle = JSON.parse(await read('refoundation/fixtures/nx1-integral-human-blind-oracle.json'));
  assert.equal(oracle.status, 'FROZEN_BEFORE_CANDIDATE');
  assert.equal(oracle.candidateIdentityVisibleToEvaluator, false);
  assert.equal(oracle.methodIdentityVisibleToEvaluator, false);
  assert.equal(oracle.packets.length, 3);
  assert.ok(oracle.packets.every((packet) => packet.decisionQuestions.map((item) => item.id).join(',')
    === 'total_difference,largest_cause,immediate_action'));
  for (const dimension of ['humanMeaning', 'strategy', 'technicalReality', 'design']) {
    assert.ok(Array.isArray(oracle.observationForm[dimension]));
    assert.ok(oracle.observationForm[dimension].length >= 3);
  }
  assert.ok(oracle.observationForm.objectiveMeasures.includes('timeToAnswerEachQuestionMs'));
  assert.ok(oracle.observationForm.objectiveMeasures.includes('manualReformatActions'));
  assert.match(oracle.passRule.design, /answer finding time/u);
  assert.ok(oracle.forbidden.some((item) => item.includes('aesthetic preference alone')));
});

test('NX-1B/C RED: qualification-only Integral Method는 6KiB·revision·source·Direct 비개입 계약을 아직 구현하지 않았다', async () => {
  let candidate = null;
  try {
    candidate = await import('./helpers/nx-integral-method-candidate.js');
  } catch (error) {
    assert.equal(error?.code, 'ERR_MODULE_NOT_FOUND');
  }
  assert.ok(candidate?.validateIntegralMethodCandidate,
    'RED: qualification-only Integral Method candidate helper is not implemented');
});
