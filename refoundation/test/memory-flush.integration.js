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

async function seededSession(stateDir) {
  const sessions = new ConsoleSessionStore(stateDir);
  const session = await sessions.create();
  const ledger = new ConversationLedger(join(stateDir, 'conversations'));
  await ledger.ensure({ sessionId: session.id });
  for (let index = 0; index < 8; index += 1) {
    await ledger.appendMessage({
      sessionId: session.id, messageId: `seed-${index}`, runId: 'seed',
      message: {
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `${index === 0 ? '사용자는 결론을 먼저 듣는 것을 선호한다. ' : ''}${'x'.repeat(120)}`,
      },
    });
  }
  return { sessions, session, ledger };
}

test('checkpoint 전 memory-only review가 durable memory를 만들고 새 Session이 이를 받는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-memory-flush-integration-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const { sessions, session, ledger } = await seededSession(stateDir);
  let memoryCalls = 0;
  let mainCalls = 0;
  const server = makeConsoleServer({
    stateDir, workspace,
    checkpointTriggerBytes: 1, checkpointTailBytes: 200,
    checkpointSummarizer: async () => 'USER FACT: 사용자는 결론을 먼저 듣는 것을 선호한다.',
    modelFactory: ({ purpose }) => ({ async respond(input) {
      if (purpose === 'memory_flush') {
        memoryCalls += 1;
        if (memoryCalls === 1) return {
          text: '', toolCalls: [{
            id: 'memory-add-1', name: 'memory',
            args: {
              action: 'add', memoryId: null, kind: 'user',
              content: '사용자는 결론을 먼저 듣는 것을 선호한다.',
            },
          }],
        };
        return { text: 'MEMORY_FLUSH_DONE', toolCalls: [] };
      }
      mainCalls += 1;
      const candidate = input.messages.find((message) => /USER MEMORY CANDIDATES/.test(message.content));
      const recalled = input.messages.some((message) => message.role === 'tool'
        && /결론을 먼저/.test(message.content));
      if (candidate && !recalled) {
        const memoryId = /"memoryId":"([^"]+)"/u.exec(candidate.content)[1];
        return { text: '', toolCalls: [{ id: 'memory-read', name: 'memory', args: {
          action: 'read', memoryIds: [memoryId], memoryId: null, kind: null, content: null,
          subjects: null, alwaysRelevant: null,
        } }] };
      }
      return { text: recalled ? '기억을 이어받았습니다.' : '첫 작업 완료', toolCalls: [] };
    } }),
  });
  const base = await listen(server);
  try {
    const first = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '계속해' }),
    }).then((response) => response.json());
    assert.equal(first.reply, '첫 작업 완료');
    const memory = await fetch(`${base}/memory/state`).then((response) => response.json());
    assert.equal(memory.items.length, 1);
    assert.equal(memory.items[0].source.origin, 'pre_checkpoint');
    assert.equal((await ledger.read(session.id)).entries.some((entry) => entry.message.toolCalls?.some(
      (call) => call.name === 'memory',
    )), false);

    const next = await sessions.create();
    const second = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: next.id, text: '내 답변 선호를 기억해?' }),
    }).then((response) => response.json());
    assert.equal(second.reply, '기억을 이어받았습니다.');
    assert.equal(mainCalls, 3, '첫 작업 1회와 새 Session candidate→read 2회');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('memory review 실패는 checkpoint와 본 사용자 답을 막지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-memory-flush-failure-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const { session } = await seededSession(stateDir);
  const server = makeConsoleServer({
    stateDir, workspace,
    checkpointTriggerBytes: 1, checkpointTailBytes: 200,
    checkpointSummarizer: async () => 'durable summary',
    modelFactory: ({ purpose }) => ({ async respond() {
      if (purpose === 'memory_flush') throw new Error('memory review unavailable');
      return { text: '사용자 답은 계속됩니다.', toolCalls: [] };
    } }),
  });
  const base = await listen(server);
  try {
    const reply = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '계속해' }),
    }).then((response) => response.json());
    assert.equal(reply.reply, '사용자 답은 계속됩니다.');
    const run = await fetch(`${base}/runs/${reply.runId}`).then((response) => response.json());
    assert.ok(run.events.some((event) => event.type === 'memory_flush_failed'));
    assert.ok(run.events.some((event) => event.type === 'checkpoint_completed'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
