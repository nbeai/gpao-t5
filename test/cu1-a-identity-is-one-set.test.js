// **CU-1 계열 A · 신분은 한 벌로만 만든다.**
//
// 오늘 최다 결함 계열이다(2026-08-05~06, 세 번). 셋 다 같은 모양이었다 —
// **조각을 여러 자리에서 따로 집었다.** 토큰은 모델이 준 것, 스냅샷은 방금 본 것,
// pid 는 또 다른 관찰에서. 회차가 어긋나면 **드라이버는 아무 데도 안 누르면서
// `unverifiable` 을 돌려주고**, 우리 눈에는 "보냈다"로 보인다.
// 사진으로만 잡혔다: 화면은 `14` 그대로인데 T5 는 *"했어요"* 라고 했다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 신분, 신분찾기, 짝이맞나 } from '../src/runtime/desktop-identity.js';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';

const 요소 = (회차) => ({
  id: 'b3', 토큰: `s${회차}:3`, 스냅샷: `s${회차}`, 번호: 3,
  role: 'AXButton', label: '3', isEnabled: true, 창: 9, pid: 77,
});

// ── ① 한 벌은 한 요소에서만 나온다 ───────────────────────────────────────
test('신분은 요소 하나에서 통째로 나온다 — 조각을 섞지 않는다', () => {
  const s = 신분(요소(2));
  assert.deepEqual(s, { 토큰: 's2:3', 번호: 3, 스냅샷: 's2', 창: 9, pid: 77 });
  assert.equal(짝이맞나(s), true);
});

test('토큰과 스냅샷이 다른 회차면 짝이 아니다 — 그게 아무 데도 안 눌리는 이유였다', () => {
  assert.equal(짝이맞나({ 토큰: 's1:3', 스냅샷: 's2' }), false);
  assert.equal(짝이맞나({ 토큰: 's2:3', 스냅샷: 's2' }), true);
});

test('없는 신분은 지어내지 않는다', () => {
  assert.equal(신분(null), null);
  assert.equal(신분찾기(null, { 토큰: 'x' }), null);
  assert.equal(신분찾기([요소(1)], { 토큰: '없는것' }), null);
});

test('가리키는 축 셋 — 토큰·id·라벨', () => {
  const 들 = [요소(1)];
  assert.equal(신분찾기(들, { 토큰: 's1:3' })?.id, 'b3');
  assert.equal(신분찾기(들, { id: 'b3' })?.id, 'b3');
  assert.equal(신분찾기(들, { label: '3' })?.id, 'b3');
});

// ── ② 손은 조각을 직접 집지 않는다 ───────────────────────────────────────
test('손은 마지막으로 본 요소의 신분을 통째로 쓴다 — 모델이 준 조각을 안 섞는다', async () => {
  let 회차 = 0;
  const 넘긴것 = [];
  const 손 = makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => { 회차 += 1; return { frontmost: { name: 'X' }, windows: [{ id: 9, pid: 77 }], elements: [요소(회차)] }; },
      act: (요청) => { 넘긴것.push({ ...요청.대상, 회차 }); return { delivery: { mode: 'background' }, effect: 'unverifiable' }; },
      verify: async () => ({ 판정: 'unknown' }),
    }],
  });
  // 모델은 **앞 회차** 토큰을 들고 온다 — 실물이 그렇다.
  await 손.handler({ action: 'click', 대상: { id: 'b3', label: '3', 토큰: 's0:3' } });
  const 쓴것 = 넘긴것[0] ?? {};
  assert.equal(짝이맞나(쓴것), true, `**조각이 섞였다** — 아무 데도 안 눌린다: ${JSON.stringify(쓴것)}`);
  assert.equal(쓴것.토큰, `s${쓴것.회차}:3`, `마지막으로 본 회차가 아니다: ${JSON.stringify(쓴것)}`);
  assert.notEqual(쓴것.토큰, 's0:3', '모델이 준 낡은 토큰을 그대로 썼다');
});

test('마지막 관찰에 그 요소가 없으면 모델 것을 쓰되 조각을 안 섞는다', async () => {
  const 넘긴것 = [];
  const 손 = makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({ frontmost: { name: 'X' }, windows: [{ id: 9 }], elements: [] }),
      act: (요청) => { 넘긴것.push(요청.대상); return { effect: 'unverifiable' }; },
      verify: async () => ({ 판정: 'unknown' }),
    }],
  });
  await 손.handler({ action: 'click', 대상: { id: 'b3', label: '3', 토큰: 's0:3', 스냅샷: 's0' } });
  const 쓴것 = 넘긴것[0] ?? {};
  assert.equal(짝이맞나(쓴것), true, `**못 찾았는데 새 스냅샷을 붙였다**: ${JSON.stringify(쓴것)}`);
});
