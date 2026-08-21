import test from 'node:test';
import assert from 'node:assert/strict';

import {
  duckDuckGoHtmlResults, makeDuckDuckGoSearchProvider,
} from '../src/duckduckgo-search-provider.js';

const HTML = `<html><body>
<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Futm_source%3Dx">Example A</a><a class="result__snippet">First source</a></div>
<div class="result"><a class="result__a" href="https://second.example/report">Second</a><a class="result__snippet">Second source</a></div>
</body></html>`;

test('키 없는 검색 공급자는 후보 URL·제목·설명만 반환한다', async () => {
  assert.deepEqual(duckDuckGoHtmlResults(HTML).map(({ title, url, snippet }) => ({ title, url, snippet })), [
    { title: 'Example A', url: 'https://example.com/a?utm_source=x', snippet: 'First source' },
    { title: 'Second', url: 'https://second.example/report', snippet: 'Second source' },
  ]);
  let requested;
  const provider = makeDuckDuckGoSearchProvider({ fetchImpl: async (url) => {
    requested = String(url); return new Response(HTML, { status: 200, headers: { 'content-type': 'text/html' } });
  } });
  const rows = await provider.search('카페 소비 동향', { domains: ['kosis.kr'], limit: 3 });
  assert.equal(rows.length, 2);
  assert.match(requested, /q=/u);
  assert.doesNotMatch(decodeURIComponent(requested), /site:kosis\.kr/u);
});
