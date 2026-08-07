// **드라이버 확인은 한 자리에서, 한 규칙으로** (1단계 빼는 걸음 · 2026-08-08).
//
// 예전엔 focus(`activated`)·launch(`launch_state`)에만 특수 표식이 붙었고 move·resize 는
// 우리 전후 대조로 갔다 — 벤더는 `set_window_frame` 을 *"returns confirmed only after
// geometry readback"* 으로 이미 확인해 주는데, 우리 대조가 창 관리자보다 먼저 찍어
// 없는 실패를 만들었다(같은 병만 네 번). 0.14 행동 계약의 `effect` 를 한 자리에서 읽는다.
//
// 그리고 경계 하나 — **누르는 것(클릭·입력)은 이 문으로 안 나간다.** 계약 원문:
// *"These fields describe the actuator; they do not declare the user's task complete."*
// 누르기의 판정은 모델이 선언한 의미 효과(verify_state)다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';

function 가짜mcp(응답표, 부른것 = []) {
  return {
    부른것,
    async call(name, args) {
      부른것.push({ name, args });
      if (name === 'check_permissions') return { accessibility: true, screen_recording: true };
      if (name === 'list_apps') return { apps: [{ name: 'Finder', pid: 678, running: true }] };
      if (name === 'get_accessibility_tree') {
        return { apps: [{ name: 'Finder', pid: 678, active: true }], windows: [{ window_id: 1, pid: 678 }] };
      }
      if (name in 응답표) return 응답표[name];
      return {};
    },
    async 조각들() { return []; },
  };
}

test('창 기하를 드라이버가 확인해 주면(effect.confirmed) 그것이 판정이다', async () => {
  const d = makeCuaDriver({ mcp: 가짜mcp({ set_window_frame: { effect: 'confirmed', route: 'accessibility' } }) });
  const r = await d.act({ 행동: 'move', 대상: { app: 'Finder', 창: 1, pid: 678 }, 요청: { 값: { x: 0, y: 0, width: 400, height: 300 } } });
  assert.equal(r.확인됨, true, '벤더가 기하 readback 으로 확인한 것을 우리 대조가 다시 재러 간다');
  assert.equal(r.근거, 'effect.confirmed');
});

test('반대시험: unverifiable 은 확인이 아니다 — 표식이 안 붙는다', async () => {
  const d = makeCuaDriver({ mcp: 가짜mcp({ set_window_frame: { effect: 'unverifiable' } }) });
  const r = await d.act({ 행동: 'move', 대상: { app: 'Finder', 창: 1, pid: 678 }, 요청: { 값: { x: 0, y: 0 } } });
  assert.notEqual(r.확인됨, true, 'unverifiable 을 확인으로 승격하면 거짓 성공이다');
});

test('누르는 것은 이 문으로 안 나간다 — 액추에이터 confirmed 는 과업 완료가 아니다', async () => {
  const d = makeCuaDriver({ mcp: 가짜mcp({ click: { effect: 'confirmed', route: 'accessibility' } }) });
  const r = await d.act({ 행동: 'click', 대상: { app: 'Finder', 창: 1, pid: 678, 번호: 3 } });
  assert.notEqual(r.확인됨, true,
    '클릭의 effect.confirmed 는 값 readback(액추에이터)이지 모델이 선언한 의미 효과가 아니다 — verify_state 가 받는다');
});

test('launch 확인도 같은 자리에서 붙는다 — launch_state 특수 분기가 없어도 산다', async () => {
  const d = makeCuaDriver({ mcp: 가짜mcp({
    list_apps: { apps: [{ name: 'Calculator', launch_path: '/System/Applications/Calculator.app' }] },
    launch_app: { pid: 9, self_activation_suppressed: true, launch_state: { process_running: true } },
  }) });
  const r = await d.act({ 행동: 'launch', 대상: { app: 'Calculator' } });
  assert.equal(r.확인됨, true);
  assert.equal(r.근거, 'launch_state.process_running');
});
