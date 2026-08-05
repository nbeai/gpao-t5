// **cua 드라이버가 화면 슬롯을 채운다 — 계약은 한 줄도 안 바뀐다.**
//
// 오너 결정(2026-08-05): cua-driver 로 가고 T5 층은 우리가 만든다. 임베디드 모드.
//
// ── 이 파일이 재는 것 ────────────────────────────────────────────────────
// **드라이버를 통째로 갈아도 슬롯 계약이 그대로 서는가.** 그게 S8 의 판정이다.
// `desktop-native-driver`(Peekaboo 실행본) 자리에 `desktop-cua-driver`(MCP stdio) 를 놓아도
// `id`·`status`·`observe`·`act` 가 같은 모양이면, 손(`desktop-tool`·`desktop-act-tool`)과
// 그 계약 검사들은 **한 줄도 안 고쳐도** 돈다.
//
// ── 실물로 밟은 것(2026-08-05) ──────────────────────────────────────────
// ```
// cua-driver 0.17.0 · MCP stdio · initialize → tools/list = 54개
// check_permissions   {"accessibility":true,"screen_recording":false,
//                      "source":{"attribution":"host","embedded":false,...}}
// list_apps           실제 앱 목록
// get_accessibility_tree  실제 AX 트리
// ```
// **매니페스트(contract/manifest.json)만 보고 세 번 틀렸다.** 거기엔 23개뿐이라 나는
//   ① "cua 는 AX 트리를 안 준다"        → `get_window_state` 가 요소를 준다
//   ② "app lifecycle 이 없다"           → `launch_app`·`kill_app`·`bring_to_front` 가 있다
//   ③ "좌표로만 누른다"                 → `element_index`·`element_token` 으로 누른다(som)
// 라고 적었다. **셋 다 틀렸고 실물엔 다 있다.**
// 선언을 읽고 판정하지 말고 밟으라는 규율이 여기서 세 번 값을 했다
// (오픈클로 live test 패턴: *준비됐다고 선언하기 전에 실제로 한 번 불러 본다*).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSlotRegistry } from '../src/kernel/l2-plan/slot-registry.js';
import { DESKTOP_SLOT, 화면슬롯세우기 } from '../src/runtime/desktop-slot.js';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';
import { makeDesktopTool } from '../src/runtime/desktop-tool.js';

/** MCP 서버를 흉내 낸다 — 실네트워크·실프로세스 없이 계약만 잰다. */
function 가짜MCP({ 권한 = { accessibility: true, screen_recording: false }, 앱 = [], 창 = [], 요소 = [], 터뜨리기 = null } = {}) {
  const 부른것 = [];
  return {
    부른것,
    async call(name, args) {
      부른것.push({ name, args });
      if (터뜨리기) throw new Error(터뜨리기);
      if (name === 'check_permissions') return { ...권한, source: { attribution: 'host', embedded: true } };
      if (name === 'list_apps') return { apps: 앱 };
      // **실물 모양 그대로 흉내 낸다**(2026-08-05 확인). 가벼운 것과 무거운 것이 나뉘어 있다:
      //   `get_accessibility_tree`  앱·창 목록(가볍다)
      //   `get_window_state`        창 하나의 요소 + 번호·토큰(무겁다)
      // 처음엔 `get_accessibility_tree` 가 요소를 준다고 흉내 냈는데 **그건 옛 짐작**이었다.
      // 가짜가 실물과 다르면 검사는 있지도 않은 API 를 지키게 된다.
      if (name === 'get_accessibility_tree') return { apps: 앱, windows: 창 };
      if (name === 'get_window_state') return { snapshot_id: 'snap1', elements: 요소 };
      return {};
    },
  };
}

const 손세우기 = (mcp) => {
  const 등록소 = 화면슬롯세우기(makeSlotRegistry());
  등록소.붙이기(DESKTOP_SLOT, makeCuaDriver({ mcp }));
  return { 등록소, 손: makeDesktopTool({ drivers: 등록소.드라이버(DESKTOP_SLOT) }) };
};

// ── S8 판정: 계약을 그대로 채운다 ────────────────────────────────────────
test('cua 드라이버가 화면 슬롯 계약을 채운다 — 슬롯을 안 고친다', () => {
  const 등록소 = 화면슬롯세우기(makeSlotRegistry());
  // 계약 미달이면 여기서 터진다. 안 터지면 `id`·`status`·`observe` 를 갖췄다는 뜻이다.
  등록소.붙이기(DESKTOP_SLOT, makeCuaDriver({ mcp: 가짜MCP() }));
  assert.equal(등록소.드라이버(DESKTOP_SLOT).length, 1);
  assert.equal(등록소.드라이버(DESKTOP_SLOT)[0].id, 'cua');
});

test('권한을 MCP 로 실제로 물어 온다 — 문서나 환경변수가 아니다', async () => {
  const mcp = 가짜MCP({ 권한: { accessibility: true, screen_recording: false } });
  const { 손 } = 손세우기(mcp);
  const out = await 손.handler({ action: 'status' });
  assert.ok(mcp.부른것.some((c) => c.name === 'check_permissions'), '실제로 안 물었다');
  assert.equal(out.result.permissions.accessibility, 'granted');
  assert.equal(out.result.permissions.screenRecording, 'denied');
});

// ── 손의 계약이 그대로 산다 (드라이버를 갈아도) ──────────────────────────
test('권한이 없으면 여전히 빈 목록을 사실로 내지 않는다 — 조용한 0 금지', async () => {
  const { 손 } = 손세우기(가짜MCP({ 권한: { accessibility: false, screen_recording: false }, 창: [], 요소: [] }));
  const out = await 손.handler({ action: 'observe' });
  assert.equal(out.blocked, true, '드라이버를 갈았더니 조용한 0 이 되살아났다');
  assert.equal(out.result, undefined);
});

