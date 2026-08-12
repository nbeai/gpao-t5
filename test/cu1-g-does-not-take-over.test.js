// **CU-1 계열 G · 옆에서 같이 한다 — 사용자 것을 안 뺏는다.**
//
// 오너 지적(2026-08-06): 비교군(Hermes)이 **축으로** 세운 것인데 내 계획에 통째로 없었다.
// 그리고 라이브 실측이 이미 된다는 걸 보여줬는데 내가 못 알아봤다 —
// Finder 를 앞에 둔 채 계산기를 눌렀더니 `1 → 14` 로 들어갔다. 배경 조작이 된다.
// 그래 놓고 몇 시간 뒤 오너께 *"컴퓨터 쓰시면 부딪힙니다"* 라고 답했다.
//
// 이건 기능 하나가 아니라 **CU 의 성격을 가르는 축**이다:
//   *"사용자 대신 컴퓨터를 뺏는 기능"* 인가 *"옆에서 같이 하는 기능"* 인가.
//
// ── 그리고 실제로 뺏는 자리가 하나 있었다 ────────────────────────────────
// `type` 이 `type_text` 로 나간다. 그건 **포커스를 가진 곳**에 글자를 넣는다 —
// 오너가 다른 창에서 타이핑 중이면 **그 창에 들어간다.** 안 뺏는 문제가 아니라
// **오대상 실행**이다(A02 가 같은 이름을 막는 것과 같은 급).
//
// `set_value` 는 드라이버에 이미 있다. 요소를 직접 짚어 넣으니 포커스와 무관하고,
// 네이티브 메뉴도 안 연다(메뉴를 열면 포커스를 뺏는다). **그걸 먼저 쓴다.**
// 안 되면 **막고 다음 수를 준다** — 임의로 키보드에 흘리지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';

const 글자칸 = {
  id: 't1', 토큰: 's1:3', 스냅샷: 's1', role: 'AXTextField', label: '받는 사람',
  value: '', isEnabled: true, 창: 9, pid: 77,
};

function 손세우기({ 값넣기결과 = { ok: true }, 앞창 = '계산기', 누른뒤앞창 = null } = {}) {
  const 부른것 = [];
  let 했나 = false;
  const 드라이버 = {
    id: 'f',
    status: () => ({ permissions: { accessibility: 'granted' } }),
    observe: () => ({
      frontmost: { name: 했나 && 누른뒤앞창 ? 누른뒤앞창 : 앞창 },
      windows: [{ id: 9, pid: 77 }],
      elements: [글자칸],
    }),
    act: (요청) => { 부른것.push(요청); 했나 = true; return 값넣기결과; },
    verify: async () => ({ 판정: 'satisfied' }),
  };
  return { 손: makeDesktopActTool({ drivers: [드라이버] }), 부른것 };
}

// ── ① 글자는 요소에 직접 넣는다 — 키보드에 흘리지 않는다 ─────────────────
test('글자 넣기는 set_value 로 간다 — type_text 는 포커스 가진 곳에 흘러 들어간다', async () => {
  const { 손, 부른것 } = 손세우기();
  await 손.handler({ action: 'type', 대상: 글자칸, 값: '안녕', 기대: { 요소: 't1', 값: '안녕' } });
  const 행동 = 부른것.map((c) => c.행동);
  assert.ok(행동.includes('set_value'), `**키보드로 흘렸다** — 사용자 창에 들어갈 수 있다: ${JSON.stringify(행동)}`);
  assert.equal(행동.includes('type'), false, 'type_text 를 여전히 쓴다');
});

test('값을 직접 못 넣으면 막고 다음 수를 준다 — 임의로 키보드에 흘리지 않는다', async () => {
  const { 손, 부른것 } = 손세우기({ 값넣기결과: { effect: 'refused', code: 'not_settable' } });
  const r = await 손.handler({ action: 'type', 대상: 글자칸, 값: '안녕', 기대: { 요소: 't1', 값: '안녕' } });
  assert.equal(부른것.filter((c) => c.행동 === 'type').length, 0,
    '**직접 넣기가 막히자 키보드로 흘렸다** — 그 글자가 어디로 갈지 모른다');
  assert.notEqual(r.result?.단계, 'goal_verified', '못 넣었는데 됐다고 한다');
  assert.ok(r.다음수단?.length || r.진행, `막힌 사실이 없다: ${JSON.stringify(r).slice(0, 180)}`);
});

