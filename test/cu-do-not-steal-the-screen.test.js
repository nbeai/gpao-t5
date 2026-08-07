// **사용자 화면을 커널이 뺏지 않는다.**
//
// PM 조건 2번(2026-08-07 · CU 닫는 조건): *"우리가 만든 앞세우기 사다리를 걷었는가.
// 벤더 계약은 「돌아온 신호에 반응하라, 예측으로 올리지 마라」인데 지금 코드는 아직
// 우리가 짐작해서 올린다. 오늘은 안 터졌지만 지뢰다."*
//
// `SKILL.md` 원문: *"An optional escalation is a **harness instruction, never an automatic
// retry**."* 그리고 `bring_to_front` 설명서: *"**This DOES steal foreground**."*
//
// 오너가 오늘 말했다 — *"내가 컴퓨터로 작업중이라 카톡 화면을 앞으로 내세워도 나 때문에
// 뒤로 밀린다."* 우리가 그 화면을 계속 뺏고 있었다. 실측에서 `앞세움: true` 가 매번 나왔다.
//
// **걷어도 되는 이유**: 그림 배선이 섰다(`1cf79eb`). 접근성 트리가 창을 못 잡아도
// 드라이버가 *"the screenshot in this response IS the requested window"* 라고 말하고,
// 이제 그 그림이 모델까지 간다 — 오늘 계산기를 다른 Space 에서 3/3 읽은 그 길이다.
//
// **자동을 버리는 게 아니다.** 오너 규율은 *"사용자가 지시하면 알아서 자동으로"* 이고
// 그건 그대로다 — 다만 **화면을 뺏을지 정하는 것은 커널이 아니라 모델**이다.
// `올려야할길` 은 사실로 계속 실린다. 모델이 필요하면 `desktop.act` 로 올린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';

const 창 = {
  window_id: 9, app_name: '카카오톡', title: 'TNT', pid: 77,
  is_on_screen: true, z_index: 5, bounds: { x: 0, y: 0, width: 454, height: 773 },
};

function 가짜(부른것 = []) {
  return {
    부른것,
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [창] };
      if (이름 === 'list_apps') return { apps: [{ name: '카카오톡', pid: 77, running: true }] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') {
        return {
          snapshot_id: 's1', elements: [], degraded: true,
          degraded_reason: 'ax_window_unresolved',
          // 드라이버가 "앞으로 가져오면 된다"고 말하는 바로 그 상황.
          escalation: { reason: 'observation-only …', recommended: 'foreground' },
        };
      }
      return {};
    },
    async 조각들() { return [{ type: 'image', data: 'x'.repeat(1200) }]; },
    async 구조와조각(이름, 인자) {
      return { 구조: await this.call(이름, 인자), 조각: [{ type: 'image', data: 'x'.repeat(1200) }] };
    },
  };
}

test('드라이버가 "앞으로 가져오라"고 해도 커널이 뺏지 않는다 — 사용자가 쓰던 화면이다', async () => {
  const mcp = 가짜();
  await makeCuaDriver({ mcp }).observe({ scope: 'window', app: '카카오톡' });
  assert.equal(mcp.부른것.some((c) => c.이름 === 'bring_to_front'), false,
    '**사용자 화면을 뺏는다** — `This DOES steal foreground` 이고, 지시가 아니라 자동 재시도다');
});

test('그 신호는 사실로 남긴다 — 버리면 모델이 올릴 길을 잃는다', async () => {
  const o = await makeCuaDriver({ mcp: 가짜() }).observe({ scope: 'window', app: '카카오톡' });
  assert.equal(o.올려야할길?.recommended, 'foreground',
    `**드라이버가 준 지시를 버린다**: ${JSON.stringify(o.올려야할길)}`);
});

test('트리가 비어도 그림으로 읽는다 — 뺏지 않고도 볼 수 있다', async () => {
  const o = await makeCuaDriver({ mcp: 가짜() }).observe({ scope: 'window', app: '카카오톡' });
  assert.ok(o.그림, '**그림도 없으면 진짜로 못 읽는다** — 그때만 올리는 것이 맞다');
  assert.equal(o.앞세워읽음, undefined, `안 올렸으면 올렸다고 하지 않는다: ${o.앞세워읽음}`);
});
