// **`↑` 로 방금 한 말이 돌아온다** (선행자 공부 §3 · 2026-08-13).
//
// 오너 지시에서 나온 조각이다: *"너는 인간의 행동을 모르잖아 … 이미 잘 쓰이고 있는 서비스를
// 보면서 **인간의 직관적 행동과 결핍과 필요를 헤아려서** UX 를 구성해야 한다."*
//
// 사람은 하루에도 몇 번씩 **방금 한 말을 조금 고쳐 다시 보낸다.** 셸도 챗도 그 짓을 `↑` 로
// 받는다 — 배우지 않고도 하는 손버릇이다. T5 에는 그 길이 없었다: 조각 B 의
// 「고쳐 다시 보내기」는 *지나간 말*에는 답을 줬지만 **입력칸에 선 사람**에게는 아무것도 안 줬다.
//
// 이 검사가 무는 것은 「↑ 가 동작한다」가 아니라 **「사람의 것을 안 뺏는다」**다.
// 되부르기는 편의고, 쓰던 글을 잃는 것은 손해다 — 손해가 편의보다 크면 안 만드느니만 못하다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');
const 블록 = (() => {
  const 시작 = html.indexOf('// ── 흡수 · `↑` 로 방금 한 말을 되부른다');
  if (시작 < 0) return '';
  const 끝 = html.indexOf('// ── 자판 (기획 §2 B-5) ──', 시작);
  return 끝 > 시작 ? html.slice(시작, 끝) : '';
})();

test('되부르기 블록이 있다 — 없으면 아래가 아무것도 못 지킨다', () => {
  assert.ok(블록.length > 0, '되부르기 블록을 못 찾았다');
});

// ★ 이 검사가 알맹이다. 편의보다 **안 뺏는 것**이 먼저다.
test('입력칸에 **글이 있으면 ↑ 를 안 가로챈다** — 커서를 옮기려는 사람이 더 많다', () => {
  assert.match(블록, /if \(되부름자리 === -1 && text\.value\.trim\(\)\) return;/,
    '쓰던 글이 있는데 가로채면 되부르기가 편의가 아니라 손해가 된다');
  assert.match(블록, /if \(되부름자리 === -1\) 쓰던글 = text\.value;/,
    '되부르기 전에 쓰던 글을 맡아 둬야 ↓ 로 돌아올 수 있다');
  assert.match(블록, /text\.value = 되부름자리 === -1 \? 쓰던글 : 말들\[되부름자리\];/,
    '맨 아래는 지난 발화가 아니라 **원래 쓰던 글**이어야 한다');
});

test('조합 중·수식키와 안 부딪힌다 — 한글 입력과 텍스트 편집을 안 깬다', () => {
  assert.match(블록, /if \(e\.metaKey \|\| e\.ctrlKey \|\| e\.altKey \|\| e\.shiftKey \|\| e\.isComposing\) return;/,
    '수식키 조합(선택·단어 이동)과 한글 조합 중에는 손대지 않는다');
});

test('되부를 것이 없으면 **아무 일도 안 한다** — 빈 칸을 만들지 않는다', () => {
  assert.match(블록, /if \(!말들\.length\) return;/, '보낸 말이 없으면 그냥 둔다');
  assert.match(블록, /if \(되부름자리 \+ 1 >= 말들\.length\) return;/,
    '더 거슬러 갈 것이 없을 때 빈 칸으로 떨어뜨리면 사람은 고장으로 읽는다');
});

// 새 저장소·새 서버 상태를 만들지 않는다(§규율). 화면이 이미 들고 있는 것을 읽는다.
test('발화 목록을 **새로 저장하지 않는다** — 화면에 있는 것을 읽는다', () => {
  assert.match(블록, /function 내가한말들\(\) \{ return \[\.\.\.document\.querySelectorAll\('\.msg\.me'\)\]/,
    '화면이 이미 진실을 들고 있다 — 따로 쌓으면 두 벌이 된다');
  assert.doesNotMatch(블록, /localStorage|sessionStorage|fetch\(/,
    '되부르기는 서버도 저장소도 안 건드린다');
  assert.match(블록, /\.reverse\(\)/, '최근 것부터 거슬러 올라가야 손버릇과 맞는다');
});

test('보내고 나면 처음으로 돌아간다 — 다음 ↑ 는 **방금 보낸 그 말**이다', () => {
  assert.match(블록, /send\.addEventListener\('click', \(\) => \{ 되부름자리 = -1; 쓰던글 = ''; \}\);/,
    '보낸 뒤에도 자리가 남아 있으면 다음 ↑ 가 엉뚱한 말을 올린다');
});
