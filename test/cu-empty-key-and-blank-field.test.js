// **빈 키는 누른 것이 아니다** + **빈 칸도 되돌릴 수 있는 칸이다.**
//
// 밟은 사실(라이브 2026-08-06 · F-42/F-44 확인 턴).
//   · 입력은 됐다 — 입력칸(y 711)에 `F42 자동 테스트` 가 들어갔다.
//   · 전송은 안 됐다 — 모델이 `press_key` 에 **`값: ""`** 를 보냈고, 손이 **그대로 보냈다.**
//     그러고도 *"했어요"* 가 나왔다. 아무 키도 안 눌렀는데 한 것이 됐다(A14 자리).
//   · 카드가 아직 2장이다 — **빈 입력칸은 `value` 가 `null`** 이라 탐침이 `값있음:false` 로
//     떨어지고, 미상은 승인으로 간다. 글자를 넣은 뒤에는 `value` 가 읽힌다(확인함).
//     칸이 비어 있다는 이유로 카드를 띄우는 건 **첫 입력마다 카드**라는 뜻이다.
//
// 되돌릴 수 있는지는 **역할이 말해 준다** — 글자를 넣는 칸은 지우면 돌아간다.
// 이건 문구로 재는 게 아니라(계열 E) 드라이버가 준 **AX 분류**를 쓰는 것이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';
import { toolActionKind } from '../src/kernel/l2-plan/action-plan.js';

const 빈칸 = {
  id: 's1:26', 토큰: 's1:26', 스냅샷: 's1', 번호: 26,
  role: 'AXTextArea', label: '메시지 입력', value: null, 창: 9, pid: 77, isEnabled: true,
};

const 손세우기 = (간것 = []) => makeDesktopActTool({
  drivers: [{
    id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
    observe: () => ({
      frontmost: { name: 'K' }, windows: [{ id: 9, pid: 77 }],
      본창: { id: 9, app: '카카오톡', title: '박종윤', pid: 77 }, elements: [빈칸],
    }),
    act: (요청) => { 간것.push(요청); return { ok: true, 확인됨: true, 근거: 'ok' }; },
  }],
});

// ── 빈 키 ────────────────────────────────────────────────────────────────
test('빈 키는 누르지 않는다 — 아무것도 안 하고 "했어요"가 되던 자리', async () => {
  const 간것 = [];
  const r = await 손세우기(간것).handler({ action: 'press_key', app: 'K', 값: '' });
  assert.equal(간것.length, 0, `**빈 키를 그대로 보냈다**: ${JSON.stringify(간것)}`);
  assert.equal(r.blocked, true);
});

test('어떤 키인지 말해 준다 — 모델이 고칠 수 있어야 한다', async () => {
  const r = await 손세우기().handler({ action: 'press_key', app: 'K', 값: '' });
  assert.match(JSON.stringify(r.다음수단 ?? []), /값/, `**막고 갈 곳을 안 준다**: ${JSON.stringify(r.다음수단)}`);
  assert.match(r.userSafeSummary, /키/, r.userSafeSummary);
});

test('단축키·메뉴도 빈 값이면 안 한다 — 같은 규율이다', async () => {
  for (const [행동, 값] of [['hotkey', ''], ['menu', []]]) {
    const 간것 = [];
    await 손세우기(간것).handler({ action: 행동, app: 'K', 값 });
    assert.equal(간것.length, 0, `**${행동} 이 빈 값으로 나갔다**`);
  }
});

// ── 빈 칸도 되돌릴 수 있다 ───────────────────────────────────────────────
test('빈 입력칸도 되돌릴 수 있는 칸이다 — 첫 입력마다 카드가 뜨면 안 된다', async () => {
  const 눌러본사실 = await 손세우기().probe({
    action: 'type', app: 'K', 대상: { id: 's1:26', label: '메시지 입력' },
  });
  assert.equal(눌러본사실?.찾음, true);
  assert.equal(
    toolActionKind({ toolId: 'desktop.act', args: { action: 'type', 눌러본사실 } }),
    'organize',
    `**빈 칸이라고 카드를 띄운다** — 첫 입력은 늘 카드가 된다: ${JSON.stringify(눌러본사실)}`,
  );
});

test('글자를 넣는 칸이 아니면 그대로 미상이다 — 규율이 안 느슨해진다', async () => {
  const 손 = makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({
        frontmost: { name: 'K' }, windows: [{ id: 9, pid: 77 }],
        본창: { id: 9, app: 'K', pid: 77 },
        elements: [{ id: 's1:7', 토큰: 's1:7', role: 'AXButton', label: '보내기', 창: 9, pid: 77, isEnabled: true }],
      }),
      act: () => ({ ok: true }),
    }],
  });
  const 눌러본사실 = await 손.probe({ action: 'click', app: 'K', 대상: { id: 's1:7', label: '보내기' } });
  assert.notEqual(
    toolActionKind({ toolId: 'desktop.act', args: { action: 'click', 눌러본사실 } }),
    'organize',
    '**값 없는 버튼이 카드 없이 눌린다**',
  );
});
