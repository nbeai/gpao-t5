import test from 'node:test';
import assert from 'node:assert/strict';

import { makeAnthropicMessagesModel } from '../src/anthropic-messages-model.js';
import { makeChatGptResponsesModel } from '../src/chatgpt-responses-model.js';
import { makeGeminiGenerateContentModel } from '../src/gemini-generate-content-model.js';
import { makeOpenAIResponsesModel } from '../src/openai-responses-model.js';
import { makeUpstageChatCompletionsModel } from '../src/upstage-chat-completions-model.js';

function accounting(sequence) {
  return {
    async reserve(facts) { sequence.push(['reserve', facts]); return { id: sequence.length }; },
    async commit(_handle, facts) { sequence.push(['commit', facts]); },
    async unknown(_handle, facts) { sequence.push(['unknown', facts]); },
  };
}

const user = [{ role: 'user', content: 'hello' }];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('모든 model adapter는 provider fetch 전에 reserve하고 실제 usage 뒤 commit한다', async () => {
  const cases = [
    {
      name: 'openai',
      model: (fetchImpl) => makeOpenAIResponsesModel({ apiKey: 'key', model: 'openai-model', fetchImpl }),
      response: { id: 'r1', model: 'openai-model', usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }] },
    },
    {
      name: 'anthropic',
      model: (fetchImpl) => makeAnthropicMessagesModel({ apiKey: 'key', model: 'claude-model', fetchImpl }),
      response: { id: 'r2', model: 'claude-model', usage: { input_tokens: 2, output_tokens: 1 },
        content: [{ type: 'text', text: 'ok' }] },
    },
    {
      name: 'gemini',
      model: (fetchImpl) => makeGeminiGenerateContentModel({ apiKey: 'key', model: 'gemini-model', fetchImpl }),
      response: { responseId: 'r3', modelVersion: 'gemini-model',
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
        candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }] },
    },
    {
      name: 'upstage',
      model: (fetchImpl) => makeUpstageChatCompletionsModel({ apiKey: 'key', model: 'upstage-model', fetchImpl }),
      response: { id: 'r4', model: 'upstage-model', usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
        choices: [{ message: { role: 'assistant', content: 'ok' } }] },
    },
  ];
  for (const item of cases) {
    const sequence = [];
    const observer = accounting(sequence);
    const model = item.model(async () => { sequence.push(['fetch']); return json(item.response); });
    await model.respond({ messages: user, tools: [], resourceObserver: observer });
    assert.deepEqual(sequence.map(([kind]) => kind), ['reserve', 'fetch', 'commit'], item.name);
    assert.equal(sequence[0][1].attempt, 1, item.name);
    assert.ok(sequence[0][1].contextReceipt.requestBytes > 0, item.name);
  }
});

function sse(events) {
  return new Response(`${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`, {
    status: 200, headers: { 'content-type': 'text/event-stream' },
  });
}

test('ChatGPT OAuth 내부 retry는 attempt별 reserve·unknown 뒤 성공 attempt만 commit한다', async () => {
  const sequence = [];
  let attempt = 0;
  const model = makeChatGptResponsesModel({
    credentials: { async get() { return { access: 'access', modelId: 'account-model' }; } },
    maxAttempts: 2,
    wait: async () => {},
    fetchImpl: async () => {
      attempt += 1; sequence.push(['fetch', { attempt }]);
      if (attempt === 1) return new Response('temporary', { status: 500 });
      return sse([{ type: 'response.completed', response: {
        id: 'oauth-response', model: 'account-model',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
        usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
      } }]);
    },
  });
  await model.respond({ messages: user, tools: [], resourceObserver: accounting(sequence) });
  assert.deepEqual(sequence.map(([kind]) => kind), [
    'reserve', 'fetch', 'unknown', 'reserve', 'fetch', 'commit',
  ]);
  assert.equal(sequence[0][1].attempt, 1);
  assert.equal(sequence[3][1].attempt, 2);
});

test('provider fetch 이전 reserve 실패는 요청을 실행하지 않는다', async () => {
  let fetched = false;
  const model = makeOpenAIResponsesModel({
    apiKey: 'key', fetchImpl: async () => { fetched = true; return json({}); },
  });
  await assert.rejects(model.respond({
    messages: user, tools: [],
    resourceObserver: { async reserve() { throw new Error('ledger unavailable'); } },
  }), /ledger unavailable/u);
  assert.equal(fetched, false);
});

test('dispatch 뒤 cancel·transport 단절은 사용량 0이 아니라 unknown으로 정산한다', async () => {
  const sequence = [];
  const model = makeOpenAIResponsesModel({
    apiKey: 'key',
    fetchImpl: async () => { sequence.push(['fetch']); throw new Error('aborted transport'); },
  });
  await assert.rejects(model.respond({
    messages: user, tools: [], resourceObserver: accounting(sequence),
  }), /aborted transport/u);
  assert.deepEqual(sequence.map(([kind]) => kind), ['reserve', 'fetch', 'unknown']);
  assert.equal(sequence[2][1].reason, 'provider_transport_unknown');
});
