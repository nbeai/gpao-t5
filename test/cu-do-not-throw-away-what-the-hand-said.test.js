// **손이 준 사실을 버리지 않는다.**
//
// PM 판정(2026-08-07): 여섯 개가 아니라 하나다.
// ```
// cua 가 매 응답에 주는 것              T5 가 하는 것
// space_ids · on_current_space          읽는 자리 0곳
// escalation.reason "다음은 이렇게"      버림
// background_input.routes[] 경로별 이유  버림
// degraded_reason                       ← 이 한 줄만 뽑아 "실패"로 전달
// ```
//
// 실물이 이렇게 말한다(계산기 · 다른 Space):
// ```
// list_windows      space_ids=[1] · current_space_id=22 · on_current_space=false
// escalation.reason "the screenshot in this response IS the requested window,
//                    but background input (including px) is refused while its AX
//                    surface is unresolved … or act with delivery_mode:'foreground'"
// background_input  routes 셋 다 status:"refused" · reason:"off_space_or_ax_unresolved"
// ```
// **그림은 맞고 입력만 거부된다**는 것을 드라이버가 정확히 말하는데 T5 는 한 줄만 뽑았다.
// 이게 서면 모델이 처음으로 *"계산기가 다른 화면에 있어서 조작은 못 하지만 화면은 보여요"*
// 라고 말할 수 있다. 지금은 *"글자로 못 읽는다"* 밖에 못 한다.
//
// 오늘 하루 종일 나온 그 병이다(노드 K: 한 것만 말하고 안 한 것은 안 말한다).
// 다른 점은 재료의 출처가 커널이 아니라 **손**이라는 것뿐이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';

const 다른space창 = {
  window_id: 813, app_name: '계산기', title: '계산기', pid: 18355,
  is_on_screen: false, z_index: 120, layer: 0,
  bounds: { x: 0, y: 0, width: 230, height: 408 },
  space_ids: [1], current_space_id: 22, on_current_space: false,
};

const 실물응답 = {
  snapshot_id: 's1', elements: [], element_count: 0,
  degraded: true,
  degraded_reason: 'ax_window_unresolved: window_id 813 exists and is owned by pid 18355 …',
  escalation: {
    reason: 'observation-only: the screenshot in this response IS the requested window,'
      + ' but background input (including px) is refused while its AX surface is unresolved',
    recommended: 'foreground',
  },
  background_input: {
    exact_window: { pid: 18355, status: 'ax_unresolved', window_id: 813 },
    routes: [
      { route: 'accessibility', status: 'refused', reason: 'off_space_or_ax_unresolved' },
      { route: 'window_pointer', status: 'refused', reason: 'off_space_or_ax_unresolved' },
      { route: 'pid_keyboard', status: 'refused', reason: 'off_space_or_ax_unresolved' },
    ],
  },
};

const 가짜 = () => ({
  async call(이름) {
    if (이름 === 'list_windows') return { windows: [다른space창], current_space_id: 22 };
    if (이름 === 'list_apps') return { apps: [{ name: '계산기', pid: 18355, running: true }] };
    if (이름 === 'get_accessibility_tree') return { windows: [] };
    if (이름 === 'get_window_state') return 실물응답;
    return {};
  },
  async 조각들() { return [{ type: 'image', data: 'x'.repeat(1200) }]; },
  async 구조와조각(이름, 인자) {
    return { 구조: await this.call(이름, 인자), 조각: [{ type: 'image', data: 'x'.repeat(1200) }] };
  },
});

const 보기 = () => makeCuaDriver({ mcp: 가짜() }).observe({ scope: 'window', app: '계산기' });

test('창이 어느 화면(Space)에 있는지 말한다 — 이게 없으면 원인을 영영 못 찾는다', async () => {
  const o = await 보기();
  const s = JSON.stringify(o);
  assert.match(s, /다른 화면|Space/,
    `**다른 Space 라는 사실이 없다** — 모델도 사람도 "가려졌나" 로만 추측한다: ${s.slice(0, 400)}`);
  assert.equal(o.본창?.같은화면, false,
    `**같은 화면인지 안 밝힌다**: ${JSON.stringify(o.본창)}`);
});

