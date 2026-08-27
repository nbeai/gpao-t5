import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { ConsoleSessionStore } from '../src/console-session-store.js';
import { ConversationLedger } from '../src/conversation-ledger.js';
import { makeOpenAIResponsesModel } from '../src/openai-responses-model.js';
import { ResourceLedger } from '../src/resource-ledger.js';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('한 콘솔 Run의 checkpoint·주 모델은 reserve·commit되고 안전하지 않은 memory flush는 호출 없이 skip된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-resource-integration-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const sessions = new ConsoleSessionStore(stateDir); const session = await sessions.create();
  const conversation = new ConversationLedger(join(stateDir, 'conversations'));
  await conversation.ensure({ sessionId: session.id });
  for (let index = 0; index < 6; index += 1) {
    await conversation.appendMessage({
      sessionId: session.id, messageId: `seed-${index}`, runId: 'seed',
      message: { role: index % 2 ? 'assistant' : 'user', content: `seed ${index} ${'x'.repeat(200)}` },
    });
  }
  let fetches = 0;
  const modelFactory = ({ instructionsOverride } = {}) => makeOpenAIResponsesModel({
    apiKey: 'fixture-key', model: 'fixture-model', instructions: instructionsOverride ?? 'main',
    fetchImpl: async (_url, init) => {
      fetches += 1;
      const persisted = await readFile(join(stateDir, 'resources', 'events.jsonl'), 'utf8');
      const events = persisted.split('\n').filter(Boolean).map(JSON.parse);
      assert.ok(events.some((event) => (
        event.type === 'ResourceReserved' && !events.some((other) => (
          other.type === 'ReservationCommitted'
          && other.payload.reservationId === event.payload.reservationId
        ))
      )));
      const body = JSON.parse(init.body);
      const summary = /continuity checkpoints/u.test(body.instructions ?? '');
      const memory = /durable memory/u.test(body.instructions ?? '');
      const text = summary ? 'compact continuity summary' : memory ? 'memory review complete' : '사용자 결과';
      return new Response(JSON.stringify({
        id: `response-${fetches}`, model: 'fixture-model',
        usage: { input_tokens: 10 + fetches, output_tokens: 2, total_tokens: 12 + fetches },
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
      }), { status: 200 });
    },
  });
  const server = makeConsoleServer({
    stateDir, workspace, modelFactory,
    conversationCheckpointMode: 'in-place-v0', checkpointTriggerBytes: 1,
    checkpointTailBytes: 200, checkpointChunkBytes: 10_000,
    modelStatus: () => ({ connected: true, provider: 'openai', modelId: 'fixture-model' }),
  });
  const base = await listen(server);
  try {
    const reply = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '계속해' }),
    }).then((response) => response.json());
    assert.equal(reply.reply, '사용자 결과');
    const run = await server.runLedger.read(reply.runId);
    const resources = await server.resourceLedger.read();
    const completedModelCalls = run.events.filter((event) => event.type === 'model_completed').length;
    assert.equal(resources.filter((event) => event.type === 'ResourceReserved').length, completedModelCalls);
    assert.equal(resources.filter((event) => event.type === 'ReservationCommitted').length, completedModelCalls);
    assert.equal(resources.filter((event) => event.type === 'UsageMarkedUnknown').length, 0);
    const purposes = resources.filter((event) => event.type === 'ScopeCreated')
      .map((event) => event.payload.purpose).filter(Boolean);
    assert.ok(purposes.includes('conversation_checkpoint'));
    assert.equal(purposes.includes('memory_flush'), false);
    assert.ok(purposes.includes('main'));
    assert.ok(run.events.some((event) => event.type === 'memory_flush_skipped'));
    assert.equal(resources.some((event) => event.type === 'ControlActionRecorded'), false);
    assert.equal(JSON.stringify((await conversation.read(session.id)).messages).includes('resourceScope'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('Resource storage 실패는 기존 Run에 degraded 진단만 남기고 콘솔 사용자 결과를 바꾸지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-resource-degraded-console-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  let failures = 0;
  const resourceLedger = new ResourceLedger('fault-storage', { storage: {
    async prepare() { failures += 1; throw new Error('private storage detail'); },
    async read() { return ''; }, async append() {},
  } });
  const server = makeConsoleServer({
    stateDir, workspace, resourceLedger,
    modelFactory: () => ({ async respond() { return { text: '정상 사용자 결과', toolCalls: [] }; } }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture-model' }),
  });
  const base = await listen(server);
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const reply = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '간단히 답해줘' }),
    }).then((response) => response.json());
    assert.equal(reply.reply, '정상 사용자 결과');
    assert.equal(failures, 1);
    const run = await server.runLedger.read(reply.runId);
    const degraded = run.events.filter((event) => event.type === 'resource_accounting_degraded');
    assert.equal(degraded.length, 1);
    assert.equal(degraded[0].payload.state, 'accounting_degraded');
    assert.equal(degraded[0].payload.stage, 'start_run');
    assert.doesNotMatch(JSON.stringify(run.events), /private storage detail|fault-storage/u);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
