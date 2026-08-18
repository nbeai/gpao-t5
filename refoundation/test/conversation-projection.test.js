import test from 'node:test';
import assert from 'node:assert/strict';

import {
  projectHistoricalConversation, projectHistoricalConversationEntries,
  repairIncompleteToolCallMessages,
} from '../src/conversation-projection.js';

function terminalReceipt() {
  return {
    toolCallId: 'call-1',
    requestedCall: { id: 'call-1', name: 'exec', args: { command: 'cat value.txt', cwd: null } },
    actualCall: { name: 'exec', args: { command: 'cat value.txt', cwd: null } },
    outcome: 'succeeded',
    result: {
      state: 'completed', cwd: '/tmp/work', stdout: 'PROJECTION-7391\n', stderr: '',
      truncated: false, omittedChars: 0, exitCode: 0, signal: null, durationMs: 17,
      startedAt: '2026-08-19T00:00:00Z', endedAt: '2026-08-19T00:00:00Z',
      effectObservation: {
        declared: { kind: 'observe', summary: 'read value', targets: ['/tmp/work/value.txt'], reversible: true },
        before: { observed: true, targets: [{ path: '/tmp/work/value.txt', sha256: 'a'.repeat(64) }] },
        after: { observed: true, targets: [{ path: '/tmp/work/value.txt', sha256: 'a'.repeat(64) }] },
        changed: false,
      },
      commandExplanation: {
        ok: true, source: 'cat value.txt',
        steps: Array.from({ length: 20 }, (_, index) => ({ id: `step-${index}`, executable: 'cat' })),
      },
    },
  };
}

test('과거 terminal receipt projection은 현실 결과를 보존하고 중복 회계만 제거한다', () => {
  const receipt = terminalReceipt();
  const messages = [
    { role: 'user', content: '값을 읽어줘' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'exec', args: { command: 'cat value.txt', cwd: null } }] },
    { role: 'tool', toolCallId: 'call-1', name: 'exec', content: JSON.stringify(receipt) },
    { role: 'assistant', content: '확인했습니다.' },
  ];
  const before = structuredClone(messages);
  const projected = projectHistoricalConversation(messages);
  assert.deepEqual(messages, before);
  assert.deepEqual(projected.slice(0, 2), messages.slice(0, 2));
  const compact = JSON.parse(projected[2].content);
  assert.equal(compact.schema, 't5.historical-tool-receipt.v1');
  assert.equal(compact.toolCallId, 'call-1');
  assert.equal(compact.tool, 'exec');
  assert.equal(compact.outcome, 'succeeded');
  assert.equal(compact.result.stdout, 'PROJECTION-7391\n');
  assert.equal(compact.result.exitCode, 0);
  assert.equal(compact.result.effect.kind, 'observe');
  assert.equal(compact.result.effect.changed, false);
  assert.doesNotMatch(projected[2].content, /commandExplanation|startedAt|sha256/);
  assert.ok(Buffer.byteLength(projected[2].content) < Buffer.byteLength(messages[2].content) * 0.4);
});

test('skill·알 수 없는 도구·해석할 수 없는 receipt는 손실을 피하려고 원문을 유지한다', () => {
  const messages = [
    { role: 'tool', toolCallId: 'skill-1', name: 'skill', content: '{"content":"full skill"}' },
    { role: 'tool', toolCallId: 'other-1', name: 'custom', content: '{"result":"opaque"}' },
    { role: 'tool', toolCallId: 'bad-1', name: 'exec', content: 'not-json' },
  ];
  assert.deepEqual(projectHistoricalConversation(messages), messages);
});

test('승인 전 미실행 receipt는 pending ID와 이유를 보존한다', () => {
  const receipt = {
    toolCallId: 'gate-1', requestedCall: { id: 'gate-1', name: 'exec', args: {} },
    actualCall: null, outcome: 'not_executed',
    result: {
      state: 'approval_required', pendingId: 'pending-7', reason: 'destructive',
      effect: { kind: 'destructive', summary: 'delete', targets: ['/tmp/a'] },
      command: 'rm /tmp/a', cwd: '/tmp',
    },
  };
  const projected = projectHistoricalConversation([{
    role: 'tool', toolCallId: 'gate-1', name: 'exec', content: JSON.stringify(receipt),
  }]);
  const compact = JSON.parse(projected[0].content);
  assert.equal(compact.outcome, 'not_executed');
  assert.equal(compact.result.state, 'approval_required');
  assert.equal(compact.result.pendingId, 'pending-7');
  assert.equal(compact.result.reason, 'destructive');
  assert.equal(compact.result.command, 'rm /tmp/a');
});

test('큰 historical stdout은 head·tail·message ref만 보이고 중간 원문은 canonical에 남는다', () => {
  const receipt = terminalReceipt();
  receipt.result.stdout = `${'H'.repeat(9_000)}MIDDLE-NEEDLE-7391${'T'.repeat(9_000)}`;
  const originalContent = JSON.stringify(receipt);
  const entries = [{
    messageId: 'large-tool-message', runId: 'run-large',
    message: { role: 'tool', toolCallId: 'call-1', name: 'exec', content: originalContent },
  }];
  const projection = projectHistoricalConversationEntries(entries, {
    largeOutputMode: 'recoverable', maxInlineOutputChars: 8_000, previewChars: 1_000,
  });
  assert.equal(projection.messages.length, 1);
  assert.equal(projection.recoverable.length, 1);
  assert.deepEqual(projection.recoverable[0], {
    messageId: 'large-tool-message', stream: 'stdout', totalChars: 18_018,
  });
  const compact = JSON.parse(projection.messages[0].content);
  assert.doesNotMatch(compact.result.stdout, /MIDDLE-NEEDLE-7391/);
  assert.match(compact.result.stdout, /^H+/);
  assert.match(compact.result.stdout, /T+$/);
  assert.deepEqual(compact.result.stdoutProjection, {
    state: 'recoverable', messageId: 'large-tool-message', stream: 'stdout',
    totalChars: 18_018, inlineChars: 2_000, omittedChars: 16_018,
    recallTool: 'conversation_recall',
  });
  assert.equal(entries[0].message.content, originalContent);
  assert.ok(Buffer.byteLength(projection.messages[0].content) < Buffer.byteLength(originalContent) * 0.2);
});

test('재시작 때 tool result가 없는 function call은 provider projection에만 unknown interruption을 채운다', () => {
  const messages = [
    { role: 'user', content: '긴 작업을 해줘' },
    { role: 'assistant', content: '', toolCalls: [{
      id: 'interrupted-call', name: 'exec', args: { command: 'long-task', cwd: null },
    }] },
    { role: 'user', content: '다음 요청' },
  ];
  const before = structuredClone(messages);
  const repaired = repairIncompleteToolCallMessages(messages);
  assert.deepEqual(messages, before);
  assert.equal(repaired.length, 4);
  assert.equal(repaired[2].role, 'tool');
  assert.equal(repaired[2].toolCallId, 'interrupted-call');
  const receipt = JSON.parse(repaired[2].content);
  assert.equal(receipt.outcome, 'interrupted_unknown');
  assert.equal(receipt.result.state, 'interrupted');
  assert.equal(receipt.result.executionKnown, false);
  assert.match(receipt.result.reason, /inspect current reality/i);
});
