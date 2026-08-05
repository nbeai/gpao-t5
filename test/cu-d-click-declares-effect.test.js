// **CU D — 클릭·입력. 무엇이 바뀌면 된 것인지 모델이 먼저 말한다.**
//
// 닫는 문장(계획 §5): *"설정에서 다크 모드 켜줘"* → 켜지고 **AX value 로 확인한 뒤** 완료를 말한다.
//
// ── C 와 무엇이 다른가 ──────────────────────────────────────────────────
// C 의 넷은 **대조가 자명했다** — frontmost 값·스크롤 위치·창 좌표·프로세스 존재.
// 클릭은 아니다. **버튼을 누르면 무엇이 바뀌어야 하는지 커널은 모른다.**
// 그러면 A14(*"dispatch 성공, 화면 변화 없음 → 성공 영수증 0"*)를 잴 수가 없다.
//
// 두 갈래가 있었다:
//   ✗ 커널이 화면 글자를 읽고 "이건 저장 버튼이니 저장됐는지 보자"고 판정한다 → **심문**이다.
//     그리고 화면 글자는 남이 쓴 글이다(A10) — 그걸 근거로 판정하면 주입이 판정을 조종한다.
//   ✓ **모델이 기대 효과를 먼저 선언한다.** 커널은 그 선언을 **확인만** 한다.
//
// 두 번째가 정본 §5(*"클릭이 아니라 의미 효과를 판정한다"*)이고 §1.2 그대로다 —
// 무엇이 '됨'인지는 모델이 정하고, 커널은 사라지지 않게 하고 대조한다.
//
// ── A17 · 이름 없는 것은 안 누른다 ──────────────────────────────────────
// 반대시험 A17: *"unknown unlabeled coordinate button → 분류 전 클릭 0."*
// B 실측에서 창 하나에 요소 385개 중 **61개가 이름 없는 `"버튼"`** 이었다.
// 그걸 좌표로 누르면 **무엇을 눌렀는지 아무도 모른다** — 원장에 적을 것이 좌표뿐이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSlotRegistry } from '../src/kernel/l2-plan/slot-registry.js';
import { DESKTOP_SLOT, 화면슬롯세우기 } from '../src/runtime/desktop-slot.js';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';

const 다줌 = { accessibility: 'granted', screenRecording: 'denied' };

/** 클릭하면 지정한 요소의 값이 바뀌는 가짜 화면. `효과` 가 false 면 눌러도 아무 일 없다. */
function 백엔드({ 효과 = true, 요소 = [] } = {}) {
  let 현재 = 요소.map((e) => ({ ...e }));
  const 부른것 = [];
  return {
    id: '시험백엔드', needs: [], 부른것,
    async status() { return { permissions: 다줌, backend: { id: '시험', ready: true } }; },
    async observe() { return { frontmost: { name: 'System Settings' }, windows: [{ id: 1 }], elements: 현재.map((e) => ({ ...e })) }; },
    async act(요청) {
      부른것.push(요청);
      if (!효과) return { dispatched: true };
      const 표적 = 현재.find((e) => e.id === 요청?.대상?.id);
      if (표적) 표적.value = 표적.value === 'on' ? 'off' : 'on';
      return { dispatched: true };
    },
  };
}

const 손세우기 = (백) => {
  const 등록소 = 화면슬롯세우기(makeSlotRegistry());
  등록소.붙이기(DESKTOP_SLOT, 백);
  return makeDesktopActTool({ drivers: 등록소.드라이버(DESKTOP_SLOT) });
};

const 다크모드 = [{ id: 'SW1', type: 'checkbox', label: '다크 모드', value: 'off', bounds: {}, isEnabled: true }];

// ── 닫는 문장 ────────────────────────────────────────────────────────────
test('"다크 모드 켜줘" — 켜지고 값으로 확인한 뒤 완료를 말한다', async () => {
  const 백 = 백엔드({ 효과: true, 요소: 다크모드 });
  const out = await 손세우기(백).handler({
    action: 'click',
    대상: { id: 'SW1', label: '다크 모드' },
    기대: { 요소: 'SW1', 값: 'on' },
  });
  assert.equal(out.blocked, undefined, out.userSafeSummary);
  assert.equal(out.result.단계, 'goal_verified');
  assert.equal(out.result.후.값, 'on', '값으로 확인 안 하고 됐다고 했다');
});

// ── A14 · 눌렀는데 안 바뀌면 실패다 ──────────────────────────────────────
test('A14: 눌렀는데 기대한 값이 안 되면 성공이 아니다', async () => {
  const 백 = 백엔드({ 효과: false, 요소: 다크모드 });
  const out = await 손세우기(백).handler({
    action: 'click',
    대상: { id: 'SW1', label: '다크 모드' },
    기대: { 요소: 'SW1', 값: 'on' },
  });
  assert.equal(백.부른것.length, 1, '누르긴 했다(dispatched)');
  assert.equal(out.failed, true, '**눌렀는데 안 됐는데 됐다고 했다 — A14 가 뚫렸다**');
  assert.equal(out.진행?.단계, 'dispatched');
  assert.equal(out.진행?.후?.값, 'off', '전후를 실제로 찍었다는 증거');
});

