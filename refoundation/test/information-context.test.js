import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveInformationReport, historicalInformation, measureModelInformation,
  projectConversationEntriesForCurrentPurpose,
} from '../src/information-context.js';

test('모든 사용자 교정과 마지막 turn은 유지하고 오래된 assistant/tool 구간만 exact handle로 바꾼다', () => {
  const entries = [
    { messageId: 'u1', message: { role: 'user', content: '첫 요청' } },
    { messageId: 'a1', message: { role: 'assistant', content: 'OLD-NEEDLE assistant fact' } },
    { messageId: 'u2', message: { role: 'user', content: '첫 교정' } },
    { messageId: 'a2', message: { role: 'assistant', content: '두 번째 답' } },
    { messageId: 't2', message: { role: 'tool', content: 'tool evidence' } },
    { messageId: 'u3', message: { role: 'user', content: '현재 교정' } },
    { messageId: 'a3', message: { role: 'assistant', content: '현재 대상' } },
  ];
  const result = projectConversationEntriesForCurrentPurpose(entries, { sessionId: 'session' });
  const messages = result.entries.map((entry) => entry.message);
  assert.deepEqual(messages.filter((message) => message.role === 'user').map((message) => message.content), [
    '첫 요청', '첫 교정', '현재 교정',
  ]);
  assert.equal(messages.some((message) => message.content === '현재 대상'), true);
  assert.equal(messages.some((message) => /OLD-NEEDLE/u.test(message.content)), false);
  assert.equal(result.omittedMessages, 3);
  assert.equal(result.recallHandles.length, 2);
  assert.equal(result.recallHandles[0].firstMessageId, 'a1');
  assert.equal(result.recallHandles[1].includeTools, true);
  assert.match(messages.find((message) => /HISTORICAL ASSISTANT/u.test(message.content)).content,
    /sessionId=session/u);
});

test('Conversation·Memory shadow는 원문 없이 role·kind·source session별 bytes를 분리한다', () => {
  const information = historicalInformation({
    sessionId: 'current',
    conversationMessages: [
      { role: 'user', content: 'old request' }, { role: 'assistant', content: 'old answer' },
    ],
    memoryItems: [
      { kind: 'user', content: 'preference', source: { sessionId: 'other' } },
      { kind: 'work', content: 'current decision', source: { sessionId: 'current' } },
      { kind: 'work', content: 'unscoped' },
    ],
    memoryMessage: { role: 'assistant', content: 'projected memory' }, checkpoint: { id: 'checkpoint' },
  });
  assert.equal(information.conversation.messages, 2);
  assert.equal(information.conversation.byRole.user.messages, 1);
  assert.equal(information.memory.items, 3);
  assert.equal(information.memory.userItems, 1);
  assert.equal(information.memory.workItems, 2);
  assert.equal(information.memory.currentSessionItems, 1);
  assert.equal(information.memory.otherSessionItems, 1);
  assert.equal(information.memory.unscopedItems, 1);
  assert.equal(information.conversation.checkpointPresent, true);
  assert.doesNotMatch(JSON.stringify(information), /old request|preference|current decision/u);
});

test('같은 현재 Run ToolReceipt가 다음 모델 호출에 다시 들어간 bytes를 정확히 누적한다', () => {
  const exposures = new Map();
  const tool = { role: 'tool', toolCallId: 'call-1', name: 'exec', content: 'x'.repeat(5_000) };
  const first = measureModelInformation({
    currentRequest: { role: 'user', content: 'request' }, currentRunMessages: [tool],
    tools: [{ name: 'exec', description: 'execute', parameters: {} }], toolExposures: exposures,
  });
  const second = measureModelInformation({
    currentRequest: { role: 'user', content: 'request' }, currentRunMessages: [tool],
    tools: [{ name: 'exec', description: 'execute', parameters: {} }], toolExposures: exposures,
  });
  assert.equal(first.repeatedToolReceiptBytes, 0);
  assert.equal(second.repeatedToolReceiptBytes, second.currentRunToolReceiptBytes);
  assert.equal(second.currentRunToolReceiptBytes, Buffer.byteLength(JSON.stringify(tool)));
});

test('정보 report는 실제 사용하지 않은 Hand schema와 반복 Receipt를 Run 전체에서 분리한다', () => {
  const payload = {
    historicalConversationBytes: 100, memoryBytes: 20, currentRequestBytes: 30,
    currentRunToolReceiptBytes: 50, repeatedToolReceiptBytes: 40,
    activeToolDefinitionBytes: 300, toolDefinitionBytesByName: { exec: 100, automation: 200 },
    requiredRecoveryTools: ['exec'],
  };
  const events = [
    { type: 'information_context_built', payload: { ...payload, turn: 1 } },
    { type: 'information_surface_focused', payload: { turn: 1, selectedTool: 'exec' } },
    { type: 'information_context_built', payload: { ...payload, turn: 2 } },
    { type: 'tool_completed', payload: { receipt: { actualCall: { name: 'exec' } } } },
  ];
  const report = deriveInformationReport(events);
  assert.equal(report.historicalConversationBytesSupplied, 200);
  assert.equal(report.memoryBytesSupplied, 40);
  assert.equal(report.repeatedToolReceiptBytesSupplied, 80);
  assert.equal(report.activeToolDefinitionBytesSupplied, 600);
  assert.equal(report.unusedToolDefinitionBytesSupplied, 400);
  assert.equal(report.unusedNonRecoveryToolDefinitionBytesSupplied, 400);
  assert.equal(report.unusedNonRecoveryAfterFocusBytesSupplied, 200);
  assert.deepEqual(report.usedTools, ['exec']);
});
