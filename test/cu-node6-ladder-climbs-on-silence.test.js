// **노드 ⑥ — 드라이버가 조용히 실패할 때도 사다리를 올린다.**
//
// 밟은 사실(2026-08-06 · 카톡 방 목록에서 대화방 열기). 다섯 칸을 손으로 밟았다:
// ```
// AX press            effect:'confirmed' · evidence:value_readback   → 방 안 열림
// AX double_click     effect:'unverifiable'                          → 방 안 열림
// 픽셀 double 배경     effect:'unverifiable'                          → 방 안 열림
// 픽셀 click fg       effect:'unverifiable'                          → 방 안 열림
// 픽셀 double fg      effect:'unverifiable'                          → ★ 열렸다
// ```
//
// **`escalation` 은 한 번도 안 왔다.** 드라이버는 "안 됐다"고 말하지 않는다 —
// 배달은 했으니 `unverifiable` 이고, 그게 정직한 답이다. 그런데 우리 사다리는
// `escalation` 이 있을 때만 오르므로 **영영 못 오른다.**
//
// 헤르메스 프롬프트가 이 경우를 정확히 다룬다:
// > *"`effect: 'unverifiable'` — the input was delivered but the driver can't confirm it.
// >  **Re-capture and check the screenshot/tree yourself before deciding it worked.**"*
// > *"Do not silently retry the same rung expecting a different result, and do not conclude
// >  'cua-driver can't drive this app' — **climb the ladder**."*
//
// 그리고 `confirmed` 도 만능이 아니다 — `value_readback` 은 *"값이 되읽혔다"* 이지
// *"내가 하려던 일이 됐다"* 가 아니다. **기대를 세웠으면 기대로 확인한다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';

const 창 = {
  window_id: 9, app_name: '카카오톡', title: '카카오톡', pid: 77,
  is_on_screen: true, z_index: 1, bounds: { x: 480, y: 128, width: 430, height: 664 },
};

/** `열리는칸` 에서만 실제로 열린다 — 그 앞 칸은 전부 조용히 실패한다(실물 그대로). */
function 가짜({ 부른것 = [], 열리는칸 = 'foreground' } = {}) {
  let 열렸나 = false;
  return {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') {
        return { windows: 열렸나 ? [창, { ...창, window_id: 10, title: 'n.BEAI 사일런트서비스' }] : [창] };
      }
      if (이름 === 'get_accessibility_tree') return { windows: [], apps: [{ name: 'Claude', pid: 1, active: true }] };
      if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: [] };
      if (이름 === 'click' || 이름 === 'double_click') {
        if (인자?.delivery_mode === 열리는칸) 열렸나 = true;
        // **조용한 실패** — 드라이버는 `escalation` 을 안 준다.
        return { delivery: { mode: 인자?.delivery_mode ?? 'background' }, effect: 'unverifiable', route: 'global_input' };
      }
      return { ok: true };
    },
  };
}

test('확인이 안 되면 사다리를 올린다 — escalation 이 없어도', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜({ 부른것 }) })
    .act({ 행동: 'click', 대상: { 창: 9, pid: 77, x: 100, y: 200 } });
  const 누름 = 부른것.filter((c) => c.이름 === 'click');
  assert.equal(누름.length, 2,
    `**한 칸에서 멈춘다** — 드라이버가 조용히 실패하면 영영 못 오른다: ${누름.length}회`);
  assert.equal(누름[1].인자.delivery_mode, 'foreground',
    `다음 칸이 foreground 가 아니다: ${JSON.stringify(누름[1].인자)}`);
});

test('그렇게 했다는 사실을 남긴다 — 조용히 화면을 만지지 않는다', async () => {
  const r = await makeCuaDriver({ mcp: 가짜({}) })
    .act({ 행동: 'click', 대상: { 창: 9, pid: 77, x: 100, y: 200 } });
  assert.equal(r?.앞세워함, true, `화면을 만졌는데 말이 없다: ${JSON.stringify(r).slice(0, 200)}`);
});

test('두 칸 넘게 안 오른다 — 같은 칸을 조용히 재시도하지 않는다', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜({ 부른것, 열리는칸: '없는칸' }) })
    .act({ 행동: 'click', 대상: { 창: 9, pid: 77, x: 100, y: 200 } }).catch(() => null);
  assert.ok(부른것.filter((c) => c.이름 === 'click').length <= 2,
    '**계속 매달린다** — 사용자만 기다린다');
});

