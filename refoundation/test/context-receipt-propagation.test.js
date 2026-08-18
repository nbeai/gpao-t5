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
