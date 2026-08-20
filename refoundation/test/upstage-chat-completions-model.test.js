import test from 'node:test';
import assert from 'node:assert/strict';

import { makeUpstageChatCompletionsModel } from '../src/upstage-chat-completions-model.js';

test('Upstage Chat는 function call ID를 보존해 도구 결과와 최종 답을 왕복한다', async () => {
  const requests = [];
  const replies = [
    {
      id: 'chatcmpl-1', model: 'solar-pro4', usage: {
        prompt_tokens: 12, completion_tokens: 4, total_tokens: 16,
      },
      choices: [{ message: { role: 'assistant', content: null, reasoning: '도구가 필요함', tool_calls: [{
        id: 'call-weather-1', type: 'function', function: {
          name: 'weather', arguments: '{"city":"서울"}',
        },
      }] } }],
    },
    {
      id: 'chatcmpl-2', model: 'solar-pro4', usage: {
        prompt_tokens: 20, completion_tokens: 7, total_tokens: 27,
      },
      choices: [{ message: { role: 'assistant', content: '서울은 맑아요.' } }],
    },
  ];
  const model = makeUpstageChatCompletionsModel({
    apiKey: 'upstage-secret', model: 'solar-pro4', instructions: 'system',
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init, body: JSON.parse(init.body) });
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    },
  });
  const tools = [{
    name: 'weather', description: '날씨 조회', parameters: {
      type: 'object', properties: { city: { type: 'string' } }, required: ['city'],
    },
  }];

  const first = await model.respond({ messages: [{ role: 'user', content: '서울 날씨' }], tools });
  assert.deepEqual(first.toolCalls, [{
    id: 'call-weather-1', name: 'weather', args: { city: '서울' },
    providerPart: {
      id: 'call-weather-1', type: 'function', function: {
        name: 'weather', arguments: '{"city":"서울"}',
      },
    },
  }]);
  assert.deepEqual(first.usage, {
    prompt_tokens: 12, completion_tokens: 4, total_tokens: 16,
    input_tokens: 12, output_tokens: 4,
  });

  const second = await model.respond({ messages: [
    { role: 'user', content: '서울 날씨' },
    { role: 'assistant', content: '', toolCalls: first.toolCalls },
    { role: 'tool', toolCallId: 'call-weather-1', content: '{"condition":"맑음"}' },
  ], tools });
  assert.equal(second.text, '서울은 맑아요.');
  assert.equal(requests[0].url, 'https://api.upstage.ai/v1/chat/completions');
  assert.equal(requests[0].init.headers.authorization, 'Bearer upstage-secret');
  assert.equal(requests[0].body.messages[0].role, 'system');
  assert.equal(requests[0].body.reasoning_effort, 'medium');
  assert.equal(requests[0].body.tools[0].function.name, 'weather');
  assert.deepEqual(requests[1].body.messages.at(-1), {
    role: 'tool', tool_call_id: 'call-weather-1', content: '{"condition":"맑음"}',
  });
  assert.equal(requests[1].body.messages.at(-2).reasoning, '도구가 필요함');
  for (const request of requests) assert.doesNotMatch(JSON.stringify(request.body), /upstage-secret/);
});

test('Upstage 오류가 API 키를 되비춰도 공개 오류에서는 가린다', async () => {
  const secret = 'upstage-reflected-secret';
  const model = makeUpstageChatCompletionsModel({
    apiKey: secret,
    fetchImpl: async () => new Response(JSON.stringify({
      error: { message: `invalid ${secret}` },
    }), { status: 401 }),
  });
  await assert.rejects(
    model.respond({ messages: [{ role: 'user', content: '안녕' }] }),
    (error) => error.status === 401 && !String(error).includes(secret),
  );
});
