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

async function close(server) {
  await server.managedProcesses.stopAll('test_cleanup');
  await new Promise((resolve) => server.close(resolve));
}

test('최종 답에 없는 tool 관측도 콘솔 재시작 뒤 다음 모델 Context에서 이어진다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-conversation-continuity-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  let firstTurn = 0;
  const firstServer = makeConsoleServer({
    stateDir, workspace,
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'continuity-model' }),
    modelFactory: () => ({ async respond(input) {
      firstTurn += 1;
      if (firstTurn === 1) return {
        text: '', toolCalls: [{ id: 'remembered-call', name: 'exec', args: {
          command: "printf 'value-7391'", cwd: null,
          effect: { kind: 'observe', summary: '연속성 fixture 관측', targets: [], reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null },
        } }],
      };
      const receipt = JSON.parse(input.messages.at(-1).content);
      assert.equal(receipt.result.stdout, 'value-7391');
      return { text: '확인했습니다.', toolCalls: [] };
    } }),
  });
  const firstBase = await listen(firstServer);
  let sessionId;
  try {
    sessionId = (await fetch(`${firstBase}/sessions`, { method: 'POST' }).then((response) => response.json())).id;
    const first = await fetch(`${firstBase}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, text: '파일 값을 확인해줘' }),
    }).then((response) => response.json());
    assert.equal(first.reply, '확인했습니다.');
    assert.doesNotMatch(first.reply, /value-7391/);
  } finally {
    await close(firstServer);
  }

  const secondServer = makeConsoleServer({
    stateDir, workspace,
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'continuity-model' }),
    modelFactory: () => ({ async respond(input) {
      const historicalTool = input.messages.find((message) => message.role === 'tool');
      assert.ok(historicalTool);
      assert.equal(historicalTool.toolCallId, 'remembered-call');
      assert.match(historicalTool.content, /value-7391/);
      const historicalCall = input.messages.find((message) => (
        message.role === 'assistant' && message.toolCalls?.[0]?.id === 'remembered-call'
      ));
      assert.ok(historicalCall);
      return { text: '아까 관측한 값은 value-7391입니다.', toolCalls: [] };
    } }),
  });
  const secondBase = await listen(secondServer);
  try {
    const second = await fetch(`${secondBase}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, text: '아까 확인한 값만 알려줘' }),
    }).then((response) => response.json());
    assert.equal(second.reply, '아까 관측한 값은 value-7391입니다.');
  } finally {
    await close(secondServer);
    await rm(room, { recursive: true, force: true });
  }
});
