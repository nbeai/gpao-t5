import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assessUserGroundedSocialScenario, assessUserGroundedSocialSuite,
  loadUserGroundedSocialScenarios, USER_GROUNDED_SOCIAL_REVIEW_DIMENSIONS,
} from '../src/user-grounded-social-scenarios.js';

const file = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'user-grounded-social-scenarios.json');

test('같은 실제 source를 세 사업 목적이 6턴 이상 서로 다르게 읽고 고정 persona를 주장하지 않는다', async () => {
  const suite = await loadUserGroundedSocialScenarios(file);
  assert.equal(suite.scope.representativeOfUsers, false); assert.equal(suite.scenarios.length, 3);
  assert.deepEqual(suite.scenarios.map((scenario) => scenario.turns.length), [6, 6, 6]);
  assert.equal(new Set(suite.scenarios.map((scenario) => scenario.expectedOutcomeType)).size, 3);
  for (const scenario of suite.scenarios) {
    assert.deepEqual(new Set(scenario.turns.map((turn) => turn.kind)), new Set([
      'context', 'analysis', 'constraint', 'correction', 'challenge', 'final',
    ]));
  }
  assert.deepEqual(USER_GROUNDED_SOCIAL_REVIEW_DIMENSIONS, [
    'sourceFactsPreserved', 'userFactsUsed', 'goalSpecific', 'correctionApplied',
    'coverageHonest', 'universalRuleAvoided', 'actionProportional',
  ]);
});

test('판정은 자연어 문자열 정답 대신 source·사용자 사실·교정·coverage·목적별 결과의 논리곱이다', async () => {
  const suite = await loadUserGroundedSocialScenarios(file);
  const results = suite.scenarios.map((definition) => {
    const review = {
      sourceUrl: suite.sharedSource.url, outcomeType: definition.expectedOutcomeType,
      ...Object.fromEntries(USER_GROUNDED_SOCIAL_REVIEW_DIMENSIONS.map((dimension) => [dimension, true])),
    };
    const turns = definition.turns.map(() => ({ answer: '사용자 목적에 맞춘 자연스러운 답변' }));
    const verdict = assessUserGroundedSocialScenario({
      definition, sourceUrl: suite.sharedSource.url, turns, capabilityInstalls: 0, review,
    });
    return { definition, review, verdict };
  });
  assert.equal(assessUserGroundedSocialSuite(results).passed, true);
  results[1].review.outcomeType = results[0].review.outcomeType;
  assert.equal(assessUserGroundedSocialSuite(results).passed, false);
  const weak = structuredClone(results[0]); weak.review.coverageHonest = false;
  weak.verdict = assessUserGroundedSocialScenario({
    definition: weak.definition, sourceUrl: suite.sharedSource.url,
    turns: weak.definition.turns.map(() => ({ answer: '답변' })), capabilityInstalls: 0, review: weak.review,
  });
  assert.equal(weak.verdict.passed, false);
});
