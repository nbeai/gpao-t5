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

test('취소되어 더는 현재가 아닌 work 기억은 모델 Context에 자동 투영되지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-memory-current-state-integration-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  let modelTurn = 0;
  const server = makeConsoleServer({
    stateDir, workspace,
    modelFactory: () => ({ async respond(input) {
      modelTurn += 1;
      assert.equal(input.messages.some((message) => /PERSISTENT MEMORY[\s\S]*스트레칭 알림/u.test(message.content)), false);
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
    assert.equal((await server.memoryLedger.read()).items.length, 1, '원장은 Episode 근거로 보존');
    const run = await fetch(`${base}/runs/${result.runId}`).then((response) => response.json());
    assert.deepEqual(run.events.filter((event) => event.type === 'tool_completed').map(
      (event) => event.payload.receipt.requestedCall.name,
    ), []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
