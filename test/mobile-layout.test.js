import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// 모바일 입력 잘림 회귀 게이트(감사 지적 수정 고정).
// CSS 레이아웃 자체는 브라우저 없이 검증 불가라, 잘림을 유발했던 원인의 부재/존재를
// 불변식으로 고정한다. 전체 시각 검증은 design/evidence/capture.mjs(Chrome headless)로.
const html = await readFile(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'surface', 'web', 'index.html'),
  'utf8',
);

// 원인: #text(flex textarea)에 min-width:0 이 없으면 placeholder 폭만큼 최소너비가 잡혀
// 보내기 버튼을 화면 밖으로 민다. 그 방지 규칙이 유지되는지 고정한다.
test('#text 에 min-width:0 이 있어 좁은 폭에서 보내기 버튼이 밀리지 않는다', () => {
  const textRule = html.match(/#text\s*\{[^}]*\}/s)?.[0] ?? '';
  assert.match(textRule, /min-width:\s*0/, '#text{min-width:0} 유지(모바일 잘림 방지)');
});

test('#send 는 flex:none·nowrap 로 폭을 유지한다', () => {
  const sendRule = html.match(/#send\s*\{[^}]*\}/s)?.[0] ?? '';
  assert.match(sendRule, /flex:\s*none/, '#send{flex:none} 유지');
  assert.match(sendRule, /white-space:\s*nowrap/, '#send nowrap 유지');
});

test('모바일 브레이크포인트(<=720px)가 존재한다(반응형 필수)', () => {
  assert.match(html, /@media\s*\(max-width:\s*720px\)/, '모바일 미디어쿼리 유지');
});

// ── 크럼 회귀 가드(P6-18 모바일) ── 375px에서 크럼(브레드크럼+기억 찾기+준비됨)이 단어 중간에서
//   꺾이던 회귀. 원인의 부재/존재를 불변식으로 고정한다(레이아웃 자체는 라이브 브라우저로 검증).
const css = html.replace(/\s+/g, ' ');

test('크럼 버튼은 단어 중간에서 안 꺾인다(nowrap) + 브레드크럼은 말줄임', () => {
  assert.match(css, /#searchbtn,\s*#chip\s*\{[^}]*white-space:\s*nowrap/, '검색·상태 버튼 nowrap');
  assert.match(css, /\.crumb\s+\.bc\s*\{[^}]*white-space:\s*nowrap[^}]*text-overflow:\s*ellipsis/, '브레드크럼 말줄임');
});

test('모바일 media query가 크럼을 압축한다(앱이름·검색라벨 숨김)', () => {
  const mq = css.match(/@media\s*\(max-width:\s*720px\)\s*\{([\s\S]*?)\}\s*<\/style>/);
  assert.ok(mq, '720px 이하 media query 블록');
  assert.match(mq[1], /\.crumb\s+\.appn\s*\{[^}]*display:\s*none/, '앱 이름 숨김');
  assert.match(mq[1], /#searchbtn\s+\.sb-t\s*\{[^}]*display:\s*none/, '검색 라벨 숨김(아이콘만)');
});

test('HTML에 압축·말줄임이 걸릴 훅이 있다(.bc/.appn/.sb-t)', () => {
  assert.match(html, /class="bc"[\s\S]*class="appn"/, '브레드크럼 훅');
  assert.match(html, /id="searchbtn"[\s\S]*class="sb-t"/, '검색 라벨 훅');
});
