// **읽기에는 사다리를 태웠는데 행동에는 안 태웠다.**
//
// 밟은 사실(라이브 2026-08-06 · 오너의 ④ 마지막 칸). 입력칸에 글자는 들어갔는데
// Enter 가 안 갔다. 드라이버는 거절하면서 **길을 함께 줬다**:
//
//   `code: same_pid_keyboard_ambiguity` · `effect: refused`
//   *"pid 4340 owns 6 other eligible top-level window(s); process-scoped key events cannot be
//    proven to reach window 14963 and could mutate a sibling window.
//    Use an exact element action … or **delivery_mode:"foreground"**."*
//
// 옳은 거절이다 — 형제 창을 건드릴 수 있으니 안 한 것이다. 그리고 **푸는 법도 말했다.**
// 우리는 `observe` 에서만 그 사다리를 탔다(흡수 ③). 행동에서는 안 타서
// T5 가 *"키보드 입력이 막혀 있어서"* 라고 답하고 사용자에게 떠넘겼다 — 막힌 적이 없다.
//
// 규율은 읽기와 같다: **잠깐 앞세우고, 하고, 이전 앱으로 되돌린다**(계열 G).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';

const 창 = { window_id: 9, app_name: 'K', title: 'k', pid: 77, is_on_screen: true, z_index: 1,
  bounds: { x: 0, y: 0, width: 100, height: 100 } };

function 가짜({ 부른것 = [], 앞세우면됨 = true } = {}) {
  let 앞세웠나 = false;
  return {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [창] };
      if (이름 === 'get_accessibility_tree') return { windows: [], apps: [{ name: 'Claude', pid: 1, active: true }] };
      if (이름 === 'bring_to_front') { 앞세웠나 = true; return { effect: 'confirmed' }; }
      if (이름 === 'press_key') {
        if (인자?.delivery_mode === 'foreground' && 앞세우면됨) return { effect: 'confirmed', route: 'foreground' };
        return {
          effect: 'refused', code: 'same_pid_keyboard_ambiguity',
          // **실물이 준 그대로다**(2026-08-06). `recommended` 는 `accessibility` 인데
          // 정작 길은 `reason` 에 적혀 있다 — *"or delivery_mode:\"foreground\""*.
          // 그래서 **문구를 읽어 고르지 않는다**(계열 E). 구조로 잰다:
          // **거절이고 사다리가 딸려 왔으면, 우리가 가진 마지막 수단으로 한 번 더.**
          escalation: { recommended: 'accessibility', reason: 'pid owns 6 other eligible top-level window(s) … or delivery_mode:"foreground"' },
        };
      }
      return { ok: true };
    },
  };
}

test('거절이 길을 함께 주면 그 길로 간다 — "막혀 있어서"라고 답하지 않는다', async () => {
  const 부른것 = [];
  const r = await makeCuaDriver({ mcp: 가짜({ 부른것 }) })
    .act({ 행동: 'press_key', 대상: { 창: 9, pid: 77 }, 값: 'Enter' })
    .catch((e) => ({ 오류: String(e.message) }));
  assert.equal(r?.효과 ?? r?.effect, 'confirmed',
    `**알려준 길을 안 간다** — 사용자는 "막혔다"만 듣는다: ${JSON.stringify(r).slice(0, 200)}`);
  const 다시 = 부른것.filter((c) => c.이름 === 'press_key');
  assert.equal(다시.length, 2, `한 번만 해 보고 포기했다: ${다시.length}`);
  assert.equal(다시[1].인자.delivery_mode, 'foreground');
});

test('앞세우고 하고 되돌린다 — 사용자 화면을 뺏은 채 두지 않는다', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜({ 부른것 }) })
    .act({ 행동: 'press_key', 대상: { 창: 9, pid: 77 }, 값: 'Enter' }).catch(() => {});
  const 앞세우기 = 부른것.filter((c) => c.이름 === 'bring_to_front');
  assert.equal(앞세우기.length, 2, `**앞세운 채 두고 나온다**: ${앞세우기.length}번`);
  assert.equal(앞세우기[1].인자.pid, 1, '이전 앱으로 안 되돌렸다');
});

test('그렇게 했다는 사실을 남긴다 — 조용히 화면을 만지지 않는다', async () => {
  const r = await makeCuaDriver({ mcp: 가짜({}) })
    .act({ 행동: 'press_key', 대상: { 창: 9, pid: 77 }, 값: 'Enter' }).catch(() => null);
  assert.equal(r?.앞세워함, true, `화면을 만졌는데 말이 없다: ${JSON.stringify(r).slice(0, 200)}`);
});

test('앞세워도 안 되면 거절 그대로다 — 무한히 시도하지 않는다', async () => {
  const 부른것 = [];
  const r = await makeCuaDriver({ mcp: 가짜({ 부른것, 앞세우면됨: false }) })
    .act({ 행동: 'press_key', 대상: { 창: 9, pid: 77 }, 값: 'Enter' });
  // 계약 이행(F-53 2026-08-09): 거절은 던지지 않고 네 갈래로 돌아온다 — "안 됐는데 됐다"는
  // effect:'refused' 가 막는다(거절인가가 참인 것은 결과로 읽히지 않는다).
  assert.equal(r?.effect, 'refused', `안 됐는데 됐다고 한다: ${JSON.stringify(r).slice(0, 120)}`);
  assert.ok(부른것.filter((c) => c.이름 === 'press_key').length <= 2, '계속 다시 시도한다');
});
