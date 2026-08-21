// P2-7 · 최소 안전 마크다운 렌더러.
//
// 실사용 결함: 모델 답변을 textContent 로 그려서 `#`, `**`, 코드 울타리가 화면에 그대로 찍혔다.
// 사람이 읽는 글이 아니라 원문 소스가 보였다.
//
// **안전이 본체다.** 답변에는 우리가 수집한 웹페이지 내용이 섞여 들어온다 — 거기 HTML 이 있으면
// 그대로 통과시켜선 안 된다. 그래서 "무엇이 예쁘게 나오는가"보다 "무엇이 절대 통과하지 않는가"를
// 더 많이 검사한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/surface/web/markdown.js';

// ── 화면에 원문이 보이지 않는다 ──────────────────────────────────────────
test('제목 · 굵게 · 기울임이 글자가 아니라 서식이 된다', () => {
  const h = renderMarkdown('## 한줄 판단\n**팔식당**은 *청담동* 고깃집이에요.');
  assert.match(h, /<h2>한줄 판단<\/h2>/);
  assert.match(h, /<strong>팔식당<\/strong>/);
  assert.match(h, /<em>청담동<\/em>/);
  assert.doesNotMatch(h, /##|\*\*/, '원문 기호가 화면에 남으면 고친 게 아니다');
});

test('목록이 목록으로 나온다(번호·기호 모두)', () => {
  const h = renderMarkdown('- 고기 질\n- 친절함\n\n1. 첫째\n2. 둘째');
  assert.match(h, /<ul><li>고기 질<\/li><li>친절함<\/li><\/ul>/);
  assert.match(h, /<ol><li>첫째<\/li><li>둘째<\/li><\/ol>/);
});

test('코드 블록 안은 서식이 아니라 코드다', () => {
  const h = renderMarkdown('```python\nnums.sort(reverse=True)  # **굵게 아님**\n```');
  assert.match(h, /<pre><code class="lang-python">/);
  assert.match(h, /\*\*굵게 아님\*\*/, '코드 안의 별표는 서식이 아니다');
  assert.doesNotMatch(h, /<strong>/);
});

test('인라인 코드 안의 별표·대괄호도 서식이 되지 않는다', () => {
  const h = renderMarkdown('`arr[*]` 를 쓰세요');
  assert.match(h, /<code>arr\[\*\]<\/code>/);
});

test('스트리밍 중 안 닫힌 코드 울타리도 깨지지 않는다(미리보기와 최종이 같은 경로)', () => {
  const h = renderMarkdown('설명입니다.\n```python\nnums.sort(');
  assert.match(h, /<pre><code class="lang-python">nums\.sort\(<\/code><\/pre>/);
});

// ── 링크 ────────────────────────────────────────────────────────────────
test('마크다운 링크와 맨몸 주소 모두 누를 수 있게 된다', () => {
  const h = renderMarkdown('출처: [네이버](https://m.place.naver.com/x) 그리고 https://example.com/a');
  assert.match(h, /<a href="https:\/\/m\.place\.naver\.com\/x" target="_blank" rel="noopener noreferrer">네이버<\/a>/);
  assert.match(h, /<a href="https:\/\/example\.com\/a"/);
});

test('T5가 발급한 browser artifact만 대화 안의 이미지 미리보기로 그린다', () => {
  const id = 'f8877100-adb2-41d1-a4a1-95a5824e6e1d';
  const session = 't5-0123456789abcdef0123';
  const h = renderMarkdown(`![브라우저 화면](/browser-artifacts/${session}/browser-${id}.png)`);
  assert.match(h, new RegExp(`<img src="/browser-artifacts/${session}/browser-${id}\\.png"`));
  assert.match(h, /alt="브라우저 화면"/);
});

test('현재 Session에 결속된 T5 관리 attachment preview도 대화 안에 그린다', () => {
  const attachment = '493cfdb2-e6d9-4bb3-994d-e8266c3b70d6';
  const session = '5d26fa7f-a122-4eab-ae86-39b5f14bbd8c';
  const path = `/attachments/${attachment}/content?sessionId=${session}&inline=1`;
  assert.match(renderMarkdown(`![참고 이미지](${path})`), new RegExp(`<img src="${path.replace('?', '\\?').replace('&', '&amp;')}"`));
});

test('외부·data·임의 상대경로 이미지는 미리보기 권한을 얻지 않는다', () => {
  for (const source of [
    '![외부](https://example.com/x.png)',
    '![data](data:image/png;base64,AAAA)',
    '![파일](../../secret.png)',
    '![가짜](/browser-artifacts/t5-bad/browser-not-a-uuid.png)',
  ]) {
    const h = renderMarkdown(source);
    assert.doesNotMatch(h, /<img\b/, source);
  }
});

// ── 여기서부터가 본체: 무엇이 절대 통과하지 않는가 ────────────────────────
test('HTML 은 통과하지 않는다 — 수집한 페이지의 태그가 답변에 섞여도 글자로 보인다', () => {
  const h = renderMarkdown('<script>alert(1)</script><img src=x onerror=alert(1)>');
  assert.doesNotMatch(h, /<script|<img/i, '모델·웹페이지에서 온 HTML 이 실행되면 안 된다');
  assert.match(h, /&lt;script&gt;/);
});

test('javascript: 링크는 링크가 되지 않는다', () => {
  const h = renderMarkdown('[눌러보세요](javascript:alert(1))');
  assert.doesNotMatch(h, /<a /, 'http/https 가 아니면 링크로 만들지 않는다');
  assert.match(h, /눌러보세요/, '글자는 남긴다 — 조용히 지우면 무슨 말인지 모른다');
});

test('data: 링크도 막는다', () => {
  const h = renderMarkdown('[문서](data:text/html;base64,PHNjcmlwdD4=)');
  assert.doesNotMatch(h, /<a /);
});

test('링크 라벨에 태그를 숨겨도 통과하지 않는다', () => {
  const h = renderMarkdown('[<img src=x onerror=alert(1)>](https://ok.example)');
  assert.doesNotMatch(h, /<img/i);
  assert.match(h, /<a href="https:\/\/ok\.example"/);
});

test('속성 탈출을 시도해도 우리가 만든 속성만 남는다', () => {
  const h = renderMarkdown('[x](https://a.example/"onmouseover="alert(1))');
  assert.doesNotMatch(h, /<a /, '주소에 따옴표가 들어갈 이유는 없다 — 속성 탈출 시도로 보고 링크로 만들지 않는다');
  // 그리고 우리가 만드는 링크 태그의 속성은 href·target·rel 뿐이다(불변식).
  for (const tag of renderMarkdown('[ok](https://ok.example) https://b.example/c').match(/<a [^>]*>/g) ?? []) {
    assert.deepEqual([...tag.matchAll(/\s([a-zA-Z-]+)=/g)].map((m) => m[1]), ['href', 'target', 'rel']);
  }
});

test('빈 입력·없는 입력에 아무 것도 만들지 않는다', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(null), '');
});

