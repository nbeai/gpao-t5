import test from 'node:test';
import assert from 'node:assert/strict';

import { qualifyLearningComparison } from '../src/learning-qualification.js';

function comparison({ candidateCorrect = true, candidateToolCalls = 2 } = {}) {
  return {
    capability: { kind: 'skill', id: 'learned-method' },
    baseline: { runs: [{ runId: 'b1' }, { runId: 'b2' }], revisions: [],
      durationMs: { median: 200 }, modelTurns: { median: 4 }, toolCalls: 6,
      failedToolCalls: 0, notExecutedToolCalls: 0 },
    candidate: { runs: [{ runId: 'c1' }, { runId: 'c2' }], revisions: [{ digest: 'candidate' }],
      durationMs: { median: 150 }, modelTurns: { median: 3 }, toolCalls: candidateToolCalls,
      failedToolCalls: 0, notExecutedToolCalls: 0 },
    comparisonBoundary: { samePurposeVerified: false, answerCorrectnessMeasured: false },
    candidateCorrect,
  };
}
function eligibility(prefix) {
  return { sources: [1, 2].map((index) => ({ eligible: true,
    pointer: { workId: `${prefix}-work-${index}`, runId: `${prefix}${index}` } })) };
}
function evaluations({ candidateCorrect = true, samePurpose = true } = {}) {
  return [1, 2].map((index) => ({ baselineRunId: `b${index}`, candidateRunId: `c${index}`,
    evaluatorRunId: `e${index}`, evaluationDigest: `digest-${index}`, samePurpose,
    baselineCorrect: true, candidateCorrect, baselineComplete: true, candidateComplete: true,
    userCorrectionPreserved: true }));
}
const trigger = { evaluatorRunId: 'trigger-eval', evaluationDigest: 'trigger-digest',
  sourceExpressionsReused: false, falsePositiveCount: 0, falseNegativeCount: 0 };
const field = { workId: 'field-work', runId: 'field-run', resultDigest: 'field-result',
  candidateRevisionUsed: true, achieved: true, userCorrectionPreserved: true,
  regressionObserved: false };

test('서로 다른 achieved Work·holdout·field·Pareto가 모두 서야 qualification receipt가 생긴다', () => {
  const result = qualifyLearningComparison({ comparison: comparison(),
    baselineEligibility: eligibility('b'), candidateEligibility: eligibility('c'),
    pairEvaluations: evaluations(), triggerEvaluation: trigger, fieldObservation: field });
  assert.equal(result.qualificationReceipt.state, 'qualified');
  assert.equal(result.qualificationReceipt.digest.length, 64);
  assert.equal(result.comparisonBoundary.samePurposeVerified, true);
  assert.deepEqual(result.qualificationReceipt.evidence.performance.improved,
    ['durationMs', 'modelTurns', 'toolCalls']);
});

test('faster-but-wrong·다른 목적·source 표현 재사용은 qualification이 아니다', () => {
  const common = { comparison: comparison(), baselineEligibility: eligibility('b'),
    candidateEligibility: eligibility('c'), triggerEvaluation: trigger, fieldObservation: field };
  assert.throws(() => qualifyLearningComparison({ ...common,
    pairEvaluations: evaluations({ candidateCorrect: false }) }), /correctness/u);
  assert.throws(() => qualifyLearningComparison({ ...common,
    pairEvaluations: evaluations({ samePurpose: false }) }), /purpose/u);
  assert.throws(() => qualifyLearningComparison({ ...common, pairEvaluations: evaluations(),
    triggerEvaluation: { ...trigger, sourceExpressionsReused: true } }), /holdout/u);
});

test('candidate가 한 measured lane이라도 나빠지거나 field가 source Work 재사용이면 승격하지 않는다', () => {
  const common = { baselineEligibility: eligibility('b'), candidateEligibility: eligibility('c'),
    pairEvaluations: evaluations(), triggerEvaluation: trigger, fieldObservation: field };
  assert.throws(() => qualifyLearningComparison({ ...common,
    comparison: comparison({ candidateToolCalls: 7 }) }), /Pareto/u);
  assert.throws(() => qualifyLearningComparison({ ...common, comparison: comparison(),
    fieldObservation: { ...field, workId: 'b-work-1' } }), /independent/u);
});
