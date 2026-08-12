// **스트리밍이 사람 속도로 흐른다** (UX 기획 §2 조각 A · 2026-08-12).
//
// 격리 서버 실측(headless 크롬 · 실제 `streamTurn` 을 태우고 EventSource 만 가짜)이 낸 것:
//   ① 답이 흐르는 중 100px 올려 읽기를 8곳에서 반복 → **7곳에서 도로 끌려 내려갔다**(최대 399px)
//   ② 12줄짜리 조각 하나가 오면 따라가기가 **즉사**해 답 끝에서 2,406px 뒤에 남았다
//   ③ 10자를 드래그해 두면 다음 조각에 **0자**가 된다(innerHTML 통째 교체가 앵커를 지운다)
//   ④ 완료 순간 답 상자 높이가 619.8px → 447.4px 로 **-27.8%** 튄다(미리보기 class 가 `msg` 뿐)
//   ⑤ 조각당 메인스레드 1.425ms(뒤 10조각 2.48ms · 최대 4.3ms). 파싱은 0.024ms —
//      나머지는 조각마다 `scrollHeight` 를 읽고 바로 쓰는 **강제 동기 레이아웃**이다
//
// 이 검사는 **DOM 이 없으므로 계약이 서 있는 자리**를 본다(같은 파일의 다른 검사들과 같은 방식).
// 살아 움직이는 값은 격리 서버 실측으로 재고, 여기서는 **그 값을 만든 규칙이 지워지지 않는지**를 지킨다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');
const md = await readFile(new URL('../src/surface/web/markdown.js', import.meta.url), 'utf8');

/** 이름 있는 함수 하나의 본문(다음 줄머리 `}` 까지). */
function 본문(src, 머리) {
  const at = src.indexOf(머리);
  assert.ok(at >= 0, `${머리} 를 못 찾았다 — 이 검사는 아무 것도 못 지킨다`);
  const 뒤 = src.slice(at);
  return 뒤.slice(0, 뒤.indexOf('\n}') + 2);
}

// ── ①⑤ 따라가기는 한 프레임에 한 번, 읽고 나서 쓴다 ──────────────────────
test('조각마다 재고 쓰지 않는다 — 한 프레임에 한 번, 읽기가 쓰기보다 앞이다', () => {
  const 코드 = 본문(html, 'function scrollToBottom(');
  assert.match(코드, /requestAnimationFrame/,
    '조각마다 바로 scrollTop 을 쓰면 조각마다 강제 동기 레이아웃이 난다(실측 조각당 1.4~2.5ms)');
  const 읽기 = 코드.indexOf('logEl.scrollHeight');
  const 쓰기 = 코드.indexOf('logEl.scrollTop =');
  assert.ok(읽기 >= 0 && 쓰기 >= 0, '읽는 곳과 쓰는 곳이 있어야 한다');
  assert.ok(읽기 < 쓰기, '쓰고 나서 읽으면 그 자리에서 레이아웃이 강제로 다시 계산된다');
  assert.match(코드, /예약된따라가기/, '이미 예약돼 있으면 한 프레임에 두 번 예약하지 않는다');
});

test('따라갈지는 **문턱**이 아니라 「사용자가 올렸는가」로 정한다', () => {
  const 코드 = 본문(html, 'function scrollToBottom(');
  assert.doesNotMatch(코드, /nearBottom\(\)/,
    '문턱 120px 은 두 쪽으로 다 틀렸다 — 잘면 올린 사람을 끌어내리고(최대 399px), 굵으면 즉사한다');
  assert.match(코드, /따라간다/, '판정은 「지금 따라가는 중인가」 한 상태로만 한다');
  assert.match(html, /logEl\.addEventListener\('scroll'/,
    '사용자가 올렸는지는 스크롤을 실제로 들어야 안다');
  assert.match(html, /우리가옮긴자리/,
    '우리가 옮긴 것을 사용자가 올린 것으로 착각하면 첫 조각에 따라가기가 꺼진다');
});

test('한 번 올리면 새 발화에서만 다시 따라간다', () => {
  const submit = 본문(html, 'async function submit()');
  assert.match(submit, /scrollToBottom\(true\)/, '내가 보낸 말은 무조건 따라간다(따라가기 초기화 지점)');
  const 코드 = 본문(html, 'function scrollToBottom(');
  assert.match(코드, /force[\s\S]*따라간다 = true/,
    'force 는 「이 순간부터 다시 따라간다」여야 한다 — 한 번만 내리고 다시 꺼지면 새 발화에서도 끊긴다');
});

// ── ④ 완료 순간 높이가 안 튄다 ────────────────────────────────────────────
test('흐르는 동안의 상자와 끝난 뒤의 상자가 **같은 조**다', () => {
  const 미리보기 = html.match(/preview\.className = '([^']+)'/);
  assert.ok(미리보기, '미리보기 상자의 class 를 못 찾았다');
  assert.equal(미리보기[1], 'msg bot',
    '최종 답은 `msg bot` 인데 미리보기가 `msg` 면 완료 순간 높이가 -27.8% 튄다(실측 619.8→447.4px)');
});

// ── ③ 선택이 살아남는다 ───────────────────────────────────────────────────
test('그릴 때 통째로 갈아치우지 않는다 — 뒤에 붙은 글자는 **붙인다**', () => {
  const 코드 = 본문(md, 'export function renderMarkdownInto(');
  assert.doesNotMatch(코드, /node\.innerHTML\s*=\s*renderMarkdown/,
    'innerHTML 통째 교체는 드래그 선택 앵커를 지운다(실측 10자 → 0자)');
  assert.match(md, /appendData/,
    '글자가 뒤에만 늘어난 경우 appendData 로 붙여야 그 안의 선택 범위가 살아남는다');
  assert.match(md, /startsWith/, '뒤에만 붙었는지를 실제로 확인해야 한다');
});

test('겹쳐 맞추기는 **우리가 만든 태그만** 다룬다 — 안전 계약을 안 넓힌다', () => {
  assert.match(md, /먼저 전부 escape/, '안전 계약 1이 파일에 남아 있어야 한다');
  const 새로들어온것 = (md.match(/\.innerHTML\s*=/g) ?? []).length;
  assert.equal(새로들어온것, 1,
    'HTML 을 문자열로 넣는 자리는 **한 곳**뿐이어야 한다(그 한 곳이 renderMarkdown 의 출력이다)');
});

// ── ④+ 「맨 아래로」 ───────────────────────────────────────────────────────
test('「맨 아래로」는 따라가기가 꺼져 있을 때만 있다 — 죽은 버튼을 만들지 않는다', () => {
  assert.match(html, /id = 'tobottom'/, '「맨 아래로」 버튼이 있어야 한다');
  assert.match(html, /#tobottom-slot \{[^}]*display:none/,
    '기본은 숨김이다 — 이미 아래를 보고 있는 사람에게 누를 데를 주면 그게 죽은 버튼이다');
  assert.match(html, /#tobottom-slot\.on \{[^}]*display:block/, '꺼졌을 때만 보인다');
});

// ── 동시 작업 조건(기획 §1) ───────────────────────────────────────────────
test('새 스타일은 <style> 맨 끝에 조각 이름과 함께 붙어 있다', () => {
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const 표식 = style.indexOf('/* ── 조각 A ·');
  assert.ok(표식 >= 0, '어느 조각이 넣은 스타일인지 주석으로 밝혀야 다른 팀이 리베이스할 수 있다');
  assert.ok(style.indexOf('#tobottom') > 표식, '조각 A 의 스타일은 그 표식 **뒤에만** 있어야 한다');
});
