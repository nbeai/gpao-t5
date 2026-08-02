import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildContinuationProbe, buildLiveScenario, scoreGateRecall,
} from '../scripts/production90/p90-1-live-reseal.mjs';

test('P90-1 12턴 관문은 상태 변화 턴과 재시작·새 대화를 사전 등록한다', () => {
  const scenario = buildLiveScenario(12, 'document');
  assert.equal(scenario.turns.length, 12);
  assert.ok(scenario.turns.some((turn) => turn.restartBefore));
  assert.equal(scenario.turns.at(-1).newConversation, true);
  assert.ok(scenario.turns.filter((turn) => turn.stateChange).length >= 7);
});

test('P90-1 새 대화 승계 probe는 최초 합의 뒤 별도 세션을 연다', () => {
  const probe = buildContinuationProbe('document');
  assert.equal(probe.turns.length, 2);
  assert.equal(probe.turns[1].newConversation, true);
  assert.deepEqual(probe.turns[1].expected, probe.turns[0].expected);
});

test('P90-1 관문은 주 호출 생략 턴에서 정산이 하나라도 안 열리면 실패한다', () => {
  const recall = scoreGateRecall([
    { stateChange: true, stateAccurate: true, reportedByMain: true, reviewOpened: false },
    { stateChange: true, stateAccurate: true, reportedByMain: false, reviewOpened: false },
  ]);
  assert.equal(recall.stateCaptureRecall, 1);
  assert.equal(recall.fallbackGateRecall, 0);
});

test('P90-1 관문은 상태 정확도와 생략 턴 정산이 모두 100%일 때만 선다', () => {
  const recall = scoreGateRecall([
    { stateChange: true, stateAccurate: true, reportedByMain: true, reviewOpened: false },
    { stateChange: true, stateAccurate: true, reportedByMain: false, reviewOpened: true },
    { stateChange: false, stateAccurate: true, reportedByMain: false, reviewOpened: false },
  ]);
  assert.deepEqual(recall, {
    changedTurns: 2,
    stateCaptureRecall: 1,
    omittedChangeTurns: 1,
    fallbackGateRecall: 1,
  });
});
