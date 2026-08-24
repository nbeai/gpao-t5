import test from 'node:test';
import assert from 'node:assert/strict';

import { executeLearningReplay, qualifyLearningReplay } from '../src/learning-replay.js';

test('replay는 case마다 실행 순서를 교차하고 baseline/candidate를 같은 evaluator에 결속한다', async () => {
  const order = [];
  const replay = await executeLearningReplay({ cases: [{ id: 'a' }, { id: 'b' }],
    executeArm: async ({ arm, case: item }) => (order.push(`${item.id}:${arm}`), { runId: `${arm}-${item.id}` }),
    evaluatePair: async ({ baseline, candidate }) => ({ baselineRunId: baseline.runId,
      candidateRunId: candidate.runId, samePurpose: true }),
    evaluateTrigger: async () => ({ falsePositiveCount: 0, falseNegativeCount: 0 }) });
  assert.deepEqual(order, ['a:baseline', 'a:candidate', 'b:candidate', 'b:baseline']);
  assert.equal(replay.evaluations[1].candidateRunId, 'candidate-b');
});

test('두 achieved pair·정답·holdout·Pareto가 모두 서야 replay qualified가 된다', () => {
  const comparison = { baseline: { runs: [{ runId: 'b1' }, { runId: 'b2' }],
    durationMs: { median: 20 }, modelTurns: { median: 4 }, toolCalls: 8,
    failedToolCalls: 0, notExecutedToolCalls: 0 }, candidate: {
    runs: [{ runId: 'c1' }, { runId: 'c2' }], durationMs: { median: 15 },
    modelTurns: { median: 3 }, toolCalls: 6, failedToolCalls: 0, notExecutedToolCalls: 0 } };
  const eligibility = (prefix) => ({ sources: [1, 2].map((index) => ({ eligible: true,
    pointer: { runId: `${prefix}${index}` } })) });
  const evaluations = [1, 2].map((index) => ({ baselineRunId: `b${index}`, candidateRunId: `c${index}`,
    evaluatorRunId: `e${index}`, evaluationDigest: `d${index}`, samePurpose: true,
    baselineCorrect: true, candidateCorrect: true, baselineComplete: true,
    candidateComplete: true, userCorrectionPreserved: true }));
  const trigger = { sourceExpressionsReused: false, falsePositiveCount: 0, falseNegativeCount: 0,
    evaluatorRunId: 'te', evaluationDigest: 'td' };
  const result = qualifyLearningReplay({ comparison, baselineEligibility: eligibility('b'),
    candidateEligibility: eligibility('c'), pairEvaluations: evaluations, triggerEvaluation: trigger });
  assert.equal(result.state, 'replay_qualified'); assert.equal(result.digest.length, 64);
  assert.equal(result.comparison.comparisonBoundary.fieldObservationVerified, false);
  assert.throws(() => qualifyLearningReplay({ comparison,
    baselineEligibility: eligibility('b'), candidateEligibility: eligibility('c'),
    pairEvaluations: evaluations.map((item, index) => index ? item : { ...item, candidateCorrect: false }),
    triggerEvaluation: trigger }), /correctness/u);
});

test('Pareto 열세 replay는 후보를 내릴 stable rejection code를 가진다', () => {
  const comparison = { baseline: { runs: [{ runId: 'b1' }, { runId: 'b2' }],
    durationMs: { median: 10 }, modelTurns: { median: 2 }, toolCalls: 1 }, candidate: {
    runs: [{ runId: 'c1' }, { runId: 'c2' }], durationMs: { median: 12 }, modelTurns: { median: 3 }, toolCalls: 2 } };
  const eligibility = (prefix) => ({ sources: [1, 2].map((index) => ({ eligible: true,
    pointer: { runId: `${prefix}${index}` } })) });
  const pairs = [1, 2].map((index) => ({ baselineRunId: `b${index}`, candidateRunId: `c${index}`,
    samePurpose: true, baselineCorrect: true, candidateCorrect: true, baselineComplete: true,
    candidateComplete: true, userCorrectionPreserved: true, evaluatorRunId: 'eval', evaluationDigest: 'digest' }));
  const trigger = { sourceExpressionsReused: false, falsePositiveCount: 0, falseNegativeCount: 0,
    evaluatorRunId: 'eval', evaluationDigest: 'digest' };
  assert.throws(() => qualifyLearningReplay({ comparison, baselineEligibility: eligibility('b'),
    candidateEligibility: eligibility('c'), pairEvaluations: pairs, triggerEvaluation: trigger }),
  (error) => error.code === 'learning_replay_pareto_failed');
});
