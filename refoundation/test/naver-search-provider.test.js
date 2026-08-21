import test from 'node:test';
import assert from 'node:assert/strict';
import { makeNaverSearchProvider, naverHtmlResults } from '../src/naver-search-provider.js';

const object = { props: { title: '<mark>한국은행</mark> 경제전망', href: 'https://www.bok.or.kr/report', bodyText: '2026년 <mark>물가</mark> 전망' }, templateId: 'webItem' };
const HTML = `<script>render(${JSON.stringify(object)});</script>`;

test('네이버 공개 웹검색은 내장 결과의 출처·제목·설명만 추출한다', async () => {
  assert.deepEqual(naverHtmlResults(HTML), [{ title: '한국은행 경제전망', url: 'https://www.bok.or.kr/report', snippet: '2026년 물가 전망', sourceType: 'web' }]);
  const provider = makeNaverSearchProvider({ fetchImpl: async () => new Response(HTML, { status: 200 }) });
  assert.equal((await provider.search('한국 물가'))[0].title, '한국은행 경제전망');
});