test('확인된 걸음은 안 올린다 — 된 일을 두 번 하지 않는다', async () => {
  const 부른것 = [];
  const mcp = {
    ...가짜({ 부른것 }),
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [창] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: [] };
      if (이름 === 'click') return { effect: 'confirmed', evidence: [{ kind: 'ax_action' }] };
      return { ok: true };
    },
  };
  await makeCuaDriver({ mcp }).act({ 행동: 'click', 대상: { 창: 9, pid: 77, x: 1, y: 2 } });
  assert.equal(부른것.filter((c) => c.이름 === 'click').length, 1,
    '**됐다는데 또 누른다** — 두 번 눌리면 안 되는 것도 있다');
});

// ── 목록에서 항목을 여는 법을 모델이 알아야 한다 ────────────────────────
// 라이브에서 모델은 방 목록의 셀을 **`click`(=AXPress)** 으로 눌렀다. 그건 "선택"이지
// "열기"가 아니다 — `confirmed` 가 돌아오는데 방은 안 열린다. cua 구현이 그 갈래를 말한다:
// `double_click` 의 AX 경로가 **`AXOpen` 을 먼저 시도**한다 —
// *"Finder items, **openable list rows**, document cells."*
// 카톡 방 목록이 정확히 그 "openable list row" 다. 손은 있는데 **쓸 줄을 몰랐다.**
test('목록 행을 여는 법이 모델이 읽는 문장에 있다', async () => {
  const { demoDescriptors } = await import('../src/surface/demo-context.js');
  const act = demoDescriptors({ desktopAct: { handler: async () => ({}) } }).find((t) => t.id === 'desktop.act');
  const 글 = JSON.stringify(act ?? {});
  assert.match(글, /double_click/, '더블클릭이 아예 없다');
  assert.match(글, /목록|행|열/,
    `**"목록 행을 열려면 더블클릭"을 모델이 모른다** — click 으로 눌러 놓고 왜 안 열리는지 모른다: ${글.slice(0, 200)}`);
});

// ── 이미 터진 것을 다시 부르지 않는다 ───────────────────────────────────
// 실측(2026-08-06): AX 가 20초를 넘기는 창에서 `구조와조각` 이 timeout 으로 터지면
// 우리는 `call` 로 **한 번 더** 걸었다. 같은 창을 두 번 걷고 두 번 기다린다.
// 사용자는 그동안 아무 답도 못 받는다 — 그리고 결과는 같다.
test('트리 읽기가 터지면 다시 안 부른다 — 같은 창을 두 번 걷지 않는다', async () => {
  const 부른것 = [];
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [창] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') throw new Error('timeout');
      return {};
    },
    async 구조와조각(이름, 인자) {
      부른것.push({ 이름, 인자 });
      throw new Error('timeout');
    },
    async 조각들(이름, 인자) {
      부른것.push({ 이름, 인자, 조각: true });
      return [{ type: 'image', mimeType: 'image/jpeg', data: 'Q'.repeat(2000) }];
    },
  };
  const o = await makeCuaDriver({ mcp }).observe({ scope: 'window', 창제목: '카카오톡' });
  const 걸음 = 부른것.filter((c) => c.이름 === 'get_window_state').length;
  assert.equal(걸음, 1, `**터진 것을 또 부른다** — 20초를 두 번 쓴다: ${걸음}회`);
  assert.ok(o.그림, '터졌다고 눈까지 포기했다');
});

