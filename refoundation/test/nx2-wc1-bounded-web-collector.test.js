import assert from 'node:assert/strict';
import test from 'node:test';

import { qualifyWebCollectionSpec, runBoundedWebCollection } from './helpers/nx2-bounded-web-collector.js';

function spec(overrides = {}) {
  return { schema: 't5.web-collection-spec.v1',
    urls: ['https://catalog.example/page-1', 'https://catalog.example/page-2'],
    itemSelector: 'article.item', fields: [
      { key: 'title', selector: 'a.title', source: 'attribute', attribute: 'title', required: true },
      { key: 'price', selector: '.price', source: 'text', attribute: null, required: true },
    ], uniqueBy: ['title'], expectedRecords: { minimum: 4, maximum: 4 }, ...overrides };
}

function html(page) {
  return `<html><body>${[1, 2].map((item) => `<article class="item"><a class="title" title="Book ${page}-${item}"></a><p class="price">£${page}${item}.00</p></article>`).join('')}</body></html>`;
}

test('bounded collection은 exact same-origin page와 model-authored field 계약을 검증된 records로 만든다', async () => {
  const result = await runBoundedWebCollection({ spec: spec(), fetchPage: async ({ url, pageIndex }) => ({
    state: 'read', finalUrl: url, html: html(pageIndex + 1), bytes: Buffer.byteLength(html(pageIndex + 1)),
  }) });
  assert.equal(result.state, 'verified_collection'); assert.equal(result.verified, true);
  assert.equal(result.records.length, 4); assert.deepEqual(result.records[0], {
    title: 'Book 1-1', price: '£11.00', source: {
      page: 1, url: 'https://catalog.example/page-1', item: 1, observedAt: null,
    },
  });
  assert.deepEqual(result.coverage, { requestedPages: 2, observedPages: 2, complete: true,
    expectedRecords: { minimum: 4, maximum: 4 }, observedRecords: 4, rangeSatisfied: true });
  assert.equal(result.validation.requiredMissing, 0); assert.equal(result.validation.duplicateCount, 0);
  assert.equal(result.network.requestCount, 2); assert.equal(result.instructionAuthority, 'none');
});

test('page 실패·origin 변경·필수값 누락·중복은 그럴듯한 records를 완료로 승격하지 않는다', async () => {
  const failedPage = await runBoundedWebCollection({ spec: spec(), fetchPage: async ({ url, pageIndex }) => (
    pageIndex === 0 ? { state: 'read', finalUrl: url, html: html(1) } : { state: 'failed', reason: 'blocked' }
  ) });
  assert.equal(failedPage.state, 'partial_collection'); assert.equal(failedPage.verified, false);
  assert.equal(failedPage.coverage.complete, false);

  const missing = await runBoundedWebCollection({ spec: spec({ urls: ['https://catalog.example/one'],
    expectedRecords: { minimum: 1, maximum: 1 } }), fetchPage: async ({ url }) => ({ state: 'read', finalUrl: url,
    html: '<article class="item"><a class="title" title="Book"></a></article>' }) });
  assert.equal(missing.verified, false); assert.equal(missing.validation.missingByField.price, 1);

  const duplicate = await runBoundedWebCollection({ spec: spec({ urls: ['https://catalog.example/one'],
    expectedRecords: { minimum: 2, maximum: 2 } }), fetchPage: async ({ url }) => ({ state: 'read', finalUrl: url,
    html: '<article class="item"><a class="title" title="Same"></a><p class="price">1</p></article>'.repeat(2) }) });
  assert.equal(duplicate.verified, false); assert.equal(duplicate.validation.duplicateCount, 1);

  const foreign = await runBoundedWebCollection({ spec: spec({ urls: ['https://catalog.example/one'],
    expectedRecords: { minimum: 1, maximum: 1 } }), fetchPage: async () => ({ state: 'read',
    finalUrl: 'https://foreign.example/one', html: html(1) }) });
  assert.equal(foreign.verified, false); assert.equal(foreign.coverage.observedPages, 0);
});

test('collection spec은 cross-origin·중복 field·과대 범위·credential URL을 실행 전에 거부한다', () => {
  assert.throws(() => qualifyWebCollectionSpec(spec({ urls: [
    'https://catalog.example/1', 'https://other.example/2',
  ] })), /share one exact origin/u);
  assert.throws(() => qualifyWebCollectionSpec(spec({ fields: [
    { key: 'title', selector: 'h1', source: 'text', required: true },
    { key: 'title', selector: 'h2', source: 'text', required: true },
  ] })), /fields are invalid/u);
  assert.throws(() => qualifyWebCollectionSpec(spec({ urls: Array.from({ length: 13 }, (_, index) => `https://catalog.example/${index}`) })), /page count/u);
  assert.throws(() => qualifyWebCollectionSpec(spec({ urls: ['https://user:secret@catalog.example/'] })), /without credentials/u);
});

test('cancel은 남은 page를 실행하지 않고 record를 사용자 결과로 남기지 않는다', async () => {
  const controller = new AbortController(); let calls = 0;
  const result = await runBoundedWebCollection({ spec: spec(), signal: controller.signal,
    fetchPage: async ({ pageIndex, url }) => { calls += 1; if (pageIndex === 0) controller.abort();
      return { state: 'read', finalUrl: url, html: html(1) }; } });
  assert.equal(result.state, 'cancelled'); assert.equal(result.verified, false);
  assert.equal(calls, 1); assert.deepEqual(result.records, []);
});
