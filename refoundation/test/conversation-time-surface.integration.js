import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeConsoleServer } from '../src/console-server.js';

test('대화 surface는 canonical Conversation의 사용자·T5 recordedAt을 그대로 투영한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-conversation-time-surface-'));
  await mkdir(join(room, 'workspace'));
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace: join(room, 'workspace'),
    modelFactory: () => ({ async respond() { return { text: '시간 표면 답변', toolCalls: [] }; } }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }) });
  await new Promise((resolve, reject) => { server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((item) => item.json());
    const reply = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '시간을 보존해줘' }) }).then((item) => item.json());
    const canonical = await server.conversationLedger.read(session.id);
    const surface = await fetch(`${base}/sessions/${session.id}`).then((item) => item.json());
    const userTime = canonical.entries.find((entry) => entry.messageId === `${reply.runId}:user`)?.recordedAt;
    const assistantTime = canonical.entries.findLast((entry) => entry.runId === reply.runId
      && entry.message.role === 'assistant' && entry.message.content === '시간 표면 답변')?.recordedAt;
    assert.ok(userTime); assert.ok(assistantTime);
    assert.equal(surface.transcript[0].recordedAt, userTime);
    assert.equal(surface.transcript[1].recordedAt, assistantTime);
  } finally {
    server.closeWakeStreams(); await server.closeCommandExplainer(); await server.closeMessengers();
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});
