// Phase 0-2b · 본문 추출 품질 검증 (기준: Crawl4AI "LLM-ready Markdown", 오너 결정).
// 이전 동작의 결함: 모든 태그를 지우고 앞 500자를 잘라 **네비게이션·쿠키 배너가 본문이 됐다**.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractReadable, extractTitle, extractDescription, extractLinks } from '../src/runtime/readable.js';

const PAGE = `<!doctype html><html><head>
  <title>사이트이름 - 기준금리 발표</title>
  <meta property="og:title" content="기준금리 발표">
  <meta name="description" content="한국은행이 기준금리를 동결했다.">
</head><body>
  <nav><a href="/">홈</a><a href="/news">뉴스</a><a href="/login">로그인</a></nav>
  <header><div>쿠키를 사용합니다</div></header>
  <script>var ads = 1;</script>
  <article>
    <h1>기준금리 동결</h1>
    <p>한국은행 금융통화위원회는 오늘 기준금리를 현 수준에서 동결하기로 결정했다.</p>
    <p>짧음</p>
    <h2>배경</h2>
    <ul><li>물가 안정세</li><li>가계부채 부담</li></ul>
    <table>
      <tr><td>구분</td><td>값</td></tr>
      <tr><td>기준금리</td><td>3.00%</td></tr>
      <tr><td>v</td><td></td></tr>
    </table>
    <blockquote>다음 회의에서 재검토한다.</blockquote>
    <p>추가 설명이 이어지는 충분히 긴 문단입니다. 본문으로 인정되어야 합니다.</p>
    <a href="/detail">자세히</a>
  </article>
  <footer>구독하세요</footer>
</body></html>`;

test('제목: og:title 을 우선하고 사이트명 꼬리표를 끌고 오지 않는다', () => {
  assert.equal(extractTitle(PAGE), '기준금리 발표');
});

test('페이지가 밝힌 요약(description)을 그대로 쓴다', () => {
  assert.equal(extractDescription(PAGE), '한국은행이 기준금리를 동결했다.');
});

test('본문이 네비게이션·쿠키·광고가 아니라 실제 첫 문단으로 시작한다(이전 동작의 결함)', () => {
  const { markdown } = extractReadable(PAGE);
  assert.ok(markdown.startsWith('# 기준금리 동결'), `실제: ${markdown.slice(0, 60)}`);
  assert.ok(!markdown.includes('홈'), '네비게이션이 본문에 섞이면 안 된다');
  assert.ok(!markdown.includes('쿠키를 사용합니다'));
  assert.ok(!markdown.includes('구독하세요'));
  assert.ok(!markdown.includes('var ads'));
});

test('구조를 남긴다 — 제목·목록·표·인용이 마크다운으로', () => {
  const { markdown } = extractReadable(PAGE);
  assert.ok(markdown.includes('## 배경'));
  assert.ok(markdown.includes('- 물가 안정세'));
  assert.ok(markdown.includes('| 기준금리 | 3.00% |'), '표는 셀 구분이 남아야 모델이 읽는다');
  assert.ok(markdown.includes('> 다음 회의에서 재검토한다.'));
});

test('1칸짜리 표 행(인포박스 제목·"v t e" 네비)은 버린다', () => {
  const { markdown } = extractReadable(PAGE);
  assert.ok(!markdown.includes('| v |'));
  assert.ok(!/\|\s*v\s*\|\s*\|/.test(markdown));
});

test('의미 없는 짧은 문단은 버리고 긴 문단은 남긴다', () => {
  const { markdown } = extractReadable(PAGE);
  assert.ok(!markdown.includes('짧음'));
  assert.ok(markdown.includes('추가 설명이 이어지는'));
});

test('본문 컨테이너가 없어도 빈손으로 돌려주지 않는다(건진 척도 안 한다)', () => {
  const plain = '<html><body>구조 없는 페이지의 본문 텍스트가 여기 있습니다.</body></html>';
  const { markdown, blocks } = extractReadable(plain);
  assert.ok(markdown.includes('구조 없는 페이지'));
  assert.equal(blocks, 0, '구조를 못 건졌다는 사실은 정직하게 남긴다');
});

test('링크는 절대 주소로 바꾸고 중복을 지운다', () => {
  const links = extractLinks(PAGE, 'https://example.com/news/1');
  assert.ok(links.some((l) => l.url === 'https://example.com/detail'));
  assert.equal(new Set(links.map((l) => l.url)).size, links.length);
});

test('HTML 엔티티를 사람이 읽는 글자로 되돌린다', () => {
  const { markdown } = extractReadable('<article><p>가격은 100&nbsp;원이고 A&amp;B 사의 제품입니다.</p></article>');
  assert.ok(markdown.includes('A&B'));
  assert.ok(!markdown.includes('&nbsp;'));
});

test('길이 상한을 지킨다(프롬프트 폭주 금지)', () => {
  const long = `<article>${'<p>충분히 긴 문단입니다. 반복됩니다.</p>'.repeat(2000)}</article>`;
  const { markdown } = extractReadable(long, { maxChars: 1000 });
  assert.ok(markdown.length <= 1000);
});
