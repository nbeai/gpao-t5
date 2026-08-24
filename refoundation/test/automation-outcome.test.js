import test from 'node:test';
import assert from 'node:assert/strict';

import { assessAutomationOutcome } from '../src/automation-outcome-tool.js';
import { makeAutomationOutcomeTool } from '../src/automation-outcome-tool.js';

test('scheduled objective와 scheduler-owned delivery는 한 완료 도구에서 경쟁하지 않는다', () => {
  const tool = makeAutomationOutcomeTool();
  assert.match(tool.description, /delivery is owned and settled separately by the scheduler/u);
  assert.match(tool.description, /do not declare not_achieved merely because/u);
});

function receipt(id, name, { state = 'acted', effect = null, result = {} } = {}) {
  return {
    toolCallId: id, requestedCall: { name, args: { ...(effect ? { effect } : {}) } },
    actualCall: { name, args: {} }, outcome: 'succeeded', result: { state, ...result },
  };
}

test('모델 완료 문장만 있고 목적 영수증이 없으면 자동화 성공이 아니다', () => {
  assert.deepEqual(assessAutomationOutcome({ receipts: [receipt('read', 'notion')] }), {
    achieved: false, reason: 'automation_outcome_missing', summary: '예약 목적 달성 영수증이 없습니다.',
  });
});

test('필요 도구·외부 효과·결과 URL이 실제 영수증과 결속돼야 achieved다', () => {
  const effect = {
    kind: 'external_send', summary: '게시', targets: ['https://blog.example/me'],
    reversible: false, backupAvailable: false, recipientNew: false, approvalToken: null,
  };
  const receipts = [
    receipt('source', 'notion'),
    receipt('publish', 'browser', { effect, result: { tab: { url: 'https://blog.example/me/posts/7' } } }),
    {
      ...receipt('finish', 'automation_outcome'),
      result: {
        state: 'declared', status: 'achieved', summary: '게시했습니다.', remaining: null,
        evidenceToolCallIds: ['source', 'publish'], resultUrls: ['https://blog.example/me/posts/7'],
      },
    },
  ];
  const result = assessAutomationOutcome({ receipts, requirements: {
    requiredTools: ['notion', 'browser'], requiredEffect: 'external_send', requireResultUrl: true,
  } });
  assert.equal(result.achieved, true);
});

test('원고 읽기만 하고 게시 도구·URL이 없으면 achieved 선언도 거부된다', () => {
  const receipts = [receipt('source', 'notion'), {
    ...receipt('finish', 'automation_outcome'),
    result: {
      state: 'declared', status: 'achieved', summary: '게시했습니다.', remaining: null,
      evidenceToolCallIds: ['source'], resultUrls: [],
    },
  }];
  const result = assessAutomationOutcome({ receipts, requirements: {
    requiredTools: ['notion', 'browser'], requiredEffect: 'external_send', requireResultUrl: true,
  } });
  assert.equal(result.achieved, false);
  assert.equal(result.reason, 'automation_required_tool_missing');
});
