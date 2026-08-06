// **흡수 ④ · 마우스·키보드로 할 수 있는 모든 것.**
//
// 오너: *"실제 화면의 상황 인식, 버튼의 인식과 클릭, 스크롤의 인식과 크롤링, 읽기,
// 이동, 누르기, 입력등 **마우스와 키보드로 할 수 있는 모든 걸** 할 수 있어야 하는 것
// 아닌가? 사용자가 지시하면 **알아서 자동으로** 그것들을 수행해야 당연한 거잖아."*
//
// 지금 우리 손이 받는 것은 여덟(`focus·scroll·move·resize·launch·quit·click·type`).
// 비교군은 열넷이고, **없는 것이 사용자 일에 그대로 걸린다**:
//
//   `double_click`  파일 열기 · 단어 선택
//   `right_click`   맥락 메뉴 — GUI 조작의 절반이 여기 있다
//   `drag`          끌어놓기 · 범위 선택
//   `press_key`     Enter · Tab · Esc · 방향키 — **메시지 보내기가 이것이다**
//   `hotkey`        `cmd+s` · `cmd+c` — 앱마다 있는 표준 길
//   `invoke_menu`   앱 메뉴(파일→저장) — **가장 안정적인 조작 경로**
//   `clipboard`     복사·붙여넣기 — 읽기의 왕도
//   `wait`          뜨기를 기다림
//
// 드라이버에는 **이미 다 있다**(54개 손 중). 우리가 안 쓸 뿐이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';
import { toolActionKind } from '../src/kernel/l2-plan/action-plan.js';
import { UNKNOWN_KIND, decideAutoGrant } from '../src/kernel/l2-plan/authority.js';

const 버튼 = {
  id: 'b1', 토큰: 's1:1', 스냅샷: 's1', 번호: 1, role: 'AXButton', label: '보내기',
  isEnabled: true, 창: 9, pid: 77,
};

function 손세우기(부른것 = []) {
  return makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({ frontmost: { name: 'X' }, windows: [{ id: 9, pid: 77 }], elements: [버튼] }),
      act: (요청) => { 부른것.push(요청); return { ok: true, 확인됨: true, 근거: 'ok' }; },
      verify: async () => ({ 판정: 'satisfied' }),
    }],
  });
}

// ── 손이 그 행동들을 받는다 ─────────────────────────────────────────────
test('마우스·키보드 행동을 다 받는다 — 절반만 되면 컴퓨터 유즈가 아니다', async () => {
  const 없는것 = [];
  for (const [행동, args] of [
    ['double_click', { 대상: 버튼, 기대: { 요소: 'b1', 값: 'x' } }],
    ['right_click', { 대상: 버튼, 기대: { 요소: 'b1', 값: 'x' } }],
    ['drag', { 대상: 버튼, 값: { to_x: 10, to_y: 20 } }],
    ['press_key', { 값: 'return' }],
    ['hotkey', { 값: 'cmd+s' }],
    ['menu', { 값: ['파일', '저장'] }],
    ['copy', {}],
    ['paste', { 값: '붙일 글' }],
    ['wait', { 값: 1 }],
  ]) {
    const r = await 손세우기().handler({ action: 행동, ...args });
    if (String(r.userSafeSummary ?? '').includes('그건 아직')) 없는것.push(행동);
  }
  assert.deepEqual(없는것, [], `**손이 안 받는 행동**: ${없는것.join(' · ')}`);
});

test('키 누르기가 드라이버까지 간다 — 메시지 보내기가 이것이다', async () => {
  const 부른것 = [];
  await 손세우기(부른것).handler({ action: 'press_key', 값: 'return' });
  assert.equal(부른것[0]?.행동, 'press_key', `안 갔다: ${JSON.stringify(부른것)}`);
  assert.equal(부른것[0]?.값, 'return');
});

test('단축키가 조합 그대로 간다', async () => {
  const 부른것 = [];
  await 손세우기(부른것).handler({ action: 'hotkey', 값: 'cmd+s' });
  assert.equal(부른것[0]?.값, 'cmd+s');
});

