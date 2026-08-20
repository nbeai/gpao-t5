import test from 'node:test';
import assert from 'node:assert/strict';

import { makeAnthropicMessagesModel } from '../src/anthropic-messages-model.js';

const TOOL = {
  name: 'exec', description: 'Run a command.',
  parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false },
};

test('Claude adapter는 tool_use와 즉시 뒤 user tool_result를 같은 ID로 왕복한다', async () => {
  const requests = [];
  const providerToolPart = { type: 'tool_use', id: 'toolu_1', name: 'exec', input: { command: 'pwd' } };
  const responses = [
    { id: 'msg-1', model: 'claude-sonnet-5', role: 'assistant', stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 4 }, content: [
      { type: 'text', text: '확인할게요.' },
      providerToolPart,
    ] },
    { id: 'msg-2', model: 'claude-sonnet-5', role: 'assistant', stop_reason: 'end_turn', usage: { input_tokens: 20, output_tokens: 5 }, content: [
      { type: 'text', text: '확인했습니다.' },
    ] },
  ];
  const model = makeAnthropicMessagesModel({
    apiKey: 'sk-ant-secret', model: 'claude-sonnet-5', instructions: 'system',
    fetchImpl: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return new Response(JSON.stringify(responses.shift()), { status: 200 });
    },
  });
  const first = await model.respond({ messages: [{ role: 'user', content: '현재 위치?' }], tools: [TOOL] });
  assert.equal(first.text, '확인할게요.');
  assert.deepEqual(first.toolCalls.map(({ id, name, args }) => ({ id, name, args })), [
    { id: 'toolu_1', name: 'exec', args: { command: 'pwd' } },
  ]);
  const receipt = '{"outcome":"succeeded","result":{"stdout":"/tmp"}}';
  const second = await model.respond({ messages: [
    { role: 'user', content: '현재 위치?' },
    { role: 'assistant', content: first.text, toolCalls: first.toolCalls },
    { role: 'tool', toolCallId: 'toolu_1', name: 'exec', content: receipt },
  ], tools: [TOOL] });
  assert.equal(second.text, '확인했습니다.');
  assert.deepEqual(second.usage, { input_tokens: 20, output_tokens: 5, total_tokens: 25 });
  assert.equal(requests[0].init.headers['x-api-key'], 'sk-ant-secret');
  assert.equal(requests[0].init.headers['anthropic-version'], '2023-06-01');
  assert.deepEqual(requests[0].body.tools[0], {
    name: 'exec', description: 'Run a command.', input_schema: TOOL.parameters, strict: true,
  });
  assert.deepEqual(requests[1].body.messages.at(-2).content[1], providerToolPart);
  assert.deepEqual(requests[1].body.messages.at(-1), {
    role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: receipt }],
  });
});

test('Claude 오류는 API 키를 반사하지 않는다', async () => {
  const secret = 'sk-ant-reflected';
  const model = makeAnthropicMessagesModel({
    apiKey: secret,
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: `invalid ${secret}` } }), { status: 401 }),
  });
  await assert.rejects(model.respond({ messages: [{ role: 'user', content: '안녕' }] }),
    (error) => error.status === 401 && !String(error).includes(secret));
});
