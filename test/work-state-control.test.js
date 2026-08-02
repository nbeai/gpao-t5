import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MODEL_CONTROL_SCHEMAS, modelSchemasFor, splitModelControlCalls,
} from '../src/kernel/l2-plan/model-control.js';

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
  assert.deepEqual(split.workStateProposal.changes, []);
  assert.equal(split.workStateProposal.openQuestion, undefined);
});
