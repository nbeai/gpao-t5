// **눈이 있으면 그 자리를 누를 수 있어야 한다.**
//
// 오너(2026-08-06):
// > *"손이 있으면 그걸로 컵을 잡든, 연필을 쥐고 글을 쓰든, 망치를 가지고 못을 박든 다 할 수 있지.
// >  도구라는 건 그런 손과 같은 것이다. 눈이 있으면 무언가를 보고, 읽고 할 수 있는 것처럼."*
//
// 지금 우리 손은 **AX 토큰으로만** 누른다. 그래서 AX 를 안 내주는 창(카톡
// `n.BEAI 사일런트서비스` — 요소 **0개**)에서는 화면을 **보고도** 아무것도 못 만진다.
// T5 는 *"권한/지원 제약 때문에 조작이 안 됩니다"* 라고 답했다 — 사실이 아니다.
// 드라이버는 길을 이미 말했다: *"act by pixel (x,y) off the screenshot."*
//
// 눈과 손을 잇는다: **화면에서 본 자리를 그대로 짚는다.**
// 규율은 안 느슨해진다 — 좌표로 짚는 것은 **원장에 무엇을 눌렀는지 남길 수 없으므로**
// (A17 이 겨눈 자리) 언제나 **사람에게 한 번 묻는다.** 토큰이 있으면 토큰이 이긴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';
import { toolActionKind } from '../src/kernel/l2-plan/action-plan.js';
import { UNKNOWN_KIND } from '../src/kernel/l2-plan/authority.js';

const 창 = { window_id: 9, app_name: '카카오톡', title: 'n.BEAI', pid: 77, is_on_screen: true, z_index: 1,
  bounds: { x: 100, y: 200, width: 400, height: 800 } };

function 가짜(부른것 = []) {
  return {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [창] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') return { elements: [] };   // AX 가 없는 창
      return { effect: 'confirmed' };
    },
    async 조각들() { return [{ type: 'image', mimeType: 'image/jpeg', data: 'Q'.repeat(2000) }]; },
  };
}

// ── 드라이버 — 좌표를 그대로 보낸다 ─────────────────────────────────────
test('화면에서 본 자리를 누른다 — AX 가 없는 창에서 유일한 길이다', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜(부른것) })
    .act({ 행동: 'click', 대상: { 창: 9, pid: 77, x: 300, y: 900 } });
  const c = 부른것.find((x) => x.이름 === 'click');
  assert.equal(c?.인자?.x, 300, `**눈으로 본 자리를 못 누른다**: ${JSON.stringify(c?.인자)}`);
  assert.equal(c?.인자?.y, 900);
});

test('토큰이 있으면 토큰이 이긴다 — 좌표는 마지막 수단이다', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜(부른것) })
    .act({ 행동: 'click', 대상: { 창: 9, pid: 77, 토큰: 's1:5', x: 300, y: 900 } });
  const c = 부른것.find((x) => x.이름 === 'click');
  assert.equal(c?.인자?.element_token, 's1:5');
  assert.equal(c?.인자?.x, undefined, '**토큰이 있는데 좌표로 찍었다** — 화면이 밀리면 딴 것을 누른다');
});

// ── 손 — 좌표만 있어도 받는다(A17 은 이름을 요구했다) ───────────────────
test('이름이 없어도 화면에서 본 자리면 받는다 — 눈이 곧 근거다', async () => {
  const 간것 = [];
  const 손 = makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: async () => ({ frontmost: { name: 'K' }, windows: [{ id: 9, pid: 77 }],
        본창: { id: 9, app: '카카오톡', title: 'n.BEAI', pid: 77, bounds: { x: 100, y: 200, w: 400, h: 800 } },
        elements: [] }),
      act: (요청) => { 간것.push(요청); return { effect: 'confirmed' }; },
    }],
  });
  const r = await 손.handler({ action: 'click', app: 'KakaoTalk', 대상: { x: 300, y: 900 } });
  assert.equal(간것.length, 1, `**눈으로 본 자리를 손이 안 받는다**: ${r.userSafeSummary}`);
  assert.equal(간것[0]?.대상?.x, 300);
});

