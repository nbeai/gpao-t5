// **대화와 화면에 주소가 생긴다** (UX 기획 §4 「F 다음」 · 2026-08-13).
//
// 조사가 낸 사실: `hash`·`pushState` **0건** — **세션조차 주소가 없었다.**
// 그래서 링크로 대화를 열 수도, 뒤로가기로 돌아올 수도, 새로고침 뒤 같은 자리로 돌아올 수도
// 없었다. 오너의 *"페이지도 하나도 새로 생성된 게 없네"* 가 가장 정확하게 참인 자리다 —
// 화면이 없었던 게 아니라 **주소가 없어서 「페이지」라는 개념이 없었다.**
//
// 기획 §4 는 이걸 *"범위가 크다 — **F 다음**"* 으로 미뤄 뒀다. F 가 닫혔으므로 지금이 그 자리다.
// 그래서 이 파일은 조각 F 검사의 *"이번에 안 한다"* 를 **대체한다**(무르게 한 것이 아니라,
// 미뤄 둔 조건이 충족돼 열린 것이다 — 조각 F 검사 쪽에도 그 사유를 적었다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');
const G블록 = (() => {
  const 시작 = html.indexOf('// ── 조각 G · 대화와 화면에 **주소**가 생긴다');
  if (시작 < 0) return '';
  const 끝 = html.indexOf('</script>', 시작);
  return 끝 > 시작 ? html.slice(시작, 끝) : '';
})();

test('조각 G 블록이 있다 — 없으면 아래가 아무것도 못 지킨다', () => {
  assert.ok(G블록.length > 0, '조각 G 블록을 못 찾았다');
});

test('연 대화가 주소에 남는다 — 링크가 성립하는 최소 조건이다', () => {
  assert.match(html, /주소쓰기\(`\/s\/\$\{id\}`\);/, 'selectSession 이 주소를 남겨야 한다');
  assert.match(G블록, /history\[밀기 \? 'pushState' : 'replaceState'\]/,
    '뒤로가기가 생기려면 이력에 밀어야 한다');
});

// ★ 이 검사가 조각 F 의 값을 실제로 거둔 자리다.
test('화면 주소에 **화면 이름을 하나도 안 적는다** — 통로가 이름을 안다(조각 F)', () => {
  assert.match(html, /주소쓰기\(`\/화면\/\$\{이름\}`\);/, '통로가 열릴 때 주소를 남긴다');
  assert.match(G블록, /오버레이표\.has\(화면\[1\]\)/, '주소를 읽을 때도 통로에 물어본다');
  assert.doesNotMatch(G블록, /설정|도구함|tbov|setov/,
    '여기 화면 이름을 적으면 새 화면이 늘 때마다 이 블록을 고쳐야 한다 — 그게 조각 F 이전이다');
});

test('주소가 말하지 않는 화면은 닫힌다 — 안 그러면 뒤로가기가 아무 일도 안 한 것처럼 보인다', () => {
  assert.match(G블록, /for \(const 문 of 열린오버레이\(\)\) if \(!화면 \|\| 문\.이름 !== 화면\[1\]\) 오버레이닫기\(문\.이름\);/,
    '주소와 화면이 어긋나면 사용자는 뒤로가기가 고장 났다고 읽는다');
  assert.match(html, /if \(!열린오버레이\(\)\.length\) 주소쓰기\(currentSessionId \? `\/s\/\$\{currentSessionId\}` : ''\);/,
    '화면을 닫으면 주소는 그 아래 대화로 돌아간다 — 빈 주소로 떨어뜨리지 않는다');
});

// 되돌아오는 고리(주소→화면→주소→…)는 이 자물쇠 하나로만 끊긴다. 지우면 조용히 무한이 된다.
test('주소와 화면이 서로를 되쓰지 않는다 — 자물쇠가 하나 있다', () => {
  assert.match(G블록, /let 주소읽는중 = false;/, '자물쇠가 있어야 한다');
  assert.match(G블록, /if \(주소읽는중\) return;/, '읽는 중에는 되쓰지 않는다');
  assert.match(G블록, /finally \{ 주소읽는중 = false; \}/, '예외가 나도 자물쇠는 풀려야 한다');
  assert.match(G블록, /if \(location\.hash === 새\) return;/,
    '같은 자리를 이력에 쌓으면 뒤로가기를 여러 번 눌러야 한 칸 움직인다');
});

test('링크로 들어온 사람에게 **다른 대화를 열어 주지 않는다**', () => {
  assert.match(html, /if \(\/\^\\\/\(s\|화면\)\\\/\/\.test\(온길\)\) \{ await 주소따라가기\(\); \}/,
    '주소가 있으면 주소가 먼저다 — 최근 대화를 열면 그 링크는 거짓말이 된다');
});

test('뒤로가기·주소 직접 입력·새로고침이 **같은 한 자리**로 온다', () => {
  assert.match(G블록, /window\.addEventListener\('hashchange', 주소따라가기\);/, 'hashchange');
  assert.match(G블록, /window\.addEventListener\('popstate', 주소따라가기\);/, 'popstate');
  // 셋이 다른 함수로 갈라지면 그중 하나만 고쳐지는 일이 생긴다(조각 F 가 고친 그 병).
  assert.equal((G블록.match(/주소따라가기\)/g) || []).length, 2, '두 사건이 같은 함수로 와야 한다');
});

test('주소가 가리키던 것이 사라져도 화면이 안 깨진다', () => {
  assert.match(G블록, /catch \{ \/\* 주소가 가리키던 것이 사라졌을 수 있다/,
    '지운 대화의 링크를 열었을 때 흰 화면이 되면 안 된다');
});