test('신분이 없으면 값을 안 넣는다 — 어디에 넣는지 모르는 채로 넣지 않는다', async () => {
  const { 손, 부른것 } = 손세우기();
  const r = await 손.handler({ action: 'type', 대상: { label: '알 수 없는 칸' }, 값: '안녕', 기대: { 요소: 't1', 값: '안녕' } });
  assert.equal(부른것.length, 0, '**어디인지 모르는데 넣었다**');
  assert.equal(r.blocked ?? r.막힘, true, JSON.stringify(r).slice(0, 160));
});

// ── ② 누르기·입력이 앞 창을 바꾸지 않는다 ───────────────────────────────
test('누르기가 앞 창을 바꾸면 그 사실을 남긴다 — 조용히 뺏지 않는다', async () => {
  const { 손 } = 손세우기({ 앞창: '메모', 누른뒤앞창: '계산기' });
  const r = await 손.handler({
    action: 'click', 대상: { ...글자칸, role: 'AXButton', label: '7' }, 기대: { 요소: 't1', 값: '7' },
  });
  // 됐다고 말해도 좋다 — 다만 **사용자 화면을 바꿨다는 사실**은 숨기지 않는다.
  assert.equal(r.result?.앞창바뀜, true,
    `**사용자 앞 창을 바꿔 놓고 아무 말도 안 한다**: ${JSON.stringify(r.result ?? r).slice(0, 200)}`);
});

test('앞 창이 그대로면 바꿨다고 하지 않는다', async () => {
  const { 손 } = 손세우기({ 앞창: '계산기', 누른뒤앞창: '계산기' });
  const r = await 손.handler({
    action: 'click', 대상: { ...글자칸, role: 'AXButton', label: '7' }, 기대: { 요소: 't1', 값: '7' },
  });
  assert.notEqual(r.result?.앞창바뀜, true);
});

// ── ③ 앞으로 가져오기는 사용자가 시켰을 때만이다 ─────────────────────────
test('누르기가 focus 를 끌고 오지 않는다 — 부탁하지 않은 일은 안 한다', async () => {
  const { 손, 부른것 } = 손세우기();
  await 손.handler({
    action: 'click', 대상: { ...글자칸, role: 'AXButton', label: '7' }, 기대: { 요소: 't1', 값: '7' },
  });
  assert.equal(부른것.filter((c) => c.행동 === 'focus').length, 0,
    '**누르라고 했는데 앞으로 가져왔다** — 사용자가 보던 것을 뺏는다');
});

// ── ④ 안 뺏고 **보기** ───────────────────────────────────────────────────
// 라이브(2026-08-06): Finder 를 앞에 두고 계산기를 조작하려니 **창 안을 볼 수가 없었다** —
// `scope:'window'` 가 **앞 창만** 본다. 안 뺏고 일하려면 **안 뺏고 볼** 수도 있어야 한다.
// 안 그러면 "옆에서 같이 한다"가 말뿐이고, 실제로는 앞으로 가져와야만 일할 수 있다.
test('앞에 없는 앱의 창 안도 본다 — 앞으로 가져오지 않고', async () => {
  const { makeCuaDriver } = await import('../src/runtime/desktop-cua-driver.js');
  const 부른것 = [];
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'get_accessibility_tree') {
        return { windows: [
          { window_id: 1, app_name: 'Finder', pid: 11, is_on_screen: true },
          { window_id: 9, app_name: '계산기', pid: 77, is_on_screen: true },
        ] };
      }
      if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: [{ element_token: 's1:5', index: 5, role: 'AXButton', label: '3' }] };
      return {};
    },
  };
  const o = await makeCuaDriver({ mcp }).observe({ scope: 'window', app: '계산기' });
  const 본것 = 부른것.find((c) => c.이름 === 'get_window_state');
  assert.equal(본것?.인자?.window_id, 9, `**앞 창만 본다** — 앞으로 안 가져오면 일을 못 한다: ${JSON.stringify(본것?.인자)}`);
  assert.equal(본것?.인자?.pid, 77);
  assert.equal(부른것.some((c) => c.이름 === 'bring_to_front'), false, '보려고 앞으로 가져왔다');
  assert.equal((o.elements ?? []).length, 1);
});

