import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessBQualificationCase, selectBQualificationCases, validateBHoldout,
} from '../src/b-transition-qualification.js';

const cases = [{ id: 'r', state: 'revise_current', initialRequest: 'a', admittedText: 'b REVISE_OK',
  expectedControl: null, expectedWorks: 1, expectedRuns: 1, finalSurfaceMustInclude: ['REVISE_OK'] },
{ id: 'e', state: 'extend_current', initialRequest: 'a', admittedText: 'b EXTEND_OK',
  expectedControl: null, expectedWorks: 1, expectedRuns: 1, finalSurfaceMustInclude: ['EXTEND_OK'] },
{ id: 'd', state: 'defer_after_delivery', initialRequest: 'a FIRST', admittedText: 'b NEXT',
  expectedControl: 'defer_after_delivery', expectedWorks: 1, expectedRuns: 2,
  firstSurfaceMustInclude: ['FIRST'], finalSurfaceMustInclude: ['NEXT'] },
{ id: 'i', state: 'independent', initialRequest: 'a', admittedText: 'b NEW_TASK',
  expectedControl: 'start_independent_work', expectedWorks: 2, expectedRuns: 2,
  finalSurfaceMustInclude: ['NEW_TASK'] },
{ id: 'c', state: 'cancel', initialRequest: 'a', admittedText: 'b STOP',
  expectedControl: 'cancel_current_work', expectedWorks: 1, expectedRuns: 1,
  finalSurfaceMustInclude: ['STOP'] }];

test('B live matrix는 같은 control=null인 revise와 extend를 서로 다른 다섯 상태로 유지한다', () => {
  validateBHoldout({ cases });
  assert.deepEqual(selectBQualificationCases(cases, { onePerState: true }).map((item) => item.state), [
    'revise_current', 'extend_current', 'defer_after_delivery', 'independent', 'cancel',
  ]);
});

test('after-delivery 자격은 두 surface와 confirmed delivery 뒤 activation 순서를 모두 요구한다', () => {
  const definition = cases[2]; const run1 = { runId: 'run-1', events: [] }; const run2 = { runId: 'run-2', events: [] };
  const observed = { admittedStatus: 202, actualControl: 'defer_after_delivery',
    input: { inputId: 'input', state: 'executed', disposition: 'deferred_after_delivery', deferredByRunId: 'run-1' },
    surfaces: ['FIRST', 'NEXT'], runs: [run1, run2], workState: { works: [{}], results: [], events: [
      { type: 'result_delivery_terminal', runId: 'run-1', delivery: { state: 'persisted' } },
      { type: 'input_schedule_activated', inputId: 'input' },
    ] } };
  assert.equal(assessBQualificationCase(definition, observed).passed, true);
  assert.equal(assessBQualificationCase(definition, { ...observed, surfaces: ['FIRST NEXT'] }).passed, false);
  assert.equal(assessBQualificationCase(definition, { ...observed, workState: { ...observed.workState,
    events: [...observed.workState.events].reverse() } }).passed, false);
});

test('independent와 cancel은 전환 Run의 거짓 completion과 control 뒤 새 효과를 통과시키지 않는다', () => {
  const independent = { admittedStatus: 202, actualControl: 'start_independent_work',
    input: { state: 'executed', disposition: 'independent_work' }, surfaces: ['전환', 'NEW'],
    runs: [{ runId: 'run-1', events: [] }, { runId: 'run-2', events: [] }], workState: {
      works: [{ status: 'paused' }, { status: 'active' }], events: [{ type: 'completion_proposed', runId: 'run-1' }],
    } };
  assert.equal(assessBQualificationCase(cases[3], independent).passed, false);
  const earlyIndependent = { ...independent, surfaces: ['NEW_TASK', 'NEW_TASK'], workState: {
    ...independent.workState, events: [],
  } };
  assert.equal(assessBQualificationCase(cases[3], earlyIndependent).passed, false);
  const cancel = { admittedStatus: 202, actualControl: 'cancel_current_work',
    input: { state: 'executed' }, surfaces: ['STOP'], workState: { works: [{ status: 'cancelled' }], events: [] },
    runs: [{ runId: 'run-c', events: [
      { type: 'tool_completed', payload: { receipt: { requestedCall: { name: 'work_control' } } } },
      { type: 'tool_started', payload: { name: 'exec' } },
    ] }] };
  assert.equal(assessBQualificationCase(cases[4], cancel).passed, false);
});
