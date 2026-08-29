import test from 'node:test';
import assert from 'node:assert/strict';

import { RECOVERY_CASES, assessRecoveryCase } from '../src/recovery-qualification.js';

test('R3 기준선은 방법 실패·부분 결과·안전 재시도·상호작용 전환·불가능 정지를 분리한다', () => {
  assert.deepEqual(RECOVERY_CASES.map((entry) => entry.dimension), [
    'method_failure', 'partial_result', 'safe_retry', 'interaction_mode', 'impossible_stop',
  ]);
});

test('방법 실패는 다른 command의 성공과 최종 목적 달성을 모두 요구한다', () => {
  const definition = RECOVERY_CASES[0];
  const base = {
    definition, fixture: { expectedPath: 'archive/note.txt', expectedMemo: 'MEMO: done' },
    before: {}, after: {}, status: 'completed', answer: 'archive/note.txt MEMO: done',
  };
  const repeated = assessRecoveryCase({ ...base, calls: [
    { actualCall: { args: { command: 'rg x' } }, outcome: 'failed', result: { stderr: 'METHOD_UNAVAILABLE' } },
    { actualCall: { args: { command: 'rg x' } }, outcome: 'succeeded', result: {} },
  ] });
  const switched = assessRecoveryCase({ ...base, calls: [
    { actualCall: { args: { command: 'rg x' } }, outcome: 'failed', result: { stderr: 'METHOD_UNAVAILABLE' } },
    { actualCall: { args: { command: 'grep -R x .' } }, outcome: 'succeeded', result: {} },
  ] });
  assert.equal(repeated.passed, false);
  assert.equal(switched.passed, true);
  assert.equal(assessRecoveryCase({
    ...base, answer: '상대경로: archive/note.txt\nMEMO 원문: done', calls: [
      { actualCall: { args: { command: 'rg x' } }, outcome: 'failed', result: { stderr: 'METHOD_UNAVAILABLE' } },
      { actualCall: { args: { command: 'grep -R x .' } }, outcome: 'succeeded', result: {} },
    ],
  }).passed, true);
});

test('불가능 정지는 무효과·부재 보고·bounded calls의 논리곱이다', () => {
  const definition = RECOVERY_CASES.at(-1);
  const passed = assessRecoveryCase({
    definition, fixture: {}, before: { a: 'x' }, after: { a: 'x' },
    status: 'completed', answer: '해당 기록은 존재하지 않습니다.',
    calls: [
      { requestedCall: { name: 'exec' }, actualCall: null, outcome: 'not_executed', result: { state: 'effect_declaration_required' } },
      { requestedCall: { name: 'exec' }, actualCall: { name: 'exec', args: { command: 'grep x' } }, outcome: 'succeeded', result: {} },
      { requestedCall: { name: 'work_completion' }, actualCall: { name: 'work_completion', args: {} }, outcome: 'succeeded', result: {} },
    ],
  });
  const looping = assessRecoveryCase({
    definition, fixture: {}, before: { a: 'x' }, after: { a: 'x' },
    status: 'completed', answer: '없습니다.',
    calls: Array.from({ length: 6 }, (_, index) => ({ requestedCall: { name: 'exec' },
      actualCall: { name: 'exec', args: { command: `grep ${index}` } }, outcome: 'succeeded', result: {} })),
  });
  assert.equal(passed.passed, true);
  assert.equal(looping.passed, false);
});