test('요소도 그대로 온다 — 신분·지문·비밀칸 계약이 그대로 선다', async () => {
  const { 손 } = 손세우기(가짜MCP({
    권한: { accessibility: true, screen_recording: true },
    창: [{ window_id: 1, app_name: 'Safari', pid: 9, title: '로그인' }],
    요소: [
      { index: 1, element_token: 't1', role: 'AXButton', label: '로그인', bounds: { x: 1, y: 2, w: 3, h: 4 } },
      { index: 2, element_token: 't2', role: 'AXSecureTextField', label: '비밀번호', value: 'hunter2', bounds: {} },
    ],
  }));
  const out = await 손.handler({ action: 'observe', scope: 'window' });
  const 비밀 = out.result.elements.find((e) => e.label === '비밀번호');
  assert.equal(비밀.value, undefined, '드라이버를 갈았더니 비밀값이 샜다(A09)');
  assert.equal(비밀.비밀칸, true);
  assert.ok(out.result.elements[0].지문, '지문이 사라졌다(A04)');
  assert.equal(out.result.관찰내용은데이터, true, '데이터 표식이 사라졌다(A10)');
});

// ── 텔레메트리 — 우리가 띄우는 프로세스가 몰래 밖으로 보내면 안 된다 ────────
//
// 실물 확인(2026-08-05): 기본값이 `enabled (source: default)` 이고,
// `CUA_DRIVER_RS_TELEMETRY_ENABLED=0` 을 주면 `disabled (source: environment)` 가 된다.
// **보내는 게 우리가 아니어도 띄운 것이 우리면 원인은 우리다**(헌장 ③).
test('드라이버를 띄울 때 텔레메트리를 끈다 — 이름이 아니라 인자로', async () => {
  const { 기동인자 } = await import('../src/runtime/desktop-cua-driver.js');
  const { env } = 기동인자({ binPath: '/어딘가/cua-driver' });
  assert.equal(env.CUA_DRIVER_RS_TELEMETRY_ENABLED, '0',
    '**우리가 띄운 프로세스가 밖으로 보낸다** — 헌장 ③ 이 걸리는 자리다');
});

test('실행 방식은 임베디드다 — 별도 앱을 깔게 하지 않는다', async () => {
  const { 기동인자 } = await import('../src/runtime/desktop-cua-driver.js');
  const { args } = 기동인자({ binPath: '/어딘가/cua-driver' });
  assert.deepEqual(args.slice(0, 2), ['mcp', '--direct'],
    'standalone 을 고르면 사용자가 CuaDriver.app 을 따로 깔아야 한다(§15 마찰)');
});

// ── 드라이버가 없거나 죽어도 정직하다 ───────────────────────────────────
test('MCP 가 터지면 못 봤다고 한다 — 성공도 침묵도 아니다', async () => {
  const { 손 } = 손세우기(가짜MCP({ 터뜨리기: 'boom' }));
  const out = await 손.handler({ action: 'observe' });
  assert.equal(out.blocked, true);
  assert.ok(!JSON.stringify(out).includes('boom'), '내부 오류가 사용자면으로 샜다');
});

// ── som · 번호로 누른다 (실물 확인) ──────────────────────────────────────
//
// 오너가 Hermes 스키마에서 꼽은 ①이 **cua 실물에 있다**(2026-08-05 직접 호출):
//   `get_window_state` 가 `element_index`·`element_token`·`snapshot_id` 를 주고
//   `click` 이 그것을 받는다. 원문: *"interactive element indices you can click by."*
//
// **좌표로 찍으면 무엇을 눌렀는지 원장에 남길 수가 없다.** 번호·토큰이면 남는다.
test('누를 때 좌표가 아니라 번호·토큰을 보낸다 — 원장에 남길 수 있게', async () => {
  const mcp = 가짜MCP({
    권한: { accessibility: true, screen_recording: true },
    창: [{ window_id: 7, app_name: 'Safari', pid: 9 }],
    요소: [{ index: 3, element_token: 'tok3', role: 'AXButton', label: '저장', bounds: { x: 10, y: 20, w: 4, h: 4 } }],
  });
  const { 등록소 } = 손세우기(mcp);
  const 드라이버 = 등록소.드라이버(DESKTOP_SLOT)[0];
  const 본것 = await 드라이버.observe({ scope: 'window' });
  const e = 본것.elements[0];
  assert.equal(e.토큰, 'tok3');
  assert.equal(e.스냅샷, 'snap1', '스냅샷 신분이 없으면 번호가 어느 순간 것인지 모른다');

  await 드라이버.act({ 행동: 'click', 대상: e });
  const 부름 = mcp.부른것.find((c) => c.name === 'click');
  assert.equal(부름.args.element_token, 'tok3', '**좌표로 찍었다** — 무엇을 눌렀는지 못 남긴다');
  assert.equal(부름.args.snapshot_id, 'snap1');
  assert.equal(부름.args.x, undefined, '좌표를 함께 보내면 어느 쪽으로 눌렸는지 모른다');
});

test('무거운 관찰은 필요할 때만 — 창 목록만 볼 때는 안 부른다', async () => {
  const mcp = 가짜MCP({ 권한: { accessibility: true, screen_recording: true }, 창: [{ window_id: 1, pid: 2 }] });
  const { 손 } = 손세우기(mcp);
  await 손.handler({ action: 'observe' });
  assert.ok(!mcp.부른것.some((c) => c.name === 'get_window_state'),
    '창 목록만 필요한 턴에 창 하나의 AX 트리를 통째로 훑었다');
});
