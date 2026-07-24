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