test('그림은 맞다는 사실을 버리지 않는다 — 드라이버가 그렇게 말했다', async () => {
  const o = await 보기();
  assert.ok(o.그림, '그림이 없다');
  assert.match(JSON.stringify(o.화면사실 ?? {}), /요청한 창|맞/,
    `**"그림은 요청한 창이 맞다"를 버린다** — 모델이 그림을 못 믿는다: ${JSON.stringify(o.화면사실)}`);
});

test('무엇이 막혔는지 경로별로 말한다 — "못 읽는다"와 "조작만 막혔다"는 다르다', async () => {
  const o = await 보기();
  const s = JSON.stringify(o.화면사실 ?? {});
  assert.match(s, /조작|입력/,
    `**입력이 막힌 것인지 관찰이 막힌 것인지 안 가른다**: ${s}`);
});

test('같은 화면에 있는 멀쩡한 창은 그 말을 안 붙인다 — 없는 문제를 만들지 않는다', async () => {
  const 정상 = { ...다른space창, is_on_screen: true, space_ids: [22], on_current_space: true };
  const mcp = 가짜();
  const 원래 = mcp.call.bind(mcp);
  mcp.call = async (이름, 인자) => (이름 === 'list_windows'
    ? { windows: [정상], current_space_id: 22 }
    : (이름 === 'get_window_state'
      ? { snapshot_id: 's0', elements: [{ type: 'AXStaticText', label: '60,413' }] }
      : 원래(이름, 인자)));
  mcp.구조와조각 = async (이름, 인자) => ({ 구조: await mcp.call(이름, 인자), 조각: [] });
  const o = await makeCuaDriver({ mcp }).observe({ scope: 'window', app: '계산기' });
  assert.doesNotMatch(JSON.stringify(o), /다른 화면/, '멀쩡한 창에 경고를 붙인다');
});

// ── 손이 그 사실을 모델과 사람에게 전달한다 ─────────────────────────────
// 드라이버가 사실을 세워도 손이 안 실으면 그대로 죽는다 — 오늘 여러 번 본 자리다.
import { makeDesktopTool } from '../src/runtime/desktop-tool.js';

const 손 = (본것) => makeDesktopTool({
  drivers: [{
    id: 'cua',
    status: () => ({ connected: true, permissions: { accessibility: 'granted' } }),
    observe: async () => 본것,
  }],
});

const 다른화면본것 = {
  windows: [],
  본창: { id: 813, app: '계산기', title: '계산기', 같은화면: false },
  그림: { mime: 'image/png', base64: 'x'.repeat(1200) },
  그림크기: { w: 460, h: 816 },
  화면사실: {
    조작막힘: true,
    조작막힌이유: 'off_space_or_ax_unresolved',
    막힌길: ['accessibility', 'window_pointer', 'pid_keyboard'],
    그림은요청한창이맞다: true,
    다른화면에있다: true,
    말: '그 창은 지금 보고 있는 화면(Space)이 아니라 **다른 화면에 있어요** — 화면은 볼 수 있지만 조작은 그 화면으로 넘어가야 해요.',
  },
  elements: [],
};

test('모델이 받는 결과에 그 사실이 있다 — 손이 안 실으면 드라이버가 세워도 죽는다', async () => {
  const r = await 손(다른화면본것).handler({ scope: 'window', app: '계산기' });
  const s = JSON.stringify(r.result ?? {});
  assert.match(s, /다른화면에있다|다른 화면/,
    `**Space 사실이 모델에 안 간다**: ${s.slice(0, 300)}`);
  assert.match(s, /조작막힘|off_space/,
    `**조작만 막힌 것인지 안 밝힌다**: ${s.slice(0, 300)}`);
});

test('사람에게도 그 말을 한다 — "글자로 못 읽는다"로는 원인을 모른다', async () => {
  const r = await 손(다른화면본것).handler({ scope: 'window', app: '계산기' });
  assert.match(String(r.userSafeSummary ?? ''), /다른 화면/,
    `**사장님이 왜 안 되는지 모른다**: ${r.userSafeSummary}`);
});