// ── `from_zoom` 은 **방금 찍었을 때만** 유효하다 ────────────────────────
// 실측(2026-08-06): `click{from_zoom:true}` →
//   *"from_zoom=true but no zoom context for pid 4340. **Call zoom first.**"*
// 관찰에서 찍은 zoom 은 그 턴 안에서도 살아 있지 않다(다른 호출이 끼면 지워진다).
// 그래서 **좌표로 짚는 행동 직전에 같은 영역을 다시 찍어** 좌표계를 세운다.
// 늘 창 전체(0,0~w*2,h*2)를 찍으므로 관찰 때와 같은 자다.
test('좌표로 짚으면 행동 직전에 좌표계를 세운다 — "call zoom first" 로 거절당한다', async () => {
  const 부른것 = [];
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [창] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: [] };
      if (이름 === 'click' && 인자?.from_zoom && !부른것.some((c) => c.이름 === 'zoom')) {
        // 실물이 내는 거절 그대로.
        return [{ type: 'text', text: 'from_zoom=true but no zoom context for pid 77. Call zoom first.' }];
      }
      return { effect: 'confirmed', evidence: [{ kind: 'ax_action' }] };
    },
    async 조각들(이름, 인자) {
      부른것.push({ 이름, 인자, 조각: true });
      return [{ type: 'image', mimeType: 'image/jpeg', data: 'Q'.repeat(2000) }];
    },
  };
  const r = await makeCuaDriver({ mcp })
    .act({ 행동: 'click', 대상: { 창: 9, pid: 77, x: 210, y: 840, bounds: { x: 0, y: 0, w: 430, h: 664 } } })
    .catch((e) => ({ 오류: e.message }));
  assert.ok(!r?.오류, `**좌표계를 안 세우고 눌러 거절당한다**: ${r?.오류}`);
  const 순서 = 부른것.filter((c) => ['zoom', 'click'].includes(c.이름)).map((c) => c.이름);
  assert.deepEqual(순서, ['zoom', 'click'], `찍고 나서 눌러야 한다: ${순서.join(' → ')}`);
});

// ── 카드는 **화면을 뺏을 수 있다**는 것도 말해야 한다 ───────────────────
// 오너 질문(2026-08-06): *"지금 니가 테스트 하는 동안 내가 컴퓨터로 아무것도 하지 말아야 하나?"*
// 물었다는 것 자체가 답이다. cua 의 1번 자랑이 *"당신 데스크톱은 계속 쓸 수 있는 상태로"* 인데,
// 사다리가 `foreground` 로 오르면 **창이 앞으로 온다.** 좌표로 짚는 걸음은 이미 카드를 거치므로
// (`toolActionKind` → 미상) 허락 자체는 있다 — 그런데 **카드에 그 말이 없다.**
// 비교군도 같은 규율이다: *"foreground … needs its own approval and is only appropriate
// when the user isn't actively working."*
test('좌표로 짚는 카드는 화면을 뺏을 수 있다고 말한다', async () => {
  const { makeDesktopActTool } = await import('../src/runtime/desktop-act-tool.js');
  const p = makeDesktopActTool({ drivers: [] }).previewOf({
    action: 'click', app: 'KakaoTalk', 창제목: 'n.BEAI', 대상: { x: 210, y: 840 },
  });
  assert.match(String(p.impact) + String(p.cancel), /앞으로|화면/,
    `**화면을 뺏을 수 있는데 카드가 조용하다** — 사용자는 왜 창이 튀는지 모른다: ${JSON.stringify(p)}`);
});

test('요소를 짚는 카드에는 그 말이 없다 — 뺏을 일이 없다', async () => {
  const { makeDesktopActTool } = await import('../src/runtime/desktop-act-tool.js');
  const p = makeDesktopActTool({ drivers: [] }).previewOf({
    action: 'click', app: 'KakaoTalk', 대상: { 토큰: 's1:5', label: '보내기' },
  });
  assert.ok(!/앞으로 가져올/.test(String(p.impact) + String(p.cancel)),
    `**없는 걱정을 만든다**: ${JSON.stringify(p)}`);
});

// ── 자는 **모델이 보는 그림**의 자여야 한다 ─────────────────────────────
// 실측(2026-08-06): 모델이 `y=840` 을 짚었고 `from_zoom` 이 창 좌표 `939.1` 로 되돌렸는데
// 창은 859 라 **밖**이었다 — *"lies outside window 15613's 559×859 pt frame"*.
// 우리가 준 자는 **창 논리 크기(559×859)** 였는데, 모델이 보는 그림은 **500×768** 이다.
// `zoom` 이 20% 패딩을 붙이고 500px 로 줄이기 때문이다. 자가 틀리면 짚는 자리가 틀린다.
test('그림을 줄 때는 그림의 크기를 자로 준다 — 창 크기가 아니다', async () => {
  const { compactResult } = await import('../src/kernel/l1-intent/task-context.js');
  const 짧게 = String(compactResult({
    본창: { id: 9, app: '카카오톡', title: 'n.BEAI', bounds: { x: 82, y: 33, w: 559, h: 859 } },
    elements: [],
    그림크기: { w: 500, h: 768 },
  }));
  assert.match(짧게, /500/, `**모델이 보는 그림의 자가 없다** — 밖을 짚는다: ${짧게}`);
  assert.match(짧게, /768/, `세로가 없다: ${짧게}`);
});
