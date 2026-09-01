import assert from 'node:assert/strict';
import test from 'node:test';

import { makeWebCollectionTool } from '../src/web-collection-tool.js';

function page(number) {
  return `<html><body>${[1, 2].map((item) => `<article class="item"><h3><a title="Book ${number}-${item}">Book</a></h3><p class="price">£${number}${item}</p></article>`).join('')}<li class="next"><a href="/page-${number + 1}">next</a></li></body></html>`;
}
function inspectArgs(url) { return { action: 'inspect', url, structureHandle: null, urls: null,
  itemSelector: null, fields: null, uniqueBy: null, expectedMinimum: null, expectedMaximum: null,
  outputForm: null, outputName: null }; }
function collectArgs(structureHandle) { return { action: 'collect', url: null, structureHandle,
  urls: ['https://catalog.example/page-1', 'https://catalog.example/page-2'], itemSelector: 'article.item',
  fields: [
    { key: 'title', selector: 'h3 a', source: 'attribute', attribute: 'title', required: true },
    { key: 'price', selector: 'p.price', source: 'text', attribute: null, required: true },
  ], uniqueBy: ['title'], expectedMinimum: 4, expectedMaximum: 4,
  outputForm: null, outputName: null }; }

test('Web Collection은 safe Web read→structure handle→same-origin collect를 한 Runtime Tool로 닫는다', async () => {
  const calls = [];
  const tool = makeWebCollectionTool({ makeId: () => '11111111-1111-4111-8111-111111111111', webReadOptions: {
    resolveHost: async () => ['93.184.216.34'], fetchImpl: async (url) => { calls.push(String(url));
      const number = Number(String(url).match(/page-(\d+)/u)?.[1] ?? 1);
      return new Response(page(number), { status: 200, headers: { 'content-type': 'text/html' } }); },
  } });
  const inspected = await tool.execute(inspectArgs('https://catalog.example/page-1'));
  assert.equal(inspected.state, 'structure_observed'); assert.match(inspected.structureHandle, /^web-structure-/u);
  assert.equal(inspected.network.requestCount, 1);
  const collected = await tool.execute(collectArgs(inspected.structureHandle));
  assert.equal(collected.state, 'verified_collection'); assert.equal(collected.records.length, 4);
  assert.equal(collected.network.requestCount, 2); assert.equal(collected.collector.terminalNetworkCalls, 0);
  assert.equal(collected.collector.generatedProgramExecutions, 0); assert.equal(collected.collector.pageScriptsExecuted, 0);
  assert.deepEqual(calls, ['https://catalog.example/page-1',
    'https://catalog.example/page-1', 'https://catalog.example/page-2']);
  assert.equal(collected.stopFurtherResearch, true);
});

test('관측하지 않은 selector·stale handle·cross-origin 범위는 network 전에 닫힌다', async () => {
  let calls = 0;
  const tool = makeWebCollectionTool({ webReadOptions: { resolveHost: async () => ['93.184.216.34'],
    fetchImpl: async (url) => { calls += 1; return new Response(page(1), { status: 200,
      headers: { 'content-type': 'text/html' } }); } } });
  const inspected = await tool.execute(inspectArgs('https://catalog.example/page-1'));
  const forged = collectArgs(inspected.structureHandle); forged.fields[0].selector = '.not-observed';
  await assert.rejects(() => tool.execute(forged), /field selector was not observed/u);
  const cross = collectArgs(inspected.structureHandle); cross.urls[1] = 'https://other.example/page-2';
  await assert.rejects(() => tool.execute(cross), /share one exact origin/u);
  await assert.rejects(() => tool.execute(collectArgs('web-structure-missing')), /handle is unavailable/u);
  assert.equal(calls, 1);
});

test('dynamic page는 Browser Hand만 열고 private target은 fetch 전에 차단한다', async () => {
  const dynamic = makeWebCollectionTool({ webReadOptions: { resolveHost: async () => ['93.184.216.34'],
    fetchImpl: async () => new Response('<html><body><div id="root"></div><script src="app.js"></script></body></html>',
      { status: 200, headers: { 'content-type': 'text/html' } }) } });
  const boundary = await dynamic.execute(inspectArgs('https://dynamic.example/'));
  assert.equal(boundary.state, 'dynamic_required'); assert.deepEqual(boundary.activatedTools, ['browser']);

  let fetched = 0;
  const privateTool = makeWebCollectionTool({ webReadOptions: { resolveHost: async () => ['127.0.0.1'],
    fetchImpl: async () => { fetched += 1; throw new Error('must not fetch'); } } });
  const blocked = await privateTool.execute(inspectArgs('https://private.example/'));
  assert.equal(blocked.state, 'blocked'); assert.equal(fetched, 0);
});
