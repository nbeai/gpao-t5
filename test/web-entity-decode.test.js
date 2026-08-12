// **읽어 온 글자를 모델이 읽을 수 있어야 한다.**
//
// 라이브 사고(오너 2026-08-05): `오늘 날씨 어때?` 에 T5 가 **"25℃ 안팎"** 이라고 답했다.
// 화면에는 `▸찾아서 읽었어요: … AccuWeather` 가 떴다.
//
// 원장을 열어 보니 **데이터는 다 와 있었다** — 껍데기가 아니었다:
//   폭염중대경보 · 열대야 주의보 · RealFeel Shade™ 38° · 체감수 40° · 바람 북북동 4km/h
// 그런데 **엔티티 770개**로 인코딩돼 있어 모델은 `&#xD3ED;&#xC5FC;...` 를 읽었다.
// 못 읽으니 지어냈고, 실제(체감 38~40°·폭염경보)와 답(25℃)이 완전히 달랐다.
//
// 매듭은 한 줄이었다:
//   .replace(/&#(\d+);/g, ...)      ← **10진수만** 푼다. `&#x...;`(16진수)는 그대로 남는다.
//
// 이건 판정도 휴리스틱도 아니다. **읽어 온 것을 읽을 수 있게 만드는 것**뿐이다 —
// 그게 안 되면 그 위의 모든 계약(출처·원장·거짓 성공 게이트)이 빈 껍데기 위에 선다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTitle, extractReadable } from '../src/runtime/readable.js';

const 페이지 = (본문) => `<html><head><title>${본문}</title></head><body><article><p>${본문}</p></article></body></html>`;
const 본문 = (html) => extractReadable(html).markdown ?? '';

test('① **16진수 엔티티를 푼다** — 라이브에서 한글이 통째로 안 읽혔다', () => {
  const 원문 = '&#xD3ED;&#xC5FC;&#xC911;&#xB300;&#xACBD;&#xBCF4;';   // 폭염중대경보
  assert.equal(extractTitle(페이지(원문)), '폭염중대경보',
    `**16진수 엔티티가 안 풀렸다** — 모델은 이걸 그대로 읽는다: ${extractTitle(페이지(원문))}`);
  assert.match(본문(페이지(원문)), /폭염중대경보/, '본문 쪽도 안 풀렸다');
});

test('② **대문자 X 도 푼다** — `&#X...;` 는 규격상 같은 것이다', () => {
  assert.equal(extractTitle(페이지('&#X48;&#X49;')), 'HI');
});

test('③ **10진수·이름 있는 것은 그대로 푼다** — 되던 것을 안 깬다(회귀)', () => {
  assert.equal(extractTitle(페이지('&#54620;&#44397;')), '한국', '10진수가 깨졌다');
  assert.equal(extractTitle(페이지('a&amp;b&nbsp;c')), 'a&b c', '이름 있는 엔티티가 깨졌다');
});

test('④ **BMP 밖도 안 깨진다** — `fromCharCode` 는 이모지를 못 만든다', () => {
  // U+1F324 (구름 뒤 해). fromCharCode 로 풀면 깨진 글자가 나온다.
  assert.equal(extractTitle(페이지('&#x1F324;')), '🌤',
    '**BMP 밖 문자가 깨졌다** — 날씨·지도 페이지에는 이런 기호가 흔하다');
});

test('⑤ **말이 안 되는 엔티티는 원문 그대로 둔다** — 지어내지 않는다', () => {
  // 코드포인트 범위를 벗어난 것. 억지로 바꾸면 없는 글자를 만들어 낸다.
  const 이상한것 = '&#x110000;';
  assert.equal(extractTitle(페이지(이상한것)), 이상한것,
    '풀 수 없는 것을 억지로 바꿨다 — 못 읽는 것은 못 읽는 대로 두는 게 정직하다');
});

test('⑥ **읽어 온 글에 안 풀린 엔티티가 안 남는다** — 라이브 그 페이지 모양으로', () => {
  // AccuWeather 가 실제로 보낸 모양(한글 전부 16진수 + 숫자·기호는 평문).
  const 실제모양 = '<html><body><article><p>'
    + '&#xCCB4;&#xAC10;&#xC218; 40&#xB3C4; &#xBC14;&#xB78C; &#xBD81;&#xBD81;&#xB3D9; 4km/h'
    + '</p></article></body></html>';
  const md = 본문(실제모양);
  assert.doesNotMatch(md, /&#x[0-9a-f]+;/i,
    `**모델 재료에 안 풀린 엔티티가 남았다**: ${md.slice(0, 120)}\n`
    + '모델은 이걸 읽고 답을 만든다 — 못 읽으면 지어낸다(라이브에서 25℃ 를 지어냈다).');
  assert.match(md, /체감수 40도/, `한글이 안 살아났다: ${md.slice(0, 120)}`);
});
