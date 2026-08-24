import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

async function run(mode) {
  const room = await mkdtemp(join(tmpdir(), 't5-resource-parallel-console-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); await mkdir(workspace);
  let active = 0; let peak = 0; let turn = 0;
  const server = makeConsoleServer({ stateDir, workspace, activeOptimizationMode: mode,
    webReadOptions: { resolveHost: async () => ['93.184.216.34'], fetchImpl: async (url) => {
      active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 50)); active -= 1;
      return new Response(`<html><body><article>${`Observed ${url} `.repeat(30)}</article></body></html>`,
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    } }, modelFactory: () => ({ async respond(input) { turn += 1;
      if (turn === 1) return { text: '', toolCalls: [
        { id: 'read-a', name: 'web_read', args: { url: 'https://a.example/', maxChars: 5000, visibleBrowser: 'never' } },
        { id: 'read-b', name: 'web_read', args: { url: 'https://b.example/', maxChars: 5000, visibleBrowser: 'never' } },
      ] };
      assert.deepEqual(input.messages.filter((message) => message.role === 'tool')
        .map((message) => message.toolCallId), ['read-a', 'read-b']);
      return { text: '두 출처를 확인했습니다.', toolCalls: [] };
    } }), modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const reply = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '두 출처를 함께 확인해줘' }) }).then((response) => response.json());
    const runRecord = await server.runLedger.read(reply.runId);
    return { peak, reply, runRecord };
  } finally { await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); }
}

test('모델이 선택한 parallel-safe Web Hand만 병렬 실행하고 canonical 순서를 보존한다', async () => {
  const off = await run('off'); const on = await run('model-selected-v1');
  assert.equal(off.peak, 1); assert.equal(on.peak, 2);
  assert.equal(on.reply.reply, '두 출처를 확인했습니다.');
  const batch = on.runRecord.events.filter((event) => event.type === 'resource_parallel_batch');
  assert.equal(batch.length, 1);
  assert.deepEqual(batch[0].payload, { turn: 1, toolCalls: 2, tools: ['web_read', 'web_read'] });
  assert.deepEqual(on.runRecord.events.filter((event) => event.type === 'tool_completed')
    .map((event) => event.payload.receipt.toolCallId), ['read-a', 'read-b']);
  assert.equal(off.runRecord.events.some((event) => event.type === 'resource_parallel_batch'), false);
});