test('무엇을 눌렀는지 원장에 남는다 — 좌표뿐이어도 사실은 적는다', async () => {
  const 손 = makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: async () => ({ frontmost: { name: 'K' }, windows: [{ id: 9, pid: 77 }],
        본창: { id: 9, app: '카카오톡', pid: 77 }, elements: [] }),
      act: () => ({ effect: 'confirmed' }),
    }],
  });
  const r = await 손.handler({ action: 'click', app: 'KakaoTalk', 대상: { x: 300, y: 900 } });
  assert.match(JSON.stringify(r.result ?? r.진행 ?? {}), /300/,
    `**어디를 눌렀는지 안 남는다**: ${JSON.stringify(r).slice(0, 220)}`);
});

// ── 규율은 그대로 — 좌표는 언제나 묻는다 ────────────────────────────────
test('좌표로 짚는 걸음은 언제나 사람에게 묻는다 — 무엇을 눌렀는지 못 적는다', () => {
  const kind = toolActionKind({
    toolId: 'desktop.act',
    args: { action: 'click', 대상: { x: 300, y: 900 }, 눌러본사실: { 찾음: true, 값있음: true } },
  });
  assert.equal(kind, UNKNOWN_KIND,
    '**좌표로 아무 데나 카드 없이 누른다** — 원장에 좌표만 남는다');
});

// ── 눈이 자리를 말하려면 **자를 함께 줘야 한다** ─────────────────────────
// 그림만 주면 모델은 "입력창이 아래에 있다"까지만 안다. **어디를 누르라고 말할 수가 없다.**
// 그림과 함께 **그 창의 자리와 크기**를 주면 비율로 짚을 수 있다.
// 이건 전용 기능이 아니다 — 모든 창, 모든 앱에 같은 자가 붙는다.
test('그림을 줄 때 그 창의 자리와 크기도 함께 준다 — 자가 없으면 짚을 수 없다', async () => {
  const { compactResult } = await import('../src/kernel/l1-intent/task-context.js');
  const 짧게 = String(compactResult({
    본창: { id: 9, app: '카카오톡', title: 'n.BEAI', bounds: { x: 100, y: 200, w: 400, h: 800 } },
    elements: [],
  }));
  assert.match(짧게, /100/, `**창의 자리를 안 준다** — 화면을 봐도 어디를 누를지 못 말한다: ${짧게}`);
  assert.match(짧게, /400/, `창의 크기를 안 준다: ${짧게}`);
});

test('짚는 법도 말해 준다 — 도구 설명이 손 쓰는 법을 담는다', async () => {
  const { demoDescriptors } = await import('../src/surface/demo-context.js');
  const 선언 = demoDescriptors({ desktopAct: { handler: async () => ({}) } })
    .find((t) => t.id === 'desktop.act');
  const 글 = JSON.stringify(선언 ?? {});
  assert.match(글, /x.*y|좌표|자리/,
    `**눈으로 본 자리를 짚는 법을 안 알려 준다** — 손이 있어도 안 쓴다: ${글.slice(0, 200)}`);
});

// ── 모델에게 실제로 가는 문장이 손을 다 말해야 한다 ─────────────────────
// 라이브(2026-08-06). 좌표로 짚는 손을 붙이고 자까지 줬는데 모델은 관찰만 네 번 하고
// *"권한으로는 카카오톡 창 안에서 버튼을 누르거나 글자를 입력하는 동작까지는 못 해서"* 라 답했다.
// 원인은 능력 설명이 아니라 **모델에게 실제로 가는 한 줄**(`operatorFact`)이었다 —
// 거기엔 *"창·앱 상태를 바꾸고 전후 값으로 확인한다"* 뿐이었다. **누르기도 입력도 없다.**
// 오늘 이 계열이 세 번째다: 계약을 바꾸면 **계약을 읽는 쪽 문장**도 같이 바꿔야 한다.
test('모델에게 가는 한 줄이 손을 다 말한다 — 누르기·입력·좌표', async () => {
  const { demoDescriptors } = await import('../src/surface/demo-context.js');
  const act = demoDescriptors({ desktopAct: { handler: async () => ({}) } }).find((t) => t.id === 'desktop.act');
  const 한줄 = String(act?.operatorFact ?? '');
  for (const [무엇, 재는말] of [['누르기', /누르|클릭/], ['글자 넣기', /글자|입력/], ['눈으로 짚기', /좌표|자리|x·y|x,y/]]) {
    assert.match(한줄, 재는말, `**${무엇}를 모델이 모른다** — 손이 있어도 안 쓴다: ${한줄}`);
  }
});

