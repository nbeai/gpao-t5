import test from 'node:test';
import assert from 'node:assert/strict';

import { runAgent } from '../src/agent-loop.js';

test('model adapter의 Context Receipt가 model_completed 사건까지 손실 없이 전달된다', async () => {
  const receipt = {
    schema: 't5.context-receipt.v1', provider: 'test', model: 'test-model', requestBytes: 99,
  };
  const events = [];
  const result = await runAgent({
    request: '안녕',
    model: { async respond() { return {
      text: '반가워요', toolCalls: [], usage: { input_tokens: 7, output_tokens: 2, total_tokens: 9 },
      contextReceipt: receipt,
    }; } },
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.modelCalls[0].contextReceipt.requestBytes, 99);
  assert.deepEqual(events.find((event) => event.type === 'model_end').response.contextReceipt, receipt);
});

test('provider 실패 전 만들어진 Context Receipt도 model_context 사건으로 남는다', async () => {
  const receipt = {
    schema: 't5.context-receipt.v1', provider: 'test', model: 'test-model', requestBytes: 12345,
  };
  const events = [];
  await assert.rejects(() => runAgent({
    request: '너무 큰 요청',
    model: { async respond({ onContextReceipt }) {
      await onContextReceipt(receipt);
      throw new Error('context length exceeded');
    } },
    onEvent: (event) => events.push(event),
  }), /context length exceeded/);
  assert.deepEqual(events.find((event) => event.type === 'model_context').contextReceipt, receipt);
  assert.equal(events.some((event) => event.type === 'model_end'), false);
});
