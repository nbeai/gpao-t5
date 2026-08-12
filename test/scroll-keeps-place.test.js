// **대화를 통째로 다시 그릴 때 보던 자리를 잃지 않는다** (M5 연속성 ①).
//
// 팀 실측(2026-08-03): 답이 하나 끝날 때마다 화면이 맨 위 대화로 튀었다. `대화투영` 이
// `wrap.innerHTML = ''` 로 전부 새로 그리면 스크롤이 0 이 되는데, 그 뒤의 `scrollToBottom()`
// 은 **새 DOM 을 재서** "사용자가 위쪽을 보고 있다"고 판정해 아무 것도 안 한다.
//
// 고쳐졌지만 **보호 검사가 없었다** — 감싸는 한 줄을 지우면 조용히 되돌아간다.
// 이 계열은 오늘만 세 번 나왔다(고친 것 자체보다 그것을 지키는 그물이 없는 것).
//
// 재는 법: DOM 이 없으므로 **호출 자리**를 잰다. 통째로 다시 그리는 자리는 감싸져 있어야 하고,
// 예외는 **다른 대화를 여는 경로 하나**뿐이다(그때는 맨 아래가 맞다 — 새로 여는 대화의
// 마지막 대목부터 보이는 것이 사용자가 기대하는 것이다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');

/** `대화투영(` 을 실제로 부르는 줄(정의 줄은 뺀다). */
const 부르는줄 = html.split('\n')
  .map((line, i) => ({ line: line.trim(), no: i + 1 }))
  .filter(({ line }) => line.includes('대화투영(') && !line.startsWith('async function 대화투영'));

test('통째로 다시 그리는 자리가 실제로 존재한다(그물이 헛돌지 않는다)', () => {
  assert.ok(부르는줄.length >= 2, `대화투영 호출을 못 찾았다 — 이 검사는 아무 것도 못 지킨다 (${부르는줄.length}건)`);
});

test('현재 대화를 다시 그릴 때는 보던 자리를 지킨다', () => {
  const 현재대화 = 부르는줄.filter(({ line }) => line.includes('currentSessionId'));
  assert.ok(현재대화.length >= 2, '현재 대화 재투영 자리를 못 찾았다');
  const 안감싼것 = 현재대화.filter(({ line }) => !line.includes('자리지키며'));
  assert.deepEqual(안감싼것.map((x) => x.no), [],
    '감싸지 않으면 답이 끝날 때마다 화면이 맨 위로 튄다(팀 실측). 줄 번호: ' + 안감싼것.map((x) => x.no).join(', '));
});

test('다른 대화를 여는 경로만 예외다 — 그때는 마지막 대목부터가 맞다', () => {
  const 예외 = 부르는줄.filter(({ line }) => !line.includes('자리지키며'));
  assert.equal(예외.length, 1, `예외는 "다른 대화 열기" 하나여야 한다 (지금 ${예외.length}건)`);
  assert.ok(!예외[0].line.includes('currentSessionId'), '현재 대화가 예외로 새면 안 된다');
});

test('자리지키며는 갈아끼우기 **전에** 재고 나중에 되돌린다', () => {
  const 본체 = html.slice(html.indexOf('async function 자리지키며'));
  const 끝 = 본체.indexOf('\n}');
  const 코드 = 본체.slice(0, 끝);
  const 잰자리 = 코드.indexOf('nearBottom()');
  const 그린자리 = 코드.indexOf('await 그리기()');
  assert.ok(잰자리 >= 0 && 그린자리 >= 0, '재는 곳과 그리는 곳이 있어야 한다');
  assert.ok(잰자리 < 그린자리, '갈아끼운 **뒤에** 재면 새 DOM 을 재게 되어 판정이 틀린다(그게 원래 결함이었다)');
  assert.match(코드, /보던자리/, '따라보고 있지 않았다면 읽던 자리로 되돌려야 한다 — 맨 위로 튀는 것만큼 나쁘다');
});
