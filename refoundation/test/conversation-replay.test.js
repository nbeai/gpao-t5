import test from 'node:test';
import assert from 'node:assert/strict';

import { runAgent } from '../src/agent-loop.js';

test('agent loop는 이전 Run의 assistant tool call과 tool result를 다음 모델 호출에 보존한다', async () => {
  const history = [
    { role: 'user', content: '파일 값을 확인해줘' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'old-call', name: 'exec', args: { command: 'read-value' } }] },
    { role: 'tool', toolCallId: 'old-call', name: 'exec', content: '{"stdout":"value-7391"}' },
    { role: 'assistant', content: '확인했습니다.' },
  ];
  const model = { async respond(input) {
    assert.deepEqual(input.messages, [
      ...history,
      { role: 'user', content: '아까 확인한 값만 알려줘' },
    ]);
    return { text: 'value-7391', toolCalls: [] };
  } };
  const result = await runAgent({ request: '아까 확인한 값만 알려줘', history, model });
  assert.equal(result.answer, 'value-7391');
  assert.equal(result.receipts.length, 0);
});
