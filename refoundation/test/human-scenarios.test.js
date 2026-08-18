import test from 'node:test';
import assert from 'node:assert/strict';

import { HUMAN_SCENARIOS, commonHumanChecks } from '../src/human-scenarios.js';

test('R4 제품 판정은 세 개의 긴 멀티턴 인간 여정을 사용한다', () => {
  assert.deepEqual(HUMAN_SCENARIOS.map((scenario) => scenario.turns.length), [18, 12, 11]);
  assert.deepEqual(HUMAN_SCENARIOS.map((scenario) => scenario.kind), ['conversation', 'files', 'personal']);
  assert.ok(HUMAN_SCENARIOS.flatMap((scenario) => scenario.turns)
    .every((turn) => !/7391|BEACON|먼저 rg|tool call|exit code/iu.test(turn.prompt)));
});

test('사용자 표면 판정은 내부 도구명과 실패한 Turn을 허용하지 않는다', () => {
  assert.equal(commonHumanChecks([{
    answer: '완료했어요.', httpStatus: 200, runStatus: 'completed',
  }]).noInternalTerms, true);
  const bad = commonHumanChecks([{
    answer: 'session_search의 runId를 확인했어요.', httpStatus: 200, runStatus: 'completed',
  }]);
  assert.equal(bad.noInternalTerms, false);
});