// ── 표 (F-9 · 2026-08-08) — 모델이 정확히 낸 표가 파이프 문자로 떴다 ──────────
test('표가 표로 그려진다 — 머리행·구분행·본문행', () => {
  const h = renderMarkdown('| 항목 | 예산 |\n|---|---|\n| 광고 | 300,000 |\n| 배달 | 120,000 |');
  assert.match(h, /<table><thead><tr><th>항목<\/th><th>예산<\/th><\/tr><\/thead>/);
  assert.match(h, /<td>광고<\/td><td>300,000<\/td>/);
  assert.match(h, /<td>배달<\/td>/);
  assert.doesNotMatch(h, /\|/, '파이프 문자가 화면에 남으면 F-9 그대로다');
});

test('구분행이 없으면 표가 아니다 — 파이프 낀 문단은 문단으로 남는다(반대시험)', () => {
  const h = renderMarkdown('가격은 3,000 | 5,000 중 하나예요');
  assert.doesNotMatch(h, /<table>/);
  assert.match(h, /<p>/);
});

test('구분선(---)을 표 구분행으로 삼키지 않는다 — 한 칸짜리는 표가 아니다(반대시험)', () => {
  const h = renderMarkdown('a | b 라고 썼다\n---\n다음 문단');
  assert.doesNotMatch(h, /<table>/);
  assert.match(h, /<hr>/);
});

test('셀 안 HTML·서식 — escape 는 유지되고 inline 서식만 산다(안전 계약 1)', () => {
  const h = renderMarkdown('| 이름 | 값 |\n|---|---|\n| <script>x</script> | **굵게** |');
  assert.doesNotMatch(h, /<script>/);
  assert.match(h, /&lt;script&gt;/);
  assert.match(h, /<td><strong>굵게<\/strong><\/td>/);
});

test('정렬 콜론 — 고정 문자열 셋만 속성이 된다', () => {
  const h = renderMarkdown('| a | b | c |\n|:---|:---:|---:|\n| 1 | 2 | 3 |');
  assert.match(h, /<th>a<\/th><th style="text-align:center">b<\/th><th style="text-align:right">c<\/th>/);
});

test('들쭉날쭉한 행 — 칸수는 머리행이 정한다(남으면 버리고 모자라면 빈칸)', () => {
  const h = renderMarkdown('| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |');
  assert.match(h, /<td>1<\/td><td><\/td>/);
  assert.doesNotMatch(h, /<td>3<\/td>/);
});

test('표 뒤 문단이 정상으로 이어진다', () => {
  const h = renderMarkdown('| a |  b |\n|---|---|\n| 1 | 2 |\n\n그 다음 이야기');
  assert.match(h, /<\/table><p>그 다음 이야기<\/p>/);
});
