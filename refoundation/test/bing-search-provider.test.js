import test from 'node:test';
import assert from 'node:assert/strict';
import { bingHtmlResults, makeBingSearchProvider } from '../src/bing-search-provider.js';

const HTML = '<ol><li class="b_algo"><h2><a href="https://example.com/report">Report</a></h2><div class="b_caption"><p>Observed summary</p></div></li></ol>';

test('Bing HTML fallback도 후보 메타데이터만 반환한다', async () => {
  assert.deepEqual(bingHtmlResults(HTML), [{ title: 'Report', url: 'https://example.com/report', snippet: 'Observed summary', sourceType: 'web' }]);
  const provider = makeBingSearchProvider({ fetchImpl: async () => new Response(HTML, { status: 200 }) });
  assert.equal((await provider.search('시장 조사'))[0].url, 'https://example.com/report');
});
