import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

const effect = {
  kind: 'observe', summary: '동일한 큰 출력 재관측', targets: [], reversible: true,
  backupAvailable: true, recipientNew: false, approvalToken: null,
};

test('콘솔은 동일 읽기 Evidence의 과거 payload만 줄이고 두 canonical Receipt를 보존한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-duplicate-evidence-console-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); await mkdir(workspace);
  let turn = 0;
  const server = makeConsoleServer({
    stateDir, workspace,
    modelFactory: () => ({ async respond(input) {
      turn += 1;
      if (turn <= 2) return { text: '', toolCalls: [{
        id: `observe-${turn}`, name: 'exec', args: { command: 'seq 1 5000', cwd: null, effect },
      }] };
      const older = JSON.parse(input.messages.find((message) => message.toolCallId === 'observe-1').content);
      const latest = JSON.parse(input.messages.find((message) => message.toolCallId === 'observe-2').content);
      assert.equal(older.schema, 't5.duplicate-evidence-projection.v1');
      assert.match(latest.result.stdout, /4999\n5000/u);
      return { text: '동일 관측을 확인했습니다.', toolCalls: [] };
    } }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const reply = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '같은 읽기 결과를 재확인해줘' }) }).then((response) => response.json());
    assert.equal(reply.reply, '동일 관측을 확인했습니다.', JSON.stringify(reply));
    const run = await server.runLedger.read(reply.runId);
    const projection = run.events.find((event) => event.type === 'information_projection');
    assert.ok(projection.payload.netSavedBytes > 10_000);
    const canonical = run.events.filter((event) => event.type === 'tool_completed');
    assert.equal(canonical.length, 2);
    assert.equal(canonical.every((event) => /4999\n5000/u.test(event.payload.receipt.result.stdout)), true);
    const conversation = await server.conversationLedger.read(session.id);
    const toolEntries = conversation.entries.filter((entry) => entry.message.role === 'tool');
    assert.equal(toolEntries.length, 2);
    assert.equal(toolEntries.every((entry) => /4999\n5000/u.test(JSON.parse(entry.message.content).result.stdout)), true);
  } finally {
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});

test('research-first 기본 모델은 partial search schema 없이 한 bounded Web Receipt로 끝낸다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-research-first-console-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); await mkdir(workspace);
  const candidates = ['a', 'b', 'c'].map((name) => ({
    title: `Source ${name}`, url: `https://${name}.example/report`, snippet: `Evidence ${name}`,
  }));
  let turn = 0;
  const server = makeConsoleServer({
    stateDir, workspace,
    webSearchProviders: [{ id: 'fixture', label: 'Fixture',
      async available() { return { available: true }; }, async search() { return candidates; } }],
    webReadOptions: { resolveHost: async () => ['93.184.216.34'], fetchImpl: async (url) => (
      new Response(`<html><body><article><h1>Official report</h1><p>${`Observed ${url} `.repeat(30)}</p></article></body></html>`,
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    ) },
    modelFactory: () => ({ async respond(input) {
      turn += 1;
      if (turn === 1) {
        assert.equal(input.tools.some((tool) => tool.name === 'web_research'), true);
        assert.equal(input.tools.some((tool) => tool.name === 'web_read'), true);
        assert.equal(input.tools.some((tool) => tool.name === 'web_search'), false);
        return { text: '', toolCalls: [{ id: 'bounded-research', name: 'web_research', args: {
          query: 'official report', queries: null, sourceLimit: 3, domains: null,
        } }] };
      }
      const receipt = JSON.parse(input.messages.at(-1).content);
      assert.equal(receipt.result.state, 'researched');
      assert.equal(receipt.result.readableCount, 3);
      return { text: '세 공식 근거를 한 번에 확인했습니다.', toolCalls: [] };
    } }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const reply = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '공식 보고서 근거를 확인해줘' }) }).then((response) => response.json());
    assert.equal(reply.reply, '세 공식 근거를 한 번에 확인했습니다.');
    const run = await server.runLedger.read(reply.runId);
    assert.deepEqual(run.events.filter((event) => event.type === 'tool_completed')
      .map((event) => event.payload.receipt.actualCall.name), ['web_research']);
  } finally {
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});
