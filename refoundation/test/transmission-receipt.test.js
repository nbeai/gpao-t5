import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { makeOpenAIResponsesModel } from '../src/openai-responses-model.js';
import { makeTransmissionReceipt, projectTransmissionReceipt } from '../src/transmission-receipt.js';

function response() { return new Response(JSON.stringify({ id: 'r1', model: 'gpt-wire',
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }] }), { status: 200 }); }

test('Transmission Receipt는 exact serialized body의 범주·bytes·digest만 남기고 내용을 노출하지 않는다', () => {
  const canary = 'PRIVATE-WIRE-CONTENT-7391';
  const body = { model: 'gpt-wire', instructions: `지침 ${canary}`, input: [
    { role: 'user', content: [{ type: 'input_text', text: `질문 ${canary}` },
      { type: 'input_image', image_url: 'data:image/png;base64,aQ==', detail: 'auto' }] },
    { type: 'function_call_output', call_id: 'c1', output: `결과 ${canary}` },
  ], tools: [{ type: 'function', name: 'exec', description: canary }] };
  const serializedBody = JSON.stringify(body);
  const receipt = makeTransmissionReceipt({ provider: 'openai', model: 'gpt-wire',
    endpoint: 'https://api.openai.com/v1/responses', serializedBody });
  assert.equal(receipt.requestBytes, Buffer.byteLength(serializedBody));
  assert.equal(receipt.wireSha256, createHash('sha256').update(serializedBody).digest('hex'));
  assert.equal(receipt.categories.user_message.items, 1); assert.equal(receipt.categories.image.items, 1);
  assert.equal(receipt.categories.tool_result.items, 1); assert.equal(receipt.categories.tool_definition.items, 1);
  assert.equal(receipt.credentialFieldsInBody, 0); assert.equal(receipt.wholeSourceNotSent, 'unknown');
  assert.doesNotMatch(JSON.stringify(receipt), new RegExp(canary, 'u'));
  assert.doesNotMatch(JSON.stringify(projectTransmissionReceipt(receipt)), new RegExp(receipt.wireSha256, 'u'));
});

test('adapter는 callback Receipt와 fetch body를 같은 serialization에서 만들고 응답 수신 상태를 반환한다', async () => {
  let exactWire = null; const attempts = [];
  const model = makeOpenAIResponsesModel({ apiKey: 'sk-private-header-only', model: 'gpt-wire',
    fetchImpl: async (_url, init) => { exactWire = init.body; return response(); } });
  const result = await model.respond({ messages: [{ role: 'user', content: '실제 전송 확인' }], tools: [],
    onTransmissionReceipt: async (receipt) => attempts.push(receipt) });
  assert.equal(attempts.length, 2); assert.deepEqual(attempts.map((item) => item.transportState), ['dispatch_attempted', 'response_received']);
  assert.equal(attempts[0].requestBytes, Buffer.byteLength(exactWire));
  assert.equal(attempts[0].wireSha256, createHash('sha256').update(exactWire).digest('hex'));
  assert.equal(result.transmissionReceipt.transportState, 'response_received');
  assert.doesNotMatch(exactWire, /sk-private-header-only/u);
});

test('dispatch 전 취소는 Transmission Receipt를 만들지 않는다', async () => {
  const controller = new AbortController(); controller.abort(); let fetches = 0; const attempts = [];
  const model = makeOpenAIResponsesModel({ apiKey: 'sk-private', model: 'gpt-wire',
    fetchImpl: async () => { fetches += 1; return response(); } });
  await assert.rejects(() => model.respond({ messages: [{ role: 'user', content: '취소' }], tools: [],
    signal: controller.signal, onTransmissionReceipt: async (receipt) => attempts.push(receipt) }), /cancelled before dispatch/u);
  assert.equal(fetches, 0); assert.equal(attempts.length, 0);
});

test('provider HTTP 오류도 response_received이고 transport throw만 dispatch_attempted에 남는다', async () => {
  for (const kind of ['http', 'transport']) {
    const states = []; const model = makeOpenAIResponsesModel({ apiKey: 'sk-private', model: 'gpt-wire',
      fetchImpl: async () => { if (kind === 'transport') throw new Error('socket lost'); return new Response('bad', { status: 500 }); } });
    await assert.rejects(() => model.respond({ messages: [{ role: 'user', content: '오류' }], tools: [],
      onTransmissionReceipt: async (receipt) => states.push(receipt.transportState) }));
    assert.deepEqual(states, kind === 'http' ? ['dispatch_attempted', 'response_received'] : ['dispatch_attempted']);
  }
});

test('exact reopen tool output이 wire에 있으면 선택 문서 일부와 전체 미전송을 confirmed로 기록한다', () => {
  const toolOutput = { state: 'observed', observation: { pages: [{ page: 421, text: 'TOTAL 7391' }],
    transmission: { category: 'document_excerpt', sourceWholeObserved: true,
      totalUnits: 500, sentUnits: 1, selectedUnits: [421], wholeSourceSent: false } } };
  const serializedBody = JSON.stringify({ model: 'gpt-wire', input: [{ type: 'function_call_output',
    call_id: 'document-reopen', output: JSON.stringify(toolOutput) }], tools: [] });
  const receipt = makeTransmissionReceipt({ provider: 'openai', model: 'gpt-wire', serializedBody });
  assert.equal(receipt.categories.document_excerpt.items, 1);
  assert.equal(receipt.originalLocalSourceScope, 'observed_complete');
  assert.equal(receipt.wholeSourceNotSent, 'confirmed');
  assert.equal(projectTransmissionReceipt(receipt).categories.find((item) => item.kind === 'document_excerpt').label,
    '선택한 문서 일부');
});
