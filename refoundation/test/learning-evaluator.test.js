import test from 'node:test';
import assert from 'node:assert/strict';
import { runLearningEvaluation } from '../src/learning-evaluator.js';

test('evaluator는 exact pair 수와 near-miss를 한 receipt로 정산하고 다른 도구를 갖지 않는다', async () => {
  let calls = 0; const model = { async respond(input) {
    calls += 1; assert.deepEqual(input.tools.map((tool) => tool.name), ['learning_evaluation']);
    if (calls > 1) return { text: 'done', toolCalls: [] };
    return { text: '', toolCalls: [{ id: 'evaluation', name: 'learning_evaluation', args: {
      pairs: [1, 2].map(() => ({ samePurpose: true, baselineCorrect: true,
        candidateCorrect: true, baselineComplete: true, candidateComplete: true,
        userCorrectionPreserved: true })), nearMissShouldTrigger: false,
      sourceExpressionsReused: false, recommendAfterIndependentFieldSuccess: true,
    } }] };
  } };
  const result = await runLearningEvaluation({ model, pairs: [{}, {}], nearMiss: {} });
  assert.equal(result.evaluation.state, 'evaluated'); assert.equal(result.evaluationDigest.length, 64);
  assert.equal(result.modelTurns, 2); assert.equal(result.toolCalls, 1);
});