test('어느 창을 봤는지 남긴다 — 같은 앱 창이 여럿일 수 있다', async () => {
  const { makeCuaDriver } = await import('../src/runtime/desktop-cua-driver.js');
  const mcp = {
    async call(이름) {
      if (이름 === 'get_accessibility_tree') {
        return { windows: [{ window_id: 9, app_name: '계산기', pid: 77, title: '계산기', is_on_screen: true }] };
      }
      if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: [] };
      return {};
    },
  };
  const o = await makeCuaDriver({ mcp }).observe({ scope: 'window', app: '계산기' });
  assert.equal(o.본창?.id, 9, `무엇을 봤는지 안 적는다: ${JSON.stringify(o.본창)}`);
  assert.equal(o.본창?.app, '계산기');
});

test('모델이 앱을 지목할 칸이 있다 — 없으면 앞 창만 볼 수밖에 없다', async () => {
  const { demoDescriptors } = await import('../src/surface/demo-context.js');
  const d = (demoDescriptors({ desktop: true }) ?? []).find((x) => x.id === 'desktop.screen');
  const 칸 = d?.schema?.parameters?.properties ?? {};
  assert.ok(칸.app, `**앱을 지목할 칸이 없다** — 앞으로 가져와야만 창 안을 본다: ${Object.keys(칸).join(' ')}`);
});

test('화면 손이 앱 지목을 드라이버까지 넘긴다', async () => {
  const { makeDesktopTool } = await import('../src/runtime/desktop-tool.js');
  const 받은것 = [];
  const 손 = makeDesktopTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: (a) => { 받은것.push(a); return { frontmost: { name: 'Finder' }, windows: [{ id: 9 }], elements: [] }; },
    }],
  });
  await 손.handler({ action: 'observe', scope: 'window', app: '계산기' });
  assert.equal(받은것[0]?.app, '계산기', `**지목이 중간에서 사라진다**: ${JSON.stringify(받은것[0])}`);
});

test('손의 내부 재관찰도 같은 창을 본다 — 앞 창을 보면 엉뚱한 신분을 집는다', async () => {
  const 본것 = [];
  const 대상요소 = { id: 'b3', 토큰: 's1:3', 스냅샷: 's1', role: 'AXButton', label: '3', isEnabled: true, 창: 9, pid: 77 };
  const 손 = makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: (a) => {
        본것.push(a);
        // 앞 창을 보면 **다른 앱**이 나온다 — 실물이 그렇다.
        return String(a?.app ?? '') || a?.window
          ? { frontmost: { name: 'Claude' }, windows: [{ id: 9, pid: 77 }], elements: [대상요소], 본창: { id: 9, app: '계산기' } }
          : { frontmost: { name: 'Claude' }, windows: [{ id: 1, pid: 11 }], elements: [] };
      },
      act: () => ({ ok: true }),
      verify: async () => ({ 판정: 'satisfied' }),
    }],
  });
  await 손.handler({ action: 'click', 대상: 대상요소, app: '계산기', window: 9 });
  const 앞창만본것 = 본것.filter((a) => a?.scope === 'window' && !a?.app && !a?.window);
  assert.equal(앞창만본것.length, 0,
    `**내부 재관찰이 앞 창을 본다** — 다른 창의 신분을 집어 아무 데도 안 눌린다: ${JSON.stringify(본것)}`);
});
