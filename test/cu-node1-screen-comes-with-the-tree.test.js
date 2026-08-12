// **노드 ① — "화면에 지금 뭐라고 나와 있는지 읽어줘"**
//
// 라이브 3회 0/3(PM 측정). 세 번 다 정직하게 *"못 읽는다"* 고 답했다 — 떠넘김도 거짓 성공도
// 없었다. 그런데 **못 읽은 것이 사실이 아니다.** 계산기는 AX 도 살아 있고(요소 152개)
// 그림도 함께 온다(실측 2026-08-06: `조각들('get_window_state')` **928ms → 111,056B**).
//
// 기계 사실 — 인자가 아니라 **수신**이 문제였다:
//   `call`(:102)  `structuredContent` 만 집고 **`content` 를 버린다**
//   `조각들`(:108) 바로 그 목적으로 이미 있다 — *"잘라 버리면 있는 것을 없다고 하게 된다"*
//   `verify_state` 만 그걸 쓰고, `get_window_state` 셋(:368·:377·:410)은 `call` 을 쓴다
//
// 그리고 `include_screenshot` 기본값이 `true` 라, 우리는 **화면을 찍는 비용을 내고 버리고**
// 있었다. 계약이 그 최적화를 명시한다 — *"Set false to skip the grab … the cheap path
// when you're just re-indexing before an element ax action."*
//
// 그래서 갈래가 둘이다:
//   **읽어 달라는 요청** → 그림을 함께 준다(모델이 화면에 찍힌 값을 읽는다)
//   **행동 전 재관찰**   → `include_screenshot: false`(신분만 다시 잡는다 · 그랩 비용 0)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';

const 창 = { window_id: 9, app_name: '계산기', title: '계산기', pid: 77, is_on_screen: true, z_index: 1,
  bounds: { x: 0, y: 0, width: 230, height: 408 } };
// 계산기는 AX 가 살아 있다 — 버튼은 나오는데 **표시창 값이 트리에 없다**(F-35).
const 요소들 = [
  { element_token: 's1:1', element_index: 1, role: 'AXButton', label: '1', frame: {} },
  { element_token: 's1:2', element_index: 2, role: 'AXButton', label: '더하기', frame: {} },
];

function 가짜(부른것 = []) {
  return {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [창] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: 요소들 };
      return {};
    },
    async 조각들(이름, 인자) {
      부른것.push({ 이름, 인자, 조각: true });
      return [{ type: 'text', text: 'tree' }, { type: 'image', mimeType: 'image/png', data: 'Q'.repeat(2000) }];
    },
    // 실물(`makeMcpStdio`)이 내는 그대로 — 한 번 부르고 구조와 조각을 함께 준다.
    async 구조와조각(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 !== 'get_window_state') return { 구조: {}, 조각: [] };
      return {
        구조: { snapshot_id: 's1', elements: 요소들 },
        조각: [{ type: 'text', text: 'tree' }, { type: 'image', mimeType: 'image/png', data: 'Q'.repeat(2000) }],
      };
    },
  };
}

test('읽어 달라는 요청에는 트리와 그림이 함께 온다 — 계약이 "둘 다에 근거를 두라"고 한다', async () => {
  const 부른것 = [];
  const o = await makeCuaDriver({ mcp: 가짜(부른것) }).observe({ scope: 'window', app: '계산기' });
  assert.equal((o.elements ?? []).length, 2, `트리가 없다: ${JSON.stringify(o).slice(0, 160)}`);
  assert.ok(o.그림?.base64,
    `**화면을 찍어 놓고 버린다** — 표시창 값을 영영 못 읽는다: ${JSON.stringify(o).slice(0, 200)}`);
});

test('그림은 따로 안 찍는다 — 트리와 한 번에 온다', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜(부른것) }).observe({ scope: 'window', app: '계산기' });
  assert.equal(부른것.filter((c) => c.이름 === 'zoom').length, 0,
    '**AX 가 멀쩡한데 zoom 을 또 부른다** — 한 번이면 될 일에 두 번 간다');
  assert.equal(부른것.filter((c) => c.이름 === 'get_window_state').length, 1,
    `한 창에 두 번 읽는다: ${부른것.map((c) => c.이름).join(',')}`);
});

test('행동 전 재관찰은 화면을 안 찍는다 — 신분만 다시 잡으면 된다', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜(부른것) }).observe({ scope: 'window', app: '계산기', 그림없이: true });
  const c = 부른것.find((x) => x.이름 === 'get_window_state');
  assert.equal(c?.인자?.include_screenshot, false,
    `**볼 일도 없는 화면을 매번 찍는다** — 그 지연을 그냥 낸다: ${JSON.stringify(c?.인자)}`);
});

// ── 행동 손의 재관찰은 신분만 다시 잡는다 ───────────────────────────────
// 손은 실행 전에 화면을 한 번 더 본다(A04 지문 · 신분 한 벌). 그 관찰의 목적은
// **토큰을 다시 잡는 것**이지 화면을 보는 게 아니다. 그런데 지금은 매번 화면을 찍고
// 그 그림을 버린다 — 계약이 말하는 *"the cheap path when you're just re-indexing"* 이
// 정확히 이 자리다. 사용자 일에 아무것도 안 더하면서 지연만 낸다.
test('행동 손의 내부 재관찰은 화면을 안 찍는다', async () => {
  const { makeDesktopActTool } = await import('../src/runtime/desktop-act-tool.js');
  const 본자리 = [];
  const 손 = makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: async (a) => {
        본자리.push(a);
        return { frontmost: { name: '계산기' }, windows: [{ id: 9, pid: 77 }],
          본창: { id: 9, app: '계산기', pid: 77 },
          elements: [{ id: 's1:1', 토큰: 's1:1', 스냅샷: 's1', role: 'AXButton', label: '1', value: 'x', 창: 9, pid: 77, isEnabled: true }] };
      },
      act: () => ({ ok: true, 확인됨: true, 근거: 'ok' }),
    }],
  });
  await 손.handler({ action: 'click', app: '계산기', 대상: { id: 's1:1', label: '1' }, 기대: { 요소: 's1:1', 값: 'x' } });
  assert.ok(본자리.length > 0, '재관찰을 아예 안 한다');
  assert.ok(본자리.every((a) => a?.그림없이 === true),
    `**볼 일 없는 화면을 매번 찍는다**: ${JSON.stringify(본자리)}`);
});
