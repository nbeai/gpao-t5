import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { ConsoleSessionStore } from '../src/console-session-store.js';
import { ConversationLedger } from '../src/conversation-ledger.js';

test('큰 과거 출력은 stub으로 시작하고 conversation_recall로 중간 원문을 복구한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-large-output-recall-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const sessions = new ConsoleSessionStore(stateDir);
  const session = await sessions.create();
  const ledger = new ConversationLedger(join(stateDir, 'conversations'));
  await ledger.ensure({ sessionId: session.id });
  const stdout = `${'a'.repeat(30_000)}MIDDLE-NEEDLE-7391${'z'.repeat(30_000)}`;
  const receipt = {
    toolCallId: 'large-call', requestedCall: { id: 'large-call', name: 'exec', args: {} },
    actualCall: { name: 'exec', args: {} }, outcome: 'succeeded',
    result: {
      state: 'completed', stdout, stderr: '', exitCode: 0,
      commandExplanation: { steps: Array.from({ length: 30 }, () => ({ executable: 'emit' })) },
    },
  };
  for (const [index, message] of [
    { role: 'user', content: '큰 결과를 확인해' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'large-call', name: 'exec', args: { command: 'emit', cwd: null } }] },
    { role: 'tool', toolCallId: 'large-call', name: 'exec', content: JSON.stringify(receipt) },
    { role: 'assistant', content: '확인했습니다.' },
  ].entries()) {
    await ledger.appendMessage({
      sessionId: session.id, messageId: `seed-${index + 1}`, runId: 'seed-run', message,
    });
  }

  let turn = 0;
  const server = makeConsoleServer({
    stateDir, workspace,
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'recall-model' }),
    modelFactory: () => ({ async respond(input) {
      if (!input.tools.some((tool) => tool.name === 'conversation_recall')) return {
        text: '', toolCalls: [{
          id: 'find-conversation-recall', name: 'tool_search',
          args: { query: 'recall omitted historical tool output exact text' },
        }],
      };
      turn += 1;
      if (turn === 1) {
        const historical = input.messages.find((message) => message.role === 'tool');
        const projected = JSON.parse(historical.content);
        assert.doesNotMatch(projected.result.stdout, /MIDDLE-NEEDLE-7391/);
        assert.equal(projected.result.stdoutProjection.messageId, 'seed-3');
        return { text: '', toolCalls: [{ id: 'recall-find', name: 'conversation_recall', args: {
          action: 'find', messageId: 'seed-3', stream: 'stdout',
          query: 'MIDDLE-NEEDLE', offset: null, limit: null,
        } }] };
      }
      const recalled = JSON.parse(input.messages.at(-1).content);
      assert.equal(recalled.actualCall.name, 'conversation_recall');
      assert.match(recalled.result.matches[0].excerpt, /MIDDLE-NEEDLE-7391/);
      return { text: 'MIDDLE-NEEDLE-7391', toolCalls: [] };
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
      body: JSON.stringify({ sessionId: session.id, text: '이전 큰 결과의 중간 NEEDLE을 알려줘' }),
    }).then((response) => response.json());
    assert.equal(reply.reply, 'MIDDLE-NEEDLE-7391');
    const run = await fetch(`${base}/runs/${reply.runId}`).then((response) => response.json());
    const tools = run.events.filter((event) => event.type === 'tool_completed')
      .map((event) => event.payload.receipt.actualCall.name);
    assert.deepEqual(tools, ['tool_search', 'conversation_recall']);
    const canonical = await server.conversationLedger.read(session.id);
    const original = canonical.entries.find((entry) => entry.messageId === 'seed-3');
    assert.match(original.message.content, /MIDDLE-NEEDLE-7391/);
    assert.ok(original.message.content.length > 60_000);
  } finally {
    await server.managedProcesses.stopAll('test_cleanup');
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
