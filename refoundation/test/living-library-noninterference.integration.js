import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { MemoryLedger } from '../src/memory-ledger.js';

function semanticModelInputs(value) {
  if (Array.isArray(value)) return value.map(semanticModelInputs);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, semanticModelInputs(item)]),
  );
  if (typeof value !== 'string') return value;
  return value
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu, '<opaque-id>')
    .replace(/iso=\d{4}-\d{2}-\d{2}T[^\n]+/gu, 'iso=<current-time>')
    .replace(/local=\d{4}-\d{2}-\d{2} [^\n]+/gu, 'local=<current-time>');
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function post(base, path, value) {
  const response = await fetch(`${base}${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  const body = await response.json(); if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

test('Library 생성 여부는 같은 foreground 목적의 model input·답·canonical Memory를 바꾸지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-library-noninterference-'));
  const seed = join(room, 'seed'); await mkdir(seed, { recursive: true });
  const ledger = new MemoryLedger(join(seed, 'memory')); await ledger.ensure();
  await ledger.add({ kind: 'user', content: '사용자는 결과를 먼저 확인한다.',
    source: { origin: 'fixture' } });
  const states = [join(room, 'off'), join(room, 'on')];
  for (const state of states) {
    await mkdir(join(state, 'workspace'), { recursive: true });
    await cp(join(seed, 'memory'), join(state, 'state', 'memory'), { recursive: true });
  }
  const observations = [];
  for (const [index, root] of states.entries()) {
    const modelInputs = [];
    const server = makeConsoleServer({ stateDir: join(root, 'state'), workspace: join(root, 'workspace'),
      modelFactory: () => ({ async respond(input) {
        modelInputs.push({ messages: structuredClone(input.messages), tools: structuredClone(input.tools) });
        return { text: '같은 foreground 결과입니다.', toolCalls: [] };
      } }), modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
      learningReviewMode: 'off', memoryFlushMode: 'off' });
    const base = await listen(server);
    try {
      let library = null;
      if (index === 1) {
        const started = process.hrtime.bigint(); library = await post(base, '/memory/library/rebuild', {});
        library.qualificationDurationNs = String(process.hrtime.bigint() - started);
        const manifest = JSON.parse(await readFile(join(root, 'state', 'living-library',
          `generation-${library.generationId}`, 'manifest.json'), 'utf8'));
        library.qualificationBytes = Object.values(manifest.files).reduce((sum, file) => sum + file.bytes, 0);
      }
      const session = await post(base, '/sessions', {});
      const result = await post(base, '/turn', { sessionId: session.id,
        text: '지금 저장된 답변 방식 선호를 바꾸지 말고 확인만 해줘.' });
      observations.push({ reply: result.reply, modelInputs,
        memory: await server.memoryLedger.read(), library });
    } finally {
      await server.closeBrowsers(); await new Promise((resolve) => server.close(resolve));
    }
  }
  try {
    assert.equal(observations[0].reply, observations[1].reply);
    assert.deepEqual(semanticModelInputs(observations[0].modelInputs),
      semanticModelInputs(observations[1].modelInputs));
    assert.deepEqual(observations[0].modelInputs.map((item) => item.tools),
      observations[1].modelInputs.map((item) => item.tools));
    assert.deepEqual(observations[0].memory.events, observations[1].memory.events);
    assert.equal(observations[0].modelInputs.length, observations[1].modelInputs.length);
    assert.equal(observations[0].library, null);
    assert.ok(Number(BigInt(observations[1].library.qualificationDurationNs)) >= 0);
    assert.ok(observations[1].library.qualificationBytes > 0);
    await stat(join(states[1], 'state', 'living-library',
      `generation-${observations[1].library.generationId}`, 'index.html'));
  } finally { await rm(room, { recursive: true, force: true }); }
});
