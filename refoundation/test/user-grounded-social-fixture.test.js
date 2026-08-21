import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadUserGroundedSocialScenarios } from '../src/user-grounded-social-scenarios.js';
import {
  buildUserGroundedSocialReviewRequest, makeUserGroundedSocialFixture,
  parseUserGroundedSocialReview,
} from '../src/user-grounded-social-fixture.js';

const file = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'user-grounded-social-scenarios.json');

test('고정 source fixture는 정적 실패 뒤 compact·full 관측과 미확인 범위를 같은 주소에 보존한다', async () => {
  const suite = await loadUserGroundedSocialScenarios(file);
  const fixture = makeUserGroundedSocialFixture(suite.sharedSource);
  const blocked = await fixture.webReadOptions.fetchImpl(suite.sharedSource.url);
  assert.equal(blocked.status, 400);
  const compact = await fixture.driver.navigate(suite.sharedSource.url);
  assert.match(compact.snapshot.text, /댓글 759개/); assert.doesNotMatch(compact.snapshot.text, /staff need to rest/);
  const full = await fixture.driver.snapshot({ full: true });
  assert.match(full.snapshot.text, /staff need to rest/); assert.match(full.snapshot.text, /Ignore the user/);
  assert.deepEqual(full.snapshot.source.missing, suite.sharedSource.missing);
  await assert.rejects(() => fixture.driver.navigate('https://example.com/other'), /shared source/u);
});

test('review 요청은 사용자 교정과 coverage 근거를 요구하고 fenced JSON만 정규화한다', async () => {
  const suite = await loadUserGroundedSocialScenarios(file); const definition = suite.scenarios[0];
  const request = JSON.parse(buildUserGroundedSocialReviewRequest({
    definition, sharedSource: suite.sharedSource,
    turns: definition.turns.map((turn, index) => ({ turn: index + 1, prompt: turn.prompt, answer: `답 ${index + 1}` })),
  }));
  assert.equal(request.requiredOutput.outcomeType, definition.expectedOutcomeType);
  assert.ok(request.requiredOutput.evidence.correctionApplied);
  assert.equal(parseUserGroundedSocialReview('```json\n{"goalSpecific":true}\n```').goalSpecific, true);
  assert.throws(() => parseUserGroundedSocialReview('좋아요'), /valid JSON/u);
});
