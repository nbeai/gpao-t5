import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { ConsoleSessionStore } from '../src/console-session-store.js';
import { ConversationLedger } from '../src/conversation-ledger.js';

test('재시작 뒤 incomplete tool call은 canonical을 고치지 않고 provider 구조만 복구한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-incomplete-tool-restart-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const sessions = new ConsoleSessionStore(stateDir);
  const session = await sessions.create();
  const ledger = new ConversationLedger(join(stateDir, 'conversations'));
  await ledger.ensure({ sessionId: session.id });
  await ledger.appendMessage({
    sessionId: session.id, messageId: 'old-user', runId: 'interrupted-run',
    message: { role: 'user', content: '긴 작업을 시작해줘' },
  });
  await ledger.appendMessage({
    sessionId: session.id, messageId: 'old-call', runId: 'interrupted-run', turn: 1,
    message: { role: 'assistant', content: '', toolCalls: [{
      id: 'orphan-call', name: 'exec', args: { command: 'sleep 100', cwd: null },
    }] },
  });
  const server = makeConsoleServer({
    stateDir, workspace,
    modelFactory: () => ({ async respond(input) {
      const repaired = input.messages.find((message) => message.role === 'tool'
        && message.toolCallId === 'orphan-call');
      assert.ok(repaired);
      const receipt = JSON.parse(repaired.content);
      assert.equal(receipt.outcome, 'interrupted_unknown');
      assert.equal(receipt.result.executionKnown, false);
      return { text: '새 요청에 정상적으로 답했습니다.', toolCalls: [] };
    } }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const reply = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '이전 작업은 재실행하지 말고 새 요청에 답해' }),
    }).then((response) => response.json());
    assert.equal(reply.reply, '새 요청에 정상적으로 답했습니다.');
    const canonical = await ledger.read(session.id);
    assert.equal(canonical.entries.filter((entry) => entry.message.role === 'tool').length, 0);
    assert.equal(canonical.entries.some((entry) => /interrupted-tool-result/.test(entry.message.content)), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
