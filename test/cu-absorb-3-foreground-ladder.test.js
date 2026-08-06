// **흡수 ③ · 드라이버가 알려준 사다리를 실제로 탄다.**
//
// 오너: *"사용자가 지시하면 **알아서 자동으로** 그것들을 수행해야 당연한 거잖아."*
//
// 지금은 드라이버가 *"앞으로 가져오면 볼 수 있다"* 고 알려주는데 **우리가 안 한다.**
// 그래서 T5 는 정직하지만 **일을 못 끝낸다** — 사용자는 "읽어줘"라고 했는데
// "못 읽었어요"만 듣는다.
//
// 비교군 계약(`schema.py`):
//   `delivery_mode: background`(기본) → 안 들어갔다는 **신호가 오면** `foreground`.
//   *"Electron 이라고 **예측하지 마라. 신호에 반응하라.**"*
//   `bring_to_front: false` 면 **행동 뒤 이전 앱으로 되돌린다** — 깜빡임만 남고 화면은 그대로.
//
// 그래서 읽기도 같은 사다리다:
//   배경으로 읽어 본다 → `escalation.recommended: 'foreground'` 가 오면
//   **잠깐 앞세워 읽고 이전 앱으로 되돌린다.** 그리고 그렇게 했다는 **사실을 남긴다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';

const 창 = {
  window_id: 9, app_name: '메모', title: '메모', pid: 77,
  is_on_screen: true, z_index: 1, bounds: { x: 5, y: 74, width: 868, height: 818 },
};

function 가짜({ 부른것 = [], 앞세우면읽힘 = true } = {}) {
  let 앞세웠나 = false;
  return {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [창] };
      if (이름 === 'get_accessibility_tree') return { windows: [], apps: [{ name: 'Claude', pid: 1, active: true }] };
      if (이름 === 'bring_to_front') { 앞세웠나 = true; return { activated: true, code: 'ok' }; }
      if (이름 === 'get_window_state') {
        if (앞세웠나 && 앞세우면읽힘) {
          return { snapshot_id: 's2', elements: [{ element_token: 's2:1', role: 'AXTextArea', value: '오늘 할 일' }] };
        }
        return {
          elements: [], degraded: true,
          degraded_reason: 'ax_window_unresolved: the tree is returned EMPTY on purpose',
          escalation: { recommended: 'foreground', reason: 'background refused while AX unresolved' },
        };
      }
      return {};
    },
  };
}

test('배경으로 못 읽으면 잠깐 앞세워 읽는다 — 사용자는 "읽어줘"라고 했다', async () => {
  const 부른것 = [];
  const o = await makeCuaDriver({ mcp: 가짜({ 부른것 }) }).observe({ scope: 'window', app: '메모' });
  assert.equal((o.elements ?? []).length, 1,
    `**알려준 길을 안 간다** — 정직하지만 일을 못 끝낸다: ${JSON.stringify(o).slice(0, 200)}`);
  assert.ok(부른것.some((c) => c.이름 === 'bring_to_front'), '앞세우지 않았다');
});

test('읽고 나서 이전 앱으로 되돌린다 — 화면을 뺏은 채 두지 않는다', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜({ 부른것 }) }).observe({ scope: 'window', app: '메모' });
  const 앞세우기들 = 부른것.filter((c) => c.이름 === 'bring_to_front');
  assert.equal(앞세우기들.length, 2, `**앞세운 채 두고 나온다** — 사용자 화면이 바뀐다: ${앞세우기들.length}번`);
  assert.equal(앞세우기들[1].인자.pid, 1, '이전 앱으로 안 되돌렸다');
});

test('그렇게 했다는 사실을 남긴다 — 조용히 화면을 만지지 않는다', async () => {
  const o = await makeCuaDriver({ mcp: 가짜({}) }).observe({ scope: 'window', app: '메모' });
  assert.equal(o.앞세워읽음, true, `화면을 만졌는데 말이 없다: ${JSON.stringify(o).slice(0, 160)}`);
});

test('앞세워도 못 읽으면 이유를 그대로 남긴다 — 무한히 시도하지 않는다', async () => {
  const 부른것 = [];
  const o = await makeCuaDriver({ mcp: 가짜({ 부른것, 앞세우면읽힘: false }) }).observe({ scope: 'window', app: '메모' });
  assert.equal((o.elements ?? []).length, 0);
  assert.match(String(o.못읽은이유 ?? ''), /ax_window_unresolved/);
  assert.ok(부른것.filter((c) => c.이름 === 'get_window_state').length <= 2, '계속 다시 읽는다');
});

test('배경으로 읽히면 앞세우지 않는다 — 안 뺏는 것이 기본이다', async () => {
  const 부른것 = [];
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [창] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: [{ element_token: 's1:1', role: 'AXTextArea', value: 'ok' }] };
      return {};
    },
  };
  await makeCuaDriver({ mcp }).observe({ scope: 'window', app: '메모' });
  assert.equal(부른것.some((c) => c.이름 === 'bring_to_front'), false,
    '**잘 읽히는데 화면을 뺏었다**');
});
