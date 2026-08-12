// **손마다 따로 조립하니 계속 빠진다** — 그 계열을 여기서 끝낸다.
//
// 오늘 하루에 세 번 났다(2026-08-06):
//   `scroll`     창·pid·자리 없음 → `same_pid_keyboard_ambiguity` 로 거절
//   `type_text`  창·pid 없음      → 앞 창에 친다
//   `set_value`  pid 없음         → *"Missing required integer field: pid"*
// 마지막 것이 오너의 ④ 를 막았다. 손은 입력칸을 정확히 짚고도 *"실행하지 못했어요"* 로 끝냈다.
//
// 하나씩 고치면 **다음에 손을 하나 더 붙일 때 또 난다.** 그래서 인자를 손마다 조립하지 않고
// **창 신분을 한 자리에서 붙인다.** 이 검사는 표를 훑으므로 새 손이 늘면 여기서 걸린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';

const 창 = { window_id: 9, app_name: 'K', title: 'k', pid: 77, is_on_screen: true, z_index: 1,
  bounds: { x: 0, y: 0, width: 100, height: 100 } };

/** 요소나 창을 대상으로 하는 손 — 여기 있는 것은 **전부** 창 신분을 실어야 한다. */
const 창대상손 = [
  ['click', {}], ['double_click', {}], ['right_click', {}], ['set_value', { 값: 'x' }],
  ['type', { 값: 'x' }], ['press_key', { 값: 'return' }], ['hotkey', { 값: 'cmd+s' }],
  ['menu', { 값: ['파일'] }], ['drag', { 값: { to_x: 1, to_y: 2 } }], ['scroll', { 값: 'up' }],
  ['paste', { 값: 'x' }],
];

test('요소·창을 다루는 손은 하나도 빠짐없이 창과 pid 를 싣는다', async () => {
  const 빠진것 = [];
  for (const [행동, 더] of 창대상손) {
    const 부른것 = [];
    const mcp = {
      async call(이름, 인자) {
        부른것.push({ 이름, 인자 });
        if (이름 === 'list_windows') return { windows: [창] };
        if (이름 === 'get_accessibility_tree') return { windows: [] };
        if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: [] };
        if (이름 === 'clipboard_read') return { text: '' };
        return { ok: true };
      },
    };
    await makeCuaDriver({ mcp }).act({
      행동, 대상: { 토큰: 's1:1', 스냅샷: 's1', 창: 9, pid: 77, bounds: { x: 0, y: 0, w: 10, h: 10 } }, ...더,
    }).catch(() => {});
    // 마지막 호출이 그 손이다(앞의 것들은 창 찾기).
    const 쓴것 = 부른것.filter((c) => !['list_windows', 'get_accessibility_tree', 'get_window_state', 'list_apps'].includes(c.이름));
    const 마지막 = 쓴것[쓴것.length - 1];
    if (!마지막) { 빠진것.push(`${행동}(안 불렀다)`); continue; }
    if (마지막.인자?.pid !== 77) 빠진것.push(`${행동}→${마지막.이름}(pid 없음)`);
    else if (마지막.인자?.window_id !== 9) 빠진것.push(`${행동}→${마지막.이름}(창 없음)`);
  }
  assert.deepEqual(빠진것, [],
    `**이 손들은 어느 창인지 안 들고 간다** — 드라이버가 거절하거나 남의 창에 한다: ${빠진것.join(' · ')}`);
});
