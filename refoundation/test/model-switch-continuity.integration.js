import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

test('모델을 바꿔도 canonical 대화는 이어지고 첫 새 Run에 compatibility Receipt가 남는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-model-switch-')); let active = 'openai';
  const status = () => ({ connected: true, provider: active, modelId: active === 'openai' ? 'gpt-test' : 'claude-test',
    capabilityManifest: { wire: active === 'openai' ? 'openai-responses' : 'anthropic-messages' } });
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace: room, modelStatus: status,
    modelFactory: () => ({ async respond({ messages }) {
      const users = messages.filter((message) => message.role === 'user').map((message) => message.content);
      return { text: users.join(' | '), toolCalls: [] };
    } }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id, text: '첫 요청' }) });
    active = 'anthropic';
    const second = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id, text: '둘째 요청' }) }).then((response) => response.json());
    assert.match(second.reply, /첫 요청 \| 둘째 요청/u);
    const run = await fetch(`${base}/runs/${second.runId}`).then((response) => response.json());
    const transition = run.events.find((event) => event.type === 'model_connection_changed');
    assert.equal(transition.payload.previous.provider, 'openai');
    assert.equal(transition.payload.current.provider, 'anthropic');
    assert.equal(transition.payload.canonicalConversationPreserved, true);
  } finally {
    server.closeWakeStreams(); await server.closeMessengers(); await server.closeBrowsers();
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});
