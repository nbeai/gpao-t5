import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeConsoleServer } from '../src/console-server.js';

function page(number) {
  return `<html><body>${[1, 2].map((item) => `<article class="item"><h3><a title="Book ${number}-${item}">Book</a></h3><p class="price">£${number}${item}</p></article>`).join('')}<li class="next"><a href="/page-${number + 1}">next</a></li></body></html>`;
}

test('Console은 web_read 뒤 observed structure만 Web Collection에 열고 Terminal network 없이 records를 돌려준다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-web-collection-console-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); await mkdir(workspace);
  let turn = 0; let networkCalls = 0; let structureHandle;
  const server = makeConsoleServer({ stateDir, workspace,
    webReadOptions: { resolveHost: async () => ['93.184.216.34'], fetchImpl: async (url) => {
      networkCalls += 1; const number = Number(String(url).match(/page-(\d+)/u)?.[1] ?? 1);
      return new Response(page(number), { status: 200, headers: { 'content-type': 'text/html' } });
    } },
    modelFactory: () => ({ async respond(input) {
      turn += 1;
      if (turn === 1) {
        assert.equal(input.tools.some((tool) => tool.name === 'web_read'), true);
        assert.equal(input.tools.some((tool) => tool.name === 'web_collection'), false);
        return { text: '', toolCalls: [{ id: 'read-page', name: 'web_read', args: {
          url: 'https://catalog.example/page-1', maxChars: 5_000, visibleBrowser: 'never',
        } }] };
      }
      const receipt = JSON.parse(input.messages.at(-1).content);
      if (turn === 2) {
        assert.equal(receipt.result.state, 'read');
        assert.equal(input.tools.some((tool) => tool.name === 'web_collection'), true);
        assert.equal(receipt.result.collectionAffordance.state, 'structure_observed');
        structureHandle = receipt.result.collectionAffordance.structureHandle;
        return { text: '', toolCalls: [{ id: 'collect-records', name: 'web_collection', args: {
          action: 'collect', url: null, structureHandle,
          urls: ['https://catalog.example/page-1', 'https://catalog.example/page-2'],
          itemSelector: 'article.item', fields: [
            { key: 'title', selector: 'h3 a', source: 'attribute', attribute: 'title', required: true },
            { key: 'price', selector: 'p.price', source: 'text', attribute: null, required: true },
          ], uniqueBy: ['title'], expectedMinimum: 4, expectedMaximum: 4,
          outputForm: 'xlsx', outputName: 'catalog.xlsx',
        } }] };
      }
      assert.equal(receipt.result.state, 'verified_collection'); assert.equal(receipt.result.records, undefined);
      assert.equal(receipt.result.coverage.observedRecords, 4); assert.equal(receipt.result.recordSample.length, 3);
      assert.equal(receipt.result.collector.terminalNetworkCalls, 0);
      assert.equal(receipt.result.artifact.originalName, 'catalog.xlsx');
      return { text: '두 페이지의 네 레코드를 정확히 수집했습니다.', toolCalls: [] };
    } }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const reply = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '공개 카탈로그 두 페이지를 수집해줘' }) }).then((response) => response.json());
    assert.equal(reply.reply, '두 페이지의 네 레코드를 정확히 수집했습니다.');
    assert.equal(reply.artifacts[0].originalName, 'catalog.xlsx');
    const run = await server.runLedger.read(reply.runId);
    assert.deepEqual(run.events.filter((event) => event.type === 'tool_completed')
      .map((event) => event.payload.receipt.actualCall.name), ['web_read', 'web_collection']);
    assert.equal(networkCalls, 3); assert.ok(structureHandle);
  } finally {
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});
