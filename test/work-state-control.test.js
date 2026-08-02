import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MODEL_CONTROL_SCHEMAS, modelSchemasFor, splitModelControlCalls,
} from '../src/kernel/l2-plan/model-control.js';
import { stateReviewNeeded } from '../src/kernel/turn.js';

test('work.state 는 실행 손이 아니라 소비자가 열린 모델 통제 채널이다', () => {
  const selfState = { connectedTools: [{
    id: 'local.file', status: 'usable', executable: true,
    schema: { description: 'file', parameters: { type: 'object', properties: {} } },
  }] };
  const hidden = modelSchemasFor(selfState).map((x) => x.name);
  const shown = modelSchemasFor(selfState, ['work.state']).map((x) => x.name);
  assert.ok(!hidden.includes('work.state'));
  assert.ok(shown.includes('work.state'));
  assert.ok(MODEL_CONTROL_SCHEMAS.some((x) => x.name === 'work.state'));
});

test('work.state 는 완료 주장을 받지 않고 사용자 합의·수정·철회·미정 후보만 운반한다', () => {
  const split = splitModelControlCalls([{
    name: 'work.state',
    args: {
      changes: [
        { type: 'agreement_set', utteranceQuote: '참석자는 35명으로 하자' },
        { type: 'agreement_superseded', utteranceQuote: '아니 28명으로 바꿔', targetQuote: '참석자는 35명으로 하자' },
        { type: 'execution_completed', utteranceQuote: '완료했어' },
      ],
      openQuestion: { question: '장소는 어디로 정할까요?', changesAnswerFor: '행사 장소' },
      continueFrom: '참석자는 35명으로 하자',
      continueFromRef: 'P1',
    },
  }]);
  assert.deepEqual(split.rest, []);
  assert.deepEqual(split.workStateProposal.changes, [
    { type: 'agreement_set', utteranceQuote: '참석자는 35명으로 하자' },
    { type: 'agreement_superseded', utteranceQuote: '아니 28명으로 바꿔', targetQuote: '참석자는 35명으로 하자' },
  ]);
  assert.deepEqual(split.workStateProposal.openQuestion, {
    question: '장소는 어디로 정할까요?', changesAnswerFor: '행사 장소',
  });
  assert.equal(split.workStateProposal.continueFrom, '참석자는 35명으로 하자');
  assert.equal(split.workStateProposal.continueFromRef, 'P1');
});

test('빈 값·모르는 종류·과대한 문자열은 조용히 사건으로 승격되지 않는다', () => {
  const split = splitModelControlCalls([{
    name: 'work.state',
    args: {
      changes: [
        { type: 'agreement_set', utteranceQuote: '' },
        { type: 'unknown', utteranceQuote: 'x' },
      ],
      openQuestion: { question: 'x'.repeat(600), changesAnswerFor: '' },
    },
  }]);
  assert.equal(split.workStateProposal, null);
});

test('상태 변화 없음은 정상 보고이며 사건 후보가 아니다', () => {
  const split = splitModelControlCalls([{
    name: 'work.state', args: { noChange: true },
  }]);
  assert.equal(split.workStateSeen, true);
  assert.equal(split.workStateNoChange, true);
  assert.equal(split.workStateProposal, null);
  assert.deepEqual(split.rest, []);
});

test('정산 게이트는 종단 뒤의 관련 작업만 열고 단순 대화와 첫 호출에서는 닫힌다', () => {
  const relevant = {
    phase: 'settled', terminal: true, reported: false, durableWorkCandidate: true,
  };
  assert.equal(stateReviewNeeded(relevant), true);
  assert.equal(stateReviewNeeded({ ...relevant, phase: 'first_model_response' }), false);
  assert.equal(stateReviewNeeded({ ...relevant, terminal: false }), false);
  assert.equal(stateReviewNeeded({ ...relevant, reported: true }), false);
  assert.equal(stateReviewNeeded({
    phase: 'settled', terminal: true, reported: false,
    hasExistingWork: false, durableWorkCandidate: false, goalRelevant: false, resumedApproval: false,
  }), false);
  assert.equal(stateReviewNeeded({
    phase: 'settled', terminal: true, reported: false,
    hasExistingWork: false, durableWorkCandidate: false, goalRelevant: true, resumedApproval: false,
  }), false, 'activeGoal 추정만으로 정산을 열지 않는다');
  assert.equal(stateReviewNeeded({
    phase: 'settled', terminal: true, reported: false,
    hasExistingWork: false, hasCarryableProject: true, durableWorkCandidate: false,
    resumedApproval: false,
  }), true, '새 대화에 실제로 공급된 프로젝트는 정산 검토 대상이다');
});