// ── 기대 없이는 안 누른다 ────────────────────────────────────────────────
test('무엇이 바뀌면 된 것인지 안 말하면 **누르지 않는다**', async () => {
  const 백 = 백엔드({ 요소: 다크모드 });
  const out = await 손세우기(백).handler({ action: 'click', 대상: { id: 'SW1', label: '다크 모드' } });
  assert.equal(백.부른것.length, 0, '기대 효과 없이 눌렀다 — 됐는지 잴 방법이 없는 클릭이다');
  assert.equal(out.blocked, true);
  assert.match(out.userSafeSummary, /무엇이|확인/, '왜 안 눌렀는지가 사용자 문장에 없다');
});

// ── A17 · 이름 없는 것은 안 누른다 ───────────────────────────────────────
test('A17: 이름 없는 요소는 누르지 않는다 — 원장에 적을 것이 좌표뿐이다', async () => {
  const 백 = 백엔드({ 요소: [{ id: 'X9', type: 'button', label: '', value: 'off', bounds: { x: 12, y: 34 }, isEnabled: true }] });
  const out = await 손세우기(백).handler({
    action: 'click', 대상: { id: 'X9', label: '' }, 기대: { 요소: 'X9', 값: 'on' },
  });
  assert.equal(백.부른것.length, 0, '**이름 없는 것을 눌렀다** — 무엇을 눌렀는지 아무도 모른다');
  assert.equal(out.blocked, true);
  assert.ok(out.다음수단?.some((m) => m.방법 === 'observe'));
});

test('A17: 이름이 밋밋해도(`버튼`) 이름이 있으면 누른다 — 없는 벽을 만들지 않는다', async () => {
  const 백 = 백엔드({ 효과: true, 요소: [{ id: 'B7', type: 'button', label: '버튼', value: 'off', bounds: {}, isEnabled: true }] });
  const out = await 손세우기(백).handler({
    action: 'click', 대상: { id: 'B7', label: '버튼' }, 기대: { 요소: 'B7', 값: 'on' },
  });
  assert.equal(백.부른것.length, 1);
  assert.equal(out.result?.단계, 'goal_verified');
});

// ── D 는 무해 분류만 — 위험은 E 가 받는다 ─────────────────────────────────
//
// **커널이 화면 글자를 읽고 위험을 판정하지 않는다.** 그건 문구 목록이고 두 번 뚫린 길이며,
// 화면 글자는 남이 쓴 글이라(A10) 주입이 판정을 조종하게 된다.
// **모델이 자기 기대를 밝히고, 그 밝힌 것으로 갈린다.**
test('모델이 바깥으로 나간다고 밝히면 D 에서 안 받는다 — E 의 일이다', async () => {
  const 백 = 백엔드({ 효과: true, 요소: [{ id: 'S1', type: 'button', label: '보내기', value: 'off', bounds: {}, isEnabled: true }] });
  const out = await 손세우기(백).handler({
    action: 'click', 대상: { id: 'S1', label: '보내기' },
    기대: { 요소: 'S1', 값: 'on', 바깥으로: true },
  });
  assert.equal(백.부른것.length, 0, '바깥으로 나가는 것을 무해 칸에서 실행했다');
  assert.equal(out.blocked, true);
  assert.match(out.userSafeSummary, /아직|확인/);
});

// ── 입력도 같은 계약 ─────────────────────────────────────────────────────
test('입력도 기대를 밝혀야 한다 — 그리고 값으로 확인한다', async () => {
  const 백 = 백엔드({ 효과: true, 요소: [{ id: 'T1', type: 'textField', label: '검색', value: 'off', bounds: {}, isEnabled: true }] });
  const out = await 손세우기(백).handler({
    action: 'type', 대상: { id: 'T1', label: '검색' }, 값: '안녕', 기대: { 요소: 'T1', 값: 'on' },
  });
  assert.equal(out.result?.단계, 'goal_verified');
});

test('A09 가 입력에도 산다 — 비밀칸에는 D 에서 입력하지 않는다', async () => {
  const 백 = 백엔드({ 효과: true, 요소: [{ id: 'P1', type: 'textField', label: '비밀번호', role: 'AXSecureTextField', value: 'off', bounds: {}, isEnabled: true }] });
  const out = await 손세우기(백).handler({
    action: 'type', 대상: { id: 'P1', label: '비밀번호', 비밀칸: true }, 값: 'hunter2', 기대: { 요소: 'P1', 값: 'on' },
  });
  assert.equal(백.부른것.length, 0, '**비밀칸에 값을 넣었다** — 비밀은 사람만 넣는다(헌장 ①)');
  assert.equal(out.blocked, true);
  assert.ok(!JSON.stringify(out).includes('hunter2'), '거절하면서 값을 실어 보냈다');
});

// ── C 에서 세운 것이 D 에서도 산다 ────────────────────────────────────────
test('A04 는 클릭에서도 문다 — 지문이 다르면 안 누른다', async () => {
  const 백 = 백엔드({ 요소: 다크모드 });
  const out = await 손세우기(백).handler({
    action: 'click', 대상: { id: 'SW1', label: '다크 모드', 지문: 'aaa' }, 확인지문: 'bbb',
    기대: { 요소: 'SW1', 값: 'on' },
  });
  assert.equal(백.부른것.length, 0);
  assert.equal(out.blocked, true);
});
