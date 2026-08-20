import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('모델은 취소되어 더는 현재가 아닌 work 기억을 list 뒤 remove한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-memory-current-state-integration-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  let modelTurn = 0;
  const server = makeConsoleServer({
    stateDir, workspace,
    modelFactory: () => ({ async respond(input) {
      modelTurn += 1;
      const memoryDefinition = input.tools.find((tool) => tool.name === 'memory');
      if (modelTurn === 1) {
        assert.ok(input.messages.some((message) => (
          /PERSISTENT MEMORY/u.test(message.content)
          && /current durable state/i.test(message.content)
          && /cancelled or no longer current/i.test(message.content)
        )));
        assert.match(memoryDefinition.description, /completed or cancelled/i);
        assert.match(memoryDefinition.description, /conversation history|session search/i);
        return {
          text: '', toolCalls: [{
            id: 'memory-list', name: 'memory',
            args: { action: 'list', memoryId: null, kind: null, content: null },
          }],
        };
      }
      if (modelTurn === 2) {
        const receipt = JSON.parse(input.messages.at(-1).content);
        const [item] = receipt.result.items;
        return {
          text: '', toolCalls: [{
            id: 'memory-remove', name: 'memory',
            args: { action: 'remove', memoryId: item.memoryId, kind: null, content: null },
          }],
        };
      }
      return { text: '취소된 알림은 현재 기억에서 정리했습니다.', toolCalls: [] };
    } }),
  });
  await server.memoryLedger.ensure();
  await server.memoryLedger.add({
    kind: 'work', content: '매일 오후 4시 스트레칭 알림이 활성화되어 있다.',
    source: { origin: 'foreground', sessionId: 'old-session', runId: 'old-run' },
  });
  const base = await listen(server);
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const result = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.id,
        text: '스트레칭 알림은 방금 실제로 취소됐어. 이제 없어.',
      }),
    }).then((response) => response.json());
    assert.equal(result.reply, '취소된 알림은 현재 기억에서 정리했습니다.');
    assert.deepEqual((await server.memoryLedger.read()).items, []);
    const run = await fetch(`${base}/runs/${result.runId}`).then((response) => response.json());
    assert.deepEqual(run.events.filter((event) => event.type === 'tool_completed').map(
      (event) => event.payload.receipt.requestedCall.args.action,
    ), ['list', 'remove']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