test('보는 손도 "글자로 안 읽히면 화면으로 준다"를 말한다', async () => {
  const { demoDescriptors } = await import('../src/surface/demo-context.js');
  const screen = demoDescriptors({ desktop: { handler: async () => ({}) } }).find((t) => t.id === 'desktop.screen');
  assert.match(String(screen?.operatorFact ?? ''), /화면|그림|눈/,
    `**AX 로 안 읽히는 창을 어떻게 하는지 모델이 모른다**: ${screen?.operatorFact}`);
});

test('창제목으로 지목하면 그 창을 앞으로 띄운다 — "여러 개라 모르겠다"로 끝내지 않는다', async () => {
  const 간것 = [];
  const 손 = makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: async (a) => ({
        frontmost: { name: 'X' }, windows: [{ id: 9, pid: 77 }],
        본창: a?.창제목 === 'n.BEAI' ? { id: 9, app: '카카오톡', title: 'n.BEAI', pid: 77 } : undefined,
        elements: [],
      }),
      act: (요청) => { 간것.push(요청); return { ok: true, 확인됨: true, 근거: 'ok' }; },
    }],
  });
  await 손.handler({ action: 'focus', app: '카카오톡', 창제목: 'n.BEAI' });
  assert.equal(간것[0]?.대상?.창, 9,
    `**지목한 창을 안 짚는다** — 드라이버가 "여러 개"라며 거절한다: ${JSON.stringify(간것[0]?.대상)}`);
});

test('창을 가리키는 이름이 하나다 — 두 이름으로 부르면 한쪽만 본다', async () => {
  const 부른것 = [];
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [창] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'list_apps') return { apps: [{ name: '카카오톡', pid: 77, running: true }] };
      return { effect: 'confirmed' };
    },
  };
  // 손이 깔아 주는 이름은 `창` 이다(요소 신분과 같은 말). 드라이버가 그걸 못 보면
  // *"창이 여러 개라 모르겠다"* 로 되묻고, 사용자는 이미 어느 창인지 말했는데 걸음이 죽는다.
  await makeCuaDriver({ mcp }).act({ 행동: 'focus', 대상: { app: '카카오톡', 창: 9 } });
  const c = 부른것.find((x) => x.이름 === 'bring_to_front');
  assert.equal(c?.인자?.window_id, 9, `**손이 짚어 준 창을 드라이버가 못 본다**: ${JSON.stringify(c?.인자)}`);
});

// ── 화면을 줬으면 **그 다음 길**도 준다 ─────────────────────────────────
// 라이브(2026-08-06). 그림도 갔고 자(`자리 x82 y33 크기 559×859`)도 갔고 손도 있는데
// 모델은 관찰만 네 번 반복하고 *"권한과 도구로는 할 수 없어요"* 라고 답했다.
// 우리가 한 말은 *"그 창은 글자로는 못 읽어서 화면을 보고 말씀드릴게요"* 뿐이었다 —
// **다음에 무엇을 하면 되는지는 한 글자도 없었다.** 오늘 이 패턴이 다섯 번째다.
test('글자로 못 읽는 창에는 "화면 보고 짚어라"를 길로 준다', async () => {
  const { makeDesktopTool } = await import('../src/runtime/desktop-tool.js');
  const 손 = makeDesktopTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({
        frontmost: { name: 'X' }, windows: [{ id: 9 }],
        본창: { id: 9, app: '카카오톡', title: 'n.BEAI', pid: 77, bounds: { x: 82, y: 33, w: 559, h: 859 } },
        elements: [], 그림: { mime: 'image/jpeg', base64: 'Q'.repeat(2000) },
      }),
    }],
  });
  const r = await 손.handler({ action: 'observe', scope: 'window', app: '카카오톡' });
  const 길 = JSON.stringify(r.result?.다음수단 ?? []);
  assert.match(길, /click|누르|짚/,
    `**화면만 주고 무엇을 하라는 말이 없다** — 모델은 "못 한다"로 끝낸다: ${길}`);
  assert.match(길, /x|좌표|자리/, `짚는 법을 안 말한다: ${길}`);
});

