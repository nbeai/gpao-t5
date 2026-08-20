import test from 'node:test';
import assert from 'node:assert/strict';

import { makeGeminiGenerateContentModel } from '../src/gemini-generate-content-model.js';

const TOOL = {
  name: 'exec', description: 'Run a command.',
  parameters: {
    type: 'object', properties: {
      command: { type: 'string' }, cwd: { type: ['string', 'null'] },
    }, required: ['command', 'cwd'], additionalProperties: false,
  },
};

test('Gemini adapter는 thought signature가 든 원래 functionCall Part와 exact ID를 보존한다', async () => {
  const requests = [];
  const functionPart = {
    functionCall: { id: 'call-1', name: 'exec', args: { command: 'pwd' } },
    thoughtSignature: 'opaque-signature',
  };
  const responses = [
    { responseId: 'gem-1', modelVersion: 'gemini-3.6-flash', usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4 }, candidates: [{ content: { role: 'model', parts: [
      { text: '확인할게요.' }, functionPart,
    ] } }] },
    { responseId: 'gem-2', modelVersion: 'gemini-3.6-flash', usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 4, totalTokenCount: 27 }, candidates: [{ content: { role: 'model', parts: [
      { text: '확인했습니다.' },
    ] } }] },
  ];
  const model = makeGeminiGenerateContentModel({
    apiKey: 'gemini-secret', model: 'gemini-3.6-flash', instructions: 'system',
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init, body: JSON.parse(init.body) });
      return new Response(JSON.stringify(responses.shift()), { status: 200 });
    },
  });
  const first = await model.respond({ messages: [{ role: 'user', content: '현재 위치?' }], tools: [TOOL] });
  assert.equal(first.text, '확인할게요.');
  assert.deepEqual(first.toolCalls.map(({ id, name, args }) => ({ id, name, args })), [
    { id: 'call-1', name: 'exec', args: { command: 'pwd' } },
  ]);
  const receipt = '{"outcome":"succeeded","result":{"stdout":"/tmp"}}';
  const second = await model.respond({ messages: [
    { role: 'user', content: '현재 위치?' },
    { role: 'assistant', content: first.text, toolCalls: first.toolCalls },
    { role: 'tool', toolCallId: 'call-1', name: 'exec', content: receipt },
  ], tools: [TOOL] });
  assert.equal(second.text, '확인했습니다.');
  assert.deepEqual(second.usage, {
    promptTokenCount: 20, candidatesTokenCount: 4, totalTokenCount: 27,
    input_tokens: 20, output_tokens: 4, total_tokens: 27,
  });
  assert.equal(requests[0].init.headers['x-goog-api-key'], 'gemini-secret');
  assert.deepEqual(requests[0].body.tools, [{ functionDeclarations: [{
    name: 'exec', description: 'Run a command.', parameters: {
      type: 'object', properties: {
        command: { type: 'string' }, cwd: { type: 'string', nullable: true },
      }, required: ['command', 'cwd'],
    },
  }] }]);
  assert.deepEqual(requests[1].body.contents.at(-2).parts[1], functionPart);
  assert.deepEqual(requests[1].body.contents.at(-1), {
    role: 'user', parts: [{ functionResponse: { id: 'call-1', name: 'exec', response: { result: receipt } } }],
  });
});

test('Gemini 오류는 API 키를 반사하지 않는다', async () => {
  const secret = 'gemini-reflected';
  const model = makeGeminiGenerateContentModel({
    apiKey: secret,
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: `invalid ${secret}` } }), { status: 403 }),
  });
  await assert.rejects(model.respond({ messages: [{ role: 'user', content: '안녕' }] }),
    (error) => error.status === 403 && !String(error).includes(secret));
});
