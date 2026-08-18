import test from 'node:test';
import assert from 'node:assert/strict';

import { makeContextReceipt } from '../src/context-receipt.js';
import { deriveRunContextReport } from '../src/run-context-receipt.js';

test('Context Receipt는 실제 요청 byte와 항목 종류만 기록하고 내용은 노출하지 않는다', () => {
  const secret = 'private-context-sentinel';
  const instructions = `system ${secret}`;
  const sourceMessages = [
    { role: 'user', content: `질문 ${secret}` },
    { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'exec', args: { command: secret } }] },
    { role: 'tool', toolCallId: 'call-1', name: 'exec', content: `result ${secret}` },
    { role: 'user', content: '현재 요청' },
  ];
  const input = [
    { role: 'user', content: `질문 ${secret}` },
    { type: 'function_call', call_id: 'call-1', name: 'exec', arguments: `{"command":"${secret}"}` },
    { type: 'function_call_output', call_id: 'call-1', output: `result ${secret}` },
    { role: 'user', content: '현재 요청' },
  ];
  const tools = [{ type: 'function', name: 'exec', description: `tool ${secret}` }];
  const body = { model: 'gpt-test', instructions, input, tools, store: false };
  const receipt = makeContextReceipt({
    provider: 'openai', model: 'gpt-test', instructions, input, tools, sourceMessages, body,
  });
  assert.equal(receipt.schema, 't5.context-receipt.v1');
  assert.equal(receipt.requestBytes, Buffer.byteLength(JSON.stringify(body)));
  assert.equal(receipt.instructionsBytes, Buffer.byteLength(instructions));
  assert.equal(receipt.input.items, 4);
  assert.equal(receipt.input.byKind.function_call.items, 1);
  assert.equal(receipt.input.byKind.function_call_output.items, 1);
  assert.equal(receipt.source.byRole.user.items, 2);
  assert.equal(receipt.source.currentUserBytes, Buffer.byteLength('현재 요청'));
  assert.equal(receipt.tools.definitions, 1);
  assert.equal(receipt.tools.byName.exec.items, 1);
  assert.ok(receipt.tools.byName.exec.bytes > 0);
  assert.doesNotMatch(JSON.stringify(receipt), new RegExp(secret));
});

test('Run Context Report는 call별 실제 크기와 provider usage를 같은 순서로 결합한다', () => {
  const contextReceipt = {
    schema: 't5.context-receipt.v1', provider: 'openai', model: 'gpt-test',
    requestBytes: 1200, instructionsBytes: 200,
    input: { items: 2, bytes: 500, byKind: {} },
    tools: { definitions: 1, bytes: 300 },
    source: { messages: 2, bytes: 400, currentUserBytes: 20, byRole: {} },
  };
  const run = { runId: 'run-1', status: 'completed', events: [
    { type: 'model_completed', stepId: 'model-1', payload: { turn: 1, response: {
      contextReceipt, usage: { input_tokens: 321, output_tokens: 12, total_tokens: 333 },
    } } },
  ] };
  const report = deriveRunContextReport(run);
  assert.equal(report.calls.length, 1);
  assert.equal(report.calls[0].context.requestBytes, 1200);
  assert.equal(report.calls[0].providerUsage.inputTokens, 321);
  assert.deepEqual(report.aggregate, {
    calls: 1, requestBytes: 1200, inputBytes: 500, instructionsBytes: 200,
    toolSchemaBytes: 300, providerInputTokens: 321,
  });
});