// ── 좌표에 글자를 넣는 길은 키보드다 ────────────────────────────────────
// 라이브(2026-08-06 · 마지막 조각). 모델이 좌표로 입력칸을 눌렀고(`{x:210,y:820}`) 눌렸다.
// 그런데 `type` 이 **요소에 값을 놓는 손**(`set_value`)으로만 가서 실패했다 —
// 좌표에는 놓을 요소가 없다. **커서를 둔 뒤 키보드로 치는 것**이 그 자리의 길이다.
test('좌표로 짚었으면 키보드로 친다 — 놓을 요소가 없다', async () => {
  const 부른것 = [];
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [창] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      return { effect: 'confirmed' };
    },
  };
  await makeCuaDriver({ mcp }).act({ 행동: 'set_value', 대상: { 창: 9, pid: 77, x: 210, y: 820 }, 값: '오늘도 힘!' });
  const 이름들 = 부른것.map((c) => c.이름);
  assert.ok(이름들.includes('type_text'),
    `**놓을 요소가 없는데 set_value 로 간다** — 화면을 보고 눌러 놓고 글자를 못 넣는다: ${이름들.join(',')}`);
  assert.equal(부른것.find((c) => c.이름 === 'type_text')?.인자?.text, '오늘도 힘!');
});

test('요소를 짚었으면 그대로 값을 놓는다 — 키보드로 흘리지 않는다', async () => {
  const 부른것 = [];
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [창] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      return { effect: 'confirmed' };
    },
  };
  await makeCuaDriver({ mcp }).act({ 행동: 'set_value', 대상: { 창: 9, pid: 77, 토큰: 's1:26', 스냅샷: 's1' }, 값: 'ㄱ' });
  assert.ok(부른것.map((c) => c.이름).includes('set_value'), '요소가 있는데 키보드로 흘렸다');
});

// ── 눌러서 커서를 뒀으면, 키보드는 거기에 친다 ──────────────────────────
// 라이브(2026-08-06 · 진짜 마지막 조각). 모델이 좌표로 입력칸을 눌러 **커서를 뒀는데**,
// 그 다음 `type` 이 *"어디에 글자를 넣을지 안 짚으셨어요"* 로 막혔다.
// 사람은 그렇게 안 한다 — 누르고, 친다. **키보드는 요소를 짚지 않는다.**
// 규율은 안 느슨해진다: 대상 없는 입력은 무엇이 되는지 모르니 **언제나 카드를 거친다.**
test('대상 없이 치면 커서 자리에 친다 — 누르고 치는 것이 사람의 순서다', async () => {
  const 간것 = [];
  const 손 = makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: async () => ({ frontmost: { name: 'K' }, windows: [{ id: 9, pid: 77 }],
        본창: { id: 9, app: '카카오톡', title: 'n.BEAI', pid: 77 }, elements: [] }),
      act: (요청) => { 간것.push(요청); return { effect: 'confirmed' }; },
    }],
  });
  const r = await 손.handler({ action: 'type', app: 'KakaoTalk', 창제목: 'n.BEAI', 값: '오늘도 힘!' });
  assert.equal(간것.length, 1,
    `**눌러 놓고 못 친다** — 화면을 보고 눌렀는데 글자를 못 넣는다: ${r.userSafeSummary}`);
  assert.equal(간것[0]?.값, '오늘도 힘!');
});

test('대상 없는 입력은 언제나 카드를 거친다 — 커서가 어디 있는지 우리는 모른다', async () => {
  const kind = toolActionKind({
    toolId: 'desktop.act', args: { action: 'type', 값: 'ㄱ', 눌러본사실: { 찾음: false } },
  });
  assert.equal(kind, UNKNOWN_KIND, '**커서가 어디 있는지 모르는데 카드 없이 친다**');
});
