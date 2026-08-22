import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { ConsoleSessionStore } from '../src/console-session-store.js';
import { ConversationLedger } from '../src/conversation-ledger.js';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('새 Session의 모델은 session_search 발견 뒤 canonical 주변 원문을 읽어 답한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-session-search-integration-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const sessions = new ConsoleSessionStore(stateDir);
  const ledger = new ConversationLedger(join(stateDir, 'conversations'));
  const source = await sessions.create();
  await ledger.ensure({ sessionId: source.id });
  await ledger.appendMessage({
    sessionId: source.id, messageId: 'source-user', runId: 'seed',
    message: { role: 'user', content: '과거 프로젝트에서 ORBIT-7391을 결정했다.' },
  });
  await ledger.appendMessage({
    sessionId: source.id, messageId: 'source-answer', runId: 'seed',
    message: { role: 'assistant', content: '결정 근거는 유지보수 비용이었다.' },
  });
  const current = await sessions.create();
  let modelTurn = 0;
  const server = makeConsoleServer({
    stateDir, workspace,
    modelFactory: () => ({ async respond(input) {
      if (!input.tools.some((tool) => tool.name === 'session_search')) return {
        text: '', toolCalls: [{
          id: 'find-session-search', name: 'tool_search',
          args: { query: 'search and read past session conversation history' },
        }],
      };
      modelTurn += 1;
      if (modelTurn === 1) return {
        text: '', toolCalls: [{
          id: 'search-1', name: 'session_search',
          args: {
            action: 'search', query: 'ORBIT-7391', sessionId: null,
            messageId: null, limit: 5, window: null, includeTools: false,
          },
        }],
      };
      if (modelTurn === 2) {
        const result = JSON.parse(input.messages.at(-1).content).result;
        return {
          text: '', toolCalls: [{
            id: 'read-1', name: 'session_search',
            args: {
              action: 'read', query: null, sessionId: result.results[0].sessionId,
              messageId: result.results[0].messageId, limit: null, window: 2,
              includeTools: false,
            },
          }],
        };
      }
      assert.ok(input.messages.some((message) => /유지보수 비용/.test(message.content)));
      return { text: 'ORBIT-7391의 근거는 유지보수 비용이었습니다.', toolCalls: [] };
    } }),
  });
  const base = await listen(server);
  try {
    const reply = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: current.id, text: '예전 ORBIT 결정을 찾아줘.' }),
    }).then((response) => response.json());
    assert.equal(reply.reply, 'ORBIT-7391의 근거는 유지보수 비용이었습니다.');
    const run = await fetch(`${base}/runs/${reply.runId}`).then((response) => response.json());
    assert.equal(run.events.filter((event) => (
      event.type === 'tool_completed'
      && event.payload.receipt.requestedCall.name === 'session_search'
    )).length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
