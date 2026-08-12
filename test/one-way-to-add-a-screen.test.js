// **확장 통로를 하나로** (UX 기획 §2 조각 F · 2026-08-12).
//
// 조사가 낸 것: 새 화면 하나를 더하려면 **다섯 곳**을 고쳐야 했다 —
//   ① 마크업 ② CSS 선택자 목록 셋 ③ 열기/닫기 한 벌 ④ 진입 배선 ⑤ 닫기 배선 셋.
// 그중 넷은 화면마다 똑같은 일이라, 복사되는 만큼 **하나를 빠뜨린 화면**이 생긴다.
// 실제로 그랬다: Esc 는 조각 B 가 붙이기 전까지 두 화면 다 없었고, 설정의 닫는 문 둘(✕ ·
// 「대화로 돌아가기」)은 각각 따로 배선돼 있었다.
//
// 이 검사가 무는 것은 「통로가 있다」가 아니라 **「통로에 실제로 올라가 있다」**이다 —
// 등록표만 만들고 아무도 안 쓰면 그건 만든 것이지 닿은 것이 아니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');

test('통로가 하나 있다 — 열기·닫기·배경 클릭·✕ 가 한 자리에 모였다', () => {
  const 등록 = html.slice(html.indexOf('function 오버레이등록('), html.indexOf('async function 오버레이열기('));
  assert.ok(등록.length > 0, '오버레이등록 을 못 찾았다');
  assert.match(등록, /겉\.addEventListener\('click'[\s\S]*오버레이닫기/, '배경 클릭 닫기가 통로 안에 있어야 한다');
  assert.match(등록, /for \(const id of 닫기단추\)/, '✕ 같은 닫는 문들도 통로가 배선해야 한다');
  assert.match(등록, /if \(!겉\) return null;/, '없는 화면은 등록하지 않는다 — 죽은 문을 만들지 않는다');
  assert.match(html, /document\.body\.classList\.remove\('nav-open'\);\s*\/\/ 좁은 화면에서/,
    '사이드바 접기도 화면마다 복사하지 않고 통로가 한다');
});

// ★ 이 검사가 이 조각의 알맹이다. 소비자 0인 통로는 「영향 0」이다.
test('기존 화면 둘이 **실제로** 그 통로에 올라가 있다 — 만든 것이 아니라 닿은 것이다', () => {
  assert.match(html, /오버레이등록\(\{\s*\n?\s*이름: '도구함',/, '도구함이 통로에 안 올라가 있다');
  assert.match(html, /오버레이등록\(\{ 이름: '설정', 덮개: 'setov', 닫기단추: \['set-x', 'set-back'\]/,
    '설정이 통로에 안 올라가 있다(닫는 문 둘 다 등록해야 한다)');
  // 열고 닫는 일을 화면이 제 손으로 하면 통로를 우회한 것이다.
  assert.doesNotMatch(html, /setov\.classList\.add\('open'\)/, '설정이 통로를 우회해 스스로 연다');
  assert.doesNotMatch(html, /tbov\.classList\.add\('open'\)/, '도구함이 통로를 우회해 스스로 연다');
  assert.match(html, /function closeSettings\(\) \{ 오버레이닫기\('설정'\); \}/, '닫기도 통로를 지나야 한다');
  assert.match(html, /function closeToolbox\(\) \{ 오버레이닫기\('도구함'\); \}/, '닫기도 통로를 지나야 한다');
});

test('닫기 배선이 화면마다 복사돼 있지 않다 — 빠뜨릴 자리가 없어졌다', () => {
  assert.doesNotMatch(html, /setov\.onclick = /, '배경 클릭 배선이 아직 화면 쪽에 남아 있다');
  assert.doesNotMatch(html, /tbov\.onclick = /, '배경 클릭 배선이 아직 화면 쪽에 남아 있다');
  assert.doesNotMatch(html, /getElementById\('set-x'\)\.onclick/, '✕ 배선이 아직 화면 쪽에 남아 있다');
  assert.doesNotMatch(html, /getElementById\('tb-x'\)\.onclick/, '✕ 배선이 아직 화면 쪽에 남아 있다');
});

test('Esc 는 화면 이름을 하나씩 적지 않는다 — 그게 다섯째 자리였다', () => {
  const esc = html.slice(html.indexOf("if (e.key !== 'Escape') return;"), html.indexOf("if (손바.classList"));
  assert.match(esc, /열린오버레이\(\)/, '열린 것을 통로에 물어야 한다');
  assert.doesNotMatch(esc, /setov\.classList\.contains|tbov\.classList\.contains/,
    'Esc 에 화면 이름을 적으면 새 화면이 늘 때마다 이 줄을 고쳐야 한다');
  // 한 번에 하나만 — 조각 B 가 세운 계약이 통로로 옮겨도 그대로여야 한다.
  assert.match(esc, /오버레이닫기\(열린것\.at\(-1\)\.이름\); return;/,
    '맨 나중에 연 것 하나만 닫는다(한 번에 둘을 닫으면 무엇이 닫혔는지 모른다)');
  // ⚠ 「맨 나중에 연 것」이 성립하려면 **연 순서를 세야** 한다. 첫 판은 안 세서 등록 순서로
  //   닫았고, 라이브에서 둘을 같이 열어 보고서야 드러났다(주석은 맞고 코드가 틀렸다).
  assert.match(html, /문\.연때 = \+\+열림순번;/, '열 때마다 순번을 남겨야 한다');
  assert.match(html, /\.sort\(\(a, b\) => \(a\.연때 \?\? 0\) - \(b\.연때 \?\? 0\)\)/,
    '연 순서로 세우지 않으면 at(-1) 은 「맨 나중에 연 것」이 아니라 등록 순서다');
});

test('새 화면은 CSS 를 안 건드린다 — 통로가 받는 규칙이 따로 있다', () => {
  assert.match(html, /\.ov \{ position:fixed; inset:0; z-index:30; display:none;/,
    '새 화면이 쓸 겉 규칙이 있어야 한다');
  assert.match(html, /\.ov\.open \{ display:block; \}/, '열림 규칙도 이름 없이 서야 한다');
  assert.match(html, /\.ovpanel \{ position:absolute;/, '패널 규칙도 이름 없이 서야 한다');
  // §1 규약: 기존 줄은 안 고친다 — 두 화면은 여전히 id 규칙으로 선다.
  assert.match(html, /#tbov, #setov \{ position:fixed; inset:0; z-index:30; display:none;/,
    '기존 규칙을 고치면 두 화면이 이 커밋에서 같이 흔들린다 — 옮기는 일과 정리하는 일을 섞지 않는다');
});

test('해시 라우팅·깊은 링크는 이번에 안 한다 (기획 §4)', () => {
  assert.doesNotMatch(html, /location\.hash|pushState|popstate/,
    '주소를 붙이는 것은 범위가 크다 — 조각 여섯을 닫고 별건으로 간다');
});
