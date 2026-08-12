// **읽은 것이 모델에게 가야 읽은 것이다.**
//
// 오너 지적(2026-08-06): *"컴퓨터 유즈라는데 기본인 읽기조차 안 되는데 어떻게 컴퓨터
// 유즈가 되지?"* — 맞다. 손은 카톡 대화 65개를 읽었는데 모델은 못 받았고,
// T5 는 *"메시지 내용은 안 넘어오고 있어요"* 라고 답했다. **그 말이 정확했다.**
//
// 뿌리(계측기로 확정): `compactResult` 에 **화면 갈래가 없다.** 웹·파일·이동은 전용
// 갈래가 있는데 화면만 없어서, 마지막 줄의 `JSON.stringify(result)` → **1,200자 접기**로
// 떨어진다. 화면 결과는 `{frontmost, windows[…], elements[65], …}` 라 앞쪽 창 목록에서
// 예산이 다 차고 **요소는 통째로 잘린다.**
//
// 그래서 규칙은 하나다: **읽기 결과는 글자가 알맹이다.**
// 좌표·지문·창·pid 같은 기계 값은 누를 때나 필요하다. 읽을 때는 **글자와 토큰**만 남기면
// 같은 예산에 몇 배가 들어간다. 그리고 몇 개 중 몇 개인지, 끝쪽으로 가는 길도 함께.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactResult } from '../src/kernel/l1-intent/task-context.js';

/** 실물 모양 그대로 — 요소마다 기계 값이 잔뜩 붙어 온다. */
const 요소 = (i, 글) => ({
  id: `s1:${i}`, 번호: i, 토큰: `s1:${i}`, 스냅샷: 's1',
  type: 'AXTextArea', role: 'AXTextArea', subrole: null,
  label: '', value: 글, bounds: { x: 120, y: 100 + i * 40, w: 300, h: 36 },
  isEnabled: true, 창: 13756, pid: 4340, 지문: 'a1b2c3d4e5f6',
});

const 화면결과 = (개수 = 65) => ({
  frontmost: { name: 'Claude', bundleId: 'com.anthropic.claudefordesktop', pid: 650 },
  windows: Array.from({ length: 25 }, (_, i) => ({ id: 1000 + i, title: `창${i}`, app: `앱${i}`, pid: 100 + i })),
  본창: { id: 13756, app: '카카오톡', title: '정영현', bounds: { x: 93, y: 60, w: 380, h: 675 } },
  elements: Array.from({ length: 개수 }, (_, i) => 요소(i, `메시지${i}`)),
  요소창: { 시작: 0, 끝: 개수, 총: 개수, 순서: '화면 위에서 아래로' },
  권한확인됨: true, 관찰내용은데이터: true,
});

test('창 안 글자가 모델에게 간다 — 이게 안 되면 읽기가 아니다', () => {
  const 간것 = compactResult(화면결과());
  assert.ok(간것, '결과가 통째로 사라졌다');
  assert.ok(간것.includes('메시지0'), `**첫 메시지도 안 간다**: ${String(간것).slice(0, 160)}`);
  assert.ok(간것.includes('메시지64'), `**마지막 메시지가 안 간다** — "마지막 메세지 봐줘"가 영영 안 된다`);
});

test('기계 값이 예산을 먹지 않는다 — 좌표·지문·pid 는 읽을 때 필요 없다', () => {
  const 간것 = String(compactResult(화면결과()));
  assert.equal(간것.includes('a1b2c3d4e5f6'), false, '지문이 예산을 먹는다');
  assert.equal(간것.includes('bundleId'), false, '기계 값이 그대로 실린다');
  assert.equal(/"pid"|"bounds"/.test(간것), false, `좌표·pid 가 실린다: ${간것.slice(0, 200)}`);
});

test('누를 수 있게 토큰은 남긴다 — 읽고 나서 누르는 것이 다음 걸음이다', () => {
  const 간것 = String(compactResult(화면결과(3)));
  assert.ok(간것.includes('s1:0'), `**토큰이 없다** — 읽고도 못 누른다: ${간것.slice(0, 200)}`);
});

test('무엇을 봤는지 함께 간다 — 어느 창인지 모르면 답을 못 쓴다', () => {
  const 간것 = String(compactResult(화면결과(3)));
  assert.match(간것, /정영현|카카오톡/, '본 창이 무엇인지 안 간다');
});

test('많으면 몇 개 중 몇 개인지 말한다 — 조용히 자르지 않는다', () => {
  const 간것 = String(compactResult(화면결과(600)));
  assert.match(간것, /600/, `**전체 개수를 안 말한다** — 모델이 그게 전부인 줄 안다: ${간것.slice(-200)}`);
});

test('창 목록만 있는 결과도 그대로 간다 — 있던 길을 안 막는다', () => {
  const 간것 = String(compactResult({
    frontmost: { name: '카카오톡' },
    windows: [{ id: 1, title: '정영현', app: '카카오톡' }],
  }));
  assert.match(간것, /정영현/);
});
