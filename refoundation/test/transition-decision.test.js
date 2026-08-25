import test from 'node:test';
import assert from 'node:assert/strict';

import { decideTransition, transitionDecisionTool } from '../src/transition-decision.js';

test('transition decision은 provider strict schema와 forced 단일 도구만 사용한다', async () => {
  const tool = transitionDecisionTool();
  assert.deepEqual(Object.keys(tool.parameters.properties).toSorted(), tool.parameters.required.toSorted());
  let observed;
  const decision = await decideTransition({
    currentWork: { objective: '현재 보고서', status: 'active', revision: 99, workId: 'raw-work' },
    input: { text: '별도 메모로 시작해', attachmentCount: 0, sourceKind: 'conversation' },
    pausedCandidates: [{ handle: 'paused_opaque_12345678', title: '이전 정산',
      lastActivity: null, sourceKind: 'conversation', workId: 'raw-paused' }],
    model: { async respond(input) { observed = input; return { text: 'discarded', toolCalls: [{
      id: 'decision', name: 'transition_decision', args: {
        choice: 'new_work', targetHandle: null, currentWorkDisposition: 'pause',
      },
    }] }; } },
  });
  assert.equal(observed.toolChoice.requiredToolName, 'transition_decision');
  assert.deepEqual(observed.tools.map((item) => item.name), ['transition_decision']);
  assert.equal(observed.messages.length, 1);
  assert.equal(observed.messages[0].content.includes('raw-work'), false);
  assert.equal(observed.messages[0].content.includes('raw-paused'), false);
  assert.equal(observed.messages[0].content.includes('"revision"'), false);
  assert.equal(decision.choice, 'new_work');
});

test('resume target 누락과 비정상 tool response는 scheduling receipt가 아니다', async () => {
  const base = { currentWork: { objective: '현재 일', status: 'active' },
    input: { text: '이전 일을 이어가' }, pausedCandidates: [] };
  await assert.rejects(() => decideTransition({ ...base, model: { async respond() {
    return { text: '', toolCalls: [{ name: 'transition_decision', args: {
      choice: 'resume_paused', targetHandle: null, currentWorkDisposition: 'pause',
    } }] };
  } } }), /invalid/u);
  await assert.rejects(() => decideTransition({ ...base,
    model: { async respond() { return { text: 'ordinary answer', toolCalls: [] }; } } }), /missing/u);
});
