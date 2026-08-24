import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

test('모델이 검색 후보를 고른 뒤 그 주소만 읽고 두 Receipt를 같은 Run에 남긴다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-web-hand-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const target = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<html><head><title>우리 가게 공지</title></head><body><article><h1>우리 가게 공지</h1><p>${'영업시간은 오전 9시부터 오후 6시까지입니다. '.repeat(10)}</p></article></body></html>`);
  });
  await new Promise((resolve, reject) => {
    target.once('error', reject);
    target.listen(0, '127.0.0.1', resolve);
  });
  const articleUrl = `http://127.0.0.1:${target.address().port}/notice`;
  const provider = {
    id: 'fixture', label: 'Fixture Search',
    async available() { return { available: true }; },
    async search() {
      return [
        { title: '다른 후보', url: 'https://unused.example/other', snippet: '열면 안 됨' },
        { title: '우리 가게 공지', url: articleUrl, snippet: '영업시간 공지' },
      ];
    },
  };
  let modelTurn = 0;
  const server = makeConsoleServer({
    stateDir, workspace, informationControl: 'wide-web-v0',
    webSearchProviders: [provider],
    webReadOptions: { allowPrivateUrls: true },
    modelFactory: () => ({ async respond(input) {
      modelTurn += 1;
      if (modelTurn === 1) {
        assert.ok(input.tools.some((tool) => tool.name === 'web_search'));
        assert.ok(input.tools.some((tool) => tool.name === 'web_read'));
        assert.ok(!input.tools.some((tool) => tool.name === 'browser'));
        return { text: '', toolCalls: [{ id: 'search-web', name: 'web_search', args: {
          query: '우리 가게 영업시간 공지', provider: null, limit: 5, domains: null,
        } }] };
      }
      const receiptMessage = modelTurn === 2
        ? input.messages.findLast((message) => message.name === 'web_search')
        : input.messages.at(-1);
      const receipt = JSON.parse(receiptMessage.content);
      if (modelTurn === 2) {
        assert.equal(receipt.result.state, 'candidates');
        assert.equal(receipt.result.observedPageContent, false);
        assert.equal(receipt.result.candidates[1].url, articleUrl);
        return { text: '', toolCalls: [{ id: 'read-web', name: 'web_read', args: {
          url: receipt.result.candidates[1].url, maxChars: 10_000,
        } }] };
      }
      assert.equal(receipt.result.state, 'read');
      assert.match(receipt.result.content.text, /오전 9시부터 오후 6시/);
      return { text: '공지에서 영업시간이 오전 9시부터 오후 6시까지인 것을 확인했어요.', toolCalls: [] };
    } }),
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'web-model' }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const reply = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: created.id, text: '우리 가게 영업시간 공지를 찾아 확인해줘' }),
    }).then((response) => response.json());
    assert.equal(reply.kind, 'reply', JSON.stringify(reply));
    assert.match(reply.reply, /오전 9시/);
    const run = await fetch(`${base}/runs/${reply.runId}`).then((response) => response.json());
    const completed = run.events.filter((event) => event.type === 'tool_completed');
    assert.deepEqual(completed.map((event) => event.payload.receipt.actualCall.name), [
      'web_search', 'web_read',
    ]);
    assert.equal(completed[0].payload.receipt.result.readState, 'candidates_only');
    assert.equal(completed[1].payload.receipt.result.source.finalUrl, articleUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => target.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