// ── 드라이버가 실제 cua 손으로 옮긴다 ───────────────────────────────────
test('cua 손 이름으로 옮긴다 — 이름이 다르면 아무 일도 안 난다', async () => {
  const 부른것 = [];
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [{ window_id: 9, app_name: 'X', pid: 77, is_on_screen: true }] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'clipboard_read') return { text: '복사된 글' };
      return { ok: true };
    },
  };
  const d = makeCuaDriver({ mcp });
  await d.act({ 행동: 'double_click', 대상: { 토큰: 's1:1', 창: 9, pid: 77 } });
  await d.act({ 행동: 'right_click', 대상: { 토큰: 's1:1', 창: 9, pid: 77 } });
  await d.act({ 행동: 'press_key', 대상: { 창: 9, pid: 77 }, 값: 'return' });
  await d.act({ 행동: 'hotkey', 대상: { 창: 9, pid: 77 }, 값: 'cmd+s' });
  await d.act({ 행동: 'menu', 대상: { 창: 9, pid: 77 }, 값: ['파일', '저장'] });
  const 이름들 = 부른것.map((c) => c.이름);
  for (const n of ['double_click', 'right_click', 'press_key', 'hotkey', 'invoke_menu']) {
    assert.ok(이름들.includes(n), `**${n} 을 안 부른다**: ${이름들.join(' ')}`);
  }
});

test('복사한 글을 돌려준다 — 읽기의 왕도다', async () => {
  const mcp = {
    async call(이름) {
      if (이름 === 'list_windows') return { windows: [{ window_id: 9, app_name: 'X', pid: 77, is_on_screen: true }] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'clipboard_read') return { text: '복사된 글' };
      return { ok: true };
    },
  };
  const r = await makeCuaDriver({ mcp }).act({ 행동: 'copy', 대상: {} });
  assert.equal(r?.text, '복사된 글', `클립보드 내용이 안 온다: ${JSON.stringify(r)}`);
});

// ── 승인 경계 — 새 행동도 같은 규율을 탄다 ──────────────────────────────
test('새 행동도 되돌림으로 갈린다 — 아무거나 자동으로 흘리지 않는다', () => {
  // 기다리기·복사는 아무것도 안 바꾼다 → 자동.
  for (const a of ['wait', 'copy']) {
    assert.equal(toolActionKind({ toolId: 'desktop.act', args: { action: a } }), 'read', `${a} 가 자동이 아니다`);
  }
  // 누르기 계열은 무엇이 되는지 모른다 → 미상(승인).
  for (const a of ['double_click', 'right_click', 'press_key', 'hotkey', 'menu', 'paste', 'drag']) {
    const kind = toolActionKind({ toolId: 'desktop.act', args: { action: a } });
    assert.equal(kind, UNKNOWN_KIND, `**${a} 가 카드 없이 실행된다**`);
    assert.equal(decideAutoGrant({ kind, label: 'desktop.act' }), false);
  }
});

test('값 있는 요소를 누르는 것은 그대로 자동이다 — 카드가 늘지 않는다', () => {
  const kind = toolActionKind({
    toolId: 'desktop.act', args: { action: 'double_click', 눌러본사실: { 찾음: true, 값있음: true } },
  });
  assert.equal(kind, 'organize');
});

// ── 화면을 안 바꾸는 것은 전후로 재지 않는다 ────────────────────────────
// `copy`·`wait` 은 **안 바뀌는 것이 정상**이다. 전후 대조로 재면 늘 실패로 찍힌다 —
// 그건 A14 가 겨눈 "됐는데 안 됐다고 하는" 자리의 거울상이다.
// 그 둘은 **드라이버가 낸 답 자체가 결과**다(클립보드 글 · 기다린 초).
test('복사는 클립보드 글을 결과로 낸다 — "화면이 안 바뀌었다"고 하지 않는다', async () => {
  const 손 = makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({ frontmost: { name: 'X' }, windows: [{ id: 9 }], elements: [] }),
      act: () => ({ text: '복사된 글' }),
    }],
  });
  const r = await 손.handler({ action: 'copy' });
  assert.equal(r.result?.단계, 'goal_verified', `**안 바뀐 것을 실패로 본다**: ${JSON.stringify(r).slice(0, 160)}`);
  assert.equal(r.result?.글, '복사된 글', `클립보드 글이 결과에 없다: ${JSON.stringify(r.result)}`);
});

test('기다리기도 실패로 찍히지 않는다', async () => {
  const 손 = makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({ frontmost: { name: 'X' }, windows: [{ id: 9 }], elements: [] }),
      act: () => ({ ok: true, waited_s: 1 }),
    }],
  });
  const r = await 손.handler({ action: 'wait', 값: 1 });
  assert.equal(r.result?.단계, 'goal_verified');
});
