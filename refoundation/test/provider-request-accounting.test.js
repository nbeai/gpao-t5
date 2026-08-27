import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { makeAnthropicMessagesModel } from '../src/anthropic-messages-model.js';
import { makeChatGptResponsesModel } from '../src/chatgpt-responses-model.js';
import { makeGeminiGenerateContentModel } from '../src/gemini-generate-content-model.js';
import { makeOpenAIResponsesModel } from '../src/openai-responses-model.js';
import { makeUpstageChatCompletionsModel } from '../src/upstage-chat-completions-model.js';
import { ResourceController } from '../src/resource-controller.js';
import { ResourceLedger } from '../src/resource-ledger.js';

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
    const sequence = []; let wire = null; const transmissions = [];
    const observer = accounting(sequence);
    const model = item.model(async (_url, init) => { wire = init.body; sequence.push(['fetch']); return json(item.response); });
    const result = await model.respond({ messages: user, tools: [], resourceObserver: observer,
      onTransmissionReceipt: async (receipt) => transmissions.push(receipt) });
    assert.deepEqual(sequence.map(([kind]) => kind), ['reserve', 'fetch', 'commit'], item.name);
    assert.equal(sequence[0][1].attempt, 1, item.name);
    assert.ok(sequence[0][1].contextReceipt.requestBytes > 0, item.name);
    assert.equal(transmissions.length, 2, item.name);
    assert.deepEqual(transmissions.map((receipt) => receipt.transportState), ['dispatch_attempted', 'response_received'], item.name);
    assert.equal(transmissions[0].requestBytes, Buffer.byteLength(wire), item.name);
    assert.equal(transmissions[0].wireSha256, createHash('sha256').update(wire).digest('hex'), item.name);
    assert.equal(result.transmissionReceipt.transportState, 'response_received', item.name);
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

test('generic observer reserve 실패도 degraded 진단 뒤 정상 provider 작업을 계속한다', async () => {
  let fetched = false;
  const model = makeOpenAIResponsesModel({
    apiKey: 'key', fetchImpl: async () => { fetched = true; return json({
      id: 'response', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
    }); },
  });
  const diagnostics = [];
  const result = await model.respond({
    messages: user, tools: [],
    resourceObserver: {
      async reserve() { throw new Error('ledger unavailable'); },
      async degraded(value) { diagnostics.push(value.stage); },
    },
  });
  assert.equal(result.text, 'ok');
  assert.equal(fetched, true);
  assert.deepEqual(diagnostics, ['reservation']);
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

function storageFailingAt(failType) {
  let body = '';
  let failures = 0;
  return {
    get failures() { return failures; },
    async prepare() {
      if (failType === 'prepare') { failures += 1; throw new Error('storage prepare failed'); }
    },
    async read() { return body; },
    async append(line) {
      const event = JSON.parse(line);
      if (event.type === failType) { failures += 1; throw new Error(`storage ${failType} failed`); }
      body += line;
    },
  };
}

function successfulOpenAiModel() {
  let fetches = 0;
  const model = makeOpenAIResponsesModel({
    apiKey: 'key',
    fetchImpl: async () => {
      fetches += 1;
      return json({
        id: 'response', model: 'model',
        usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '사용자 결과' }] }],
      });
    },
  });
  return { model, fetches: () => fetches };
}

for (const [label, failType, expectedStage] of [
  ['startRun', 'prepare', 'start_run'],
  ['reserve', 'ResourceReserved', 'reservation'],
  ['settlement', 'ReservationCommitted', 'settlement'],
]) {
  test(`${label} storage 실패는 accounting_degraded를 남기고 사용자 model 결과를 바꾸지 않는다`, async () => {
    const storage = storageFailingAt(failType);
    const ledger = new ResourceLedger('fault-storage', { storage });
    const controller = new ResourceController(ledger);
    const diagnostics = [];
    const run = await controller.startRun({
      sessionId: `session-${label}`, runId: `run-${label}`,
      onDiagnostic: async (value) => diagnostics.push(value),
    });
    const provider = successfulOpenAiModel();
    const result = await provider.model.respond({
      messages: user, tools: [],
      resourceObserver: run.modelObserver({ logicalCallId: 'main:1', purpose: 'main' }),
    });
    assert.equal(result.text, '사용자 결과');
    assert.equal(provider.fetches(), 1);
    assert.equal(storage.failures, 1);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].state, 'accounting_degraded');
    assert.equal(diagnostics[0].stage, expectedStage);
    assert.doesNotMatch(JSON.stringify(diagnostics), /fault-storage|storage .* failed/u);
  });
}
