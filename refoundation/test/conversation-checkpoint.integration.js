import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { ConsoleSessionStore } from '../src/console-session-store.js';
import { ConversationLedger } from '../src/conversation-ledger.js';

async function seed(stateDir, count = 20) {
  const sessions = new ConsoleSessionStore(stateDir);
  const session = await sessions.create();
  const ledger = new ConversationLedger(join(stateDir, 'conversations'));
  await ledger.ensure({ sessionId: session.id });
  for (let index = 0; index < count; index += 1) {
    await ledger.appendMessage({
      sessionId: session.id, messageId: `m-${index + 1}`, runId: 'seed-run',
      message: {
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `${index === 0 ? 'EARLY=ALPHA-7391 ' : ''}${index === 10 ? 'DECISION=BETA-7391 ' : ''}${index === count - 1 ? 'RECENT=GAMMA-7391 ' : ''}${'x'.repeat(120)}`,
      },
    });
  }
  return { session, ledger };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('in-place checkpoint는 summary+tail로 답하고 canonical 메시지를 유지한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-checkpoint-integration-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const { session, ledger } = await seed(stateDir);
  const server = makeConsoleServer({
    stateDir, workspace,
    checkpointTriggerBytes: 1,
    checkpointTailBytes: 400, checkpointChunkBytes: 600,
    checkpointSummarizer: async ({ phase }) => phase === 'merge'
      ? 'EARLY=ALPHA-7391\nDECISION=BETA-7391\nOPEN WORK continues'
      : 'partial EARLY=ALPHA-7391 DECISION=BETA-7391',
    modelFactory: () => ({ async respond(input) {
      assert.match(input.messages[0].content, /CONVERSATION CHECKPOINT/);
      assert.match(input.messages[0].content, /EARLY=ALPHA-7391/);
      assert.ok(input.messages.some((message) => /RECENT=GAMMA-7391/.test(message.content)));
      return { text: 'ALPHA-7391 / BETA-7391 / GAMMA-7391', toolCalls: [] };
    } }),
  });
  const base = await listen(server);
  try {
    const reply = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '세 값을 알려줘' }),
    }).then((response) => response.json());
    assert.equal(reply.reply, 'ALPHA-7391 / BETA-7391 / GAMMA-7391');
    const conversation = await ledger.read(session.id);
    assert.equal(conversation.checkpoints.length, 1);
    assert.equal(conversation.entries.filter((entry) => entry.runId === 'seed-run').length, 20);
    const run = await fetch(`${base}/runs/${reply.runId}`).then((response) => response.json());
    assert.ok(run.events.some((event) => event.type === 'checkpoint_completed'));
    assert.equal(run.sessionId, session.id);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('checkpoint summary 실패는 원장을 바꾸지 않고 full context로 계속한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-checkpoint-fail-closed-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const { session, ledger } = await seed(stateDir, 8);
  const server = makeConsoleServer({
    stateDir, workspace,
    conversationCheckpointMode: 'in-place-v0', checkpointTriggerBytes: 1, checkpointTailBytes: 200,
    checkpointSummarizer: async () => { throw new Error('summary unavailable'); },
    modelFactory: () => ({ async respond(input) {
      assert.equal(input.messages.some((message) => /CONVERSATION CHECKPOINT/.test(message.content)), false);
      assert.match(input.messages[0].content, /EARLY=ALPHA-7391/);
      return { text: '기존 Context로 계속했습니다.', toolCalls: [] };
    } }),
  });
  const base = await listen(server);
  try {
    const reply = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '계속해' }),
    }).then((response) => response.json());
    assert.equal(reply.reply, '기존 Context로 계속했습니다.');
    assert.equal((await ledger.read(session.id)).checkpoints.length, 0);
    const run = await fetch(`${base}/runs/${reply.runId}`).then((response) => response.json());
    assert.ok(run.events.some((event) => (
      event.type === 'checkpoint_failed' && event.payload.error === 'summary unavailable'
    )));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
