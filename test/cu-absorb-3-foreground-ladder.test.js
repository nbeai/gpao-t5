// **흡수 ③ · 드라이버가 알려준 사다리 — 걷었다.**
//
// ── 예전 판단 (2026-08-06) ──────────────────────────────────────────────
// 오너: *"사용자가 지시하면 **알아서 자동으로** 그것들을 수행해야 당연한 거잖아."*
// 드라이버가 *"앞으로 가져오면 볼 수 있다"* 고 알려주는데 우리가 안 해서, T5 는 정직하지만
// 일을 못 끝냈다. 그래서 **커널이 자동으로 앞세우고 이전 앱으로 되돌리게** 했다.
//
// ── 뒤집힌 이유 (2026-08-07 · PM 조건 2) ────────────────────────────────
// 벤더 사용설명서를 그때는 못 읽었다. `SKILL.md` 가 못박는다 —
//   *"An optional escalation is a **harness instruction, never an automatic retry**."*
// 그리고 `bring_to_front` 설명서 — *"**This DOES steal foreground**."*
//
// 우리는 신호를 보고 **커널이 자동으로** 올렸다. 되돌리기까지 넣었지만 그건 뺏은 뒤의 수습이고,
// 실측에서 `앞세움: true` 가 매번 나왔다. 오너가 오늘 말했다 —
// *"내가 컴퓨터로 작업중이라 카톡 화면을 앞으로 내세워도 나 때문에 뒤로 밀린다."*
// **우리가 그 화면을 계속 뺏고 있었다.**
//
// **자동을 버린 게 아니다.** 오너 규율은 그대로다 — 다만 **화면을 뺏을지 정하는 것은
// 커널이 아니라 모델**이다. `올려야할길`(escalation)은 사실로 계속 실리고, 모델이 필요하면
// 손으로 올린다. 그리고 걷어도 되는 이유가 생겼다 — **그림 배선이 섰다**(`1cf79eb`).
// 트리가 비어도 드라이버가 *"the screenshot IS the requested window"* 라고 말하고
// 그 그림이 모델까지 간다. 계산기를 다른 Space 에서 3/3 읽은 그 길이다.
//
// 이 파일은 **뒤집힌 판단의 기록**으로 남긴다 — 지우면 다음 사람이 같은 길로 간다.
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
      if (이름 === 'bring_to_front') { 앞세웠나 = true; return { effect: 'confirmed', code: 'ok' }; }
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

test('신호가 와도 커널이 화면을 안 뺏는다 — escalation 은 지시이지 자동 재시도가 아니다', async () => {
  const 부른것 = [];
  const o = await makeCuaDriver({ mcp: 가짜(부른것) }).observe({ scope: 'window', app: '메모' });
  assert.equal(부른것.some((c) => c.이름 === 'bring_to_front'), false,
    '**사용자 화면을 뺏는다** — `This DOES steal foreground`');
  assert.ok(o, '관찰 자체는 돌아야 한다');
});

test('그 신호는 사실로 남긴다 — 버리면 모델이 올릴 길을 잃는다', async () => {
  const o = await makeCuaDriver({ mcp: 가짜([]) }).observe({ scope: 'window', app: '메모' });
  assert.equal(o.올려야할길?.recommended, 'foreground',
    `**드라이버가 준 지시를 버린다**: ${JSON.stringify(o.올려야할길)}`);
});

test('안 올렸으면 올렸다고 하지 않는다 — 안 만진 화면을 만졌다고 적지 않는다', async () => {
  const o = await makeCuaDriver({ mcp: 가짜([]) }).observe({ scope: 'window', app: '메모' });
  assert.equal(o.앞세워읽음, undefined, `화면을 안 만졌는데 만졌다고 한다: ${o.앞세워읽음}`);
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
