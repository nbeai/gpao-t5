// **F-53 봉인 — AX 트리가 비면 깊이 제한으로 다시 걷는다** (PM 승인 2026-08-09).
//
// 실측(오너 창): 카톡 목록에서 AX 전체 걷기가 20초 타임아웃으로 죽어 요소가 0~18개로만
// 보였고, 모델은 방 이름을 못 찾아 label 로 헛짚었다 — 두 달간 "방을 못 연다"의 정체다.
// 드라이버 원문이 길을 말해 줬다: *"re-call with a depth-limited scan (max_elements /
// max_depth)"*. 얕게 걸으니 같은 창에서 요소 11개 + 목표 행 토큰이 나왔고 방이 열렸다.
//
// **새 능력이 아니다** — 손이 이미 볼 수 있는 것을 못 보고 있었다(현실 공급).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';

const 실물창 = { window_id: 9, pid: 1048, app_name: '카카오톡', title: '카카오톡', is_on_screen: true, bounds: { x: 0, y: 0, width: 430, height: 664 } };

/** 전체 걷기는 죽거나 비고, 얕게 걸으면 살아나는 창 — 실물이 그랬다. */
function 타임아웃창({ 전체 = '터짐', 부른것 = [] } = {}) {
  const 방행 = { id: 'r5', element_token: 's1c:5', element_index: 5, role: 'AXTextArea', label: '넵 명심하겠습니다', bounds: { x: 1, y: 2, w: 3, h: 4 } };
  return {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [실물창] };
      if (이름 === 'get_accessibility_tree') return { apps: [{ pid: 1048, name: '카카오톡' }], windows: [실물창] };
      return {};
    },
    async 조각들() { return []; },
    async 구조와조각(이름, 인자 = {}) {
      부른것.push({ 이름, 인자 });
      if (이름 !== 'get_window_state') return { 구조: {}, 조각: [] };
      const 얕나 = Number(인자.max_depth) > 0 && Number(인자.max_elements) <= 60;
      if (얕나) return { 구조: { snapshot_id: 's1c', elements: [방행] }, 조각: [] };
      if (전체 === '터짐') throw new Error('AX tree walk for pid=1048 timed out after 20 s');
      return { 구조: { snapshot_id: 's1c', elements: [] }, 조각: [] };  // 비어서 옴
    },
  };
}
const 관찰 = (mcp) => makeCuaDriver({ mcp }).observe({ scope: 'window', app: '카카오톡' });

test('전체 걷기가 터지면 얕게 다시 걸어 요소를 살린다 — 모델이 토큰을 잡을 수 있다', async () => {
  const 부른것 = [];
  const r = await 관찰(타임아웃창({ 전체: '터짐', 부른것 }));
  const 요소들 = r?.elements ?? [];
  assert.ok(요소들.some((e) => String(e.label ?? '').includes('넵 명심하겠습니다')),
    `**얕게 안 걸었다** — 모델은 또 방을 못 연다: ${JSON.stringify(요소들).slice(0, 160)}`);
  assert.ok(요소들.some((e) => e.토큰 ?? e.element_token),
    '토큰이 안 실린다 — 이름으로만 짚게 되고 그게 F-53 의 그 자리다');
  // **못 읽었다고 말하지 않는다** — 얕게 걸어 읽었으면 읽은 것이다.
  assert.equal(r?.못읽은이유, undefined, `읽었는데 못 읽었다고 한다: ${r?.못읽은이유}`);
  assert.ok(Number.isFinite(r?.얕게걷기?.걸린ms), '폴백 지연 실측이 진단면에 없다(PM 조건)');
  const 얕은호출 = 부른것.filter((c) => c.이름 === 'get_window_state' && Number(c.인자?.max_depth) > 0);
  assert.equal(얕은호출.length, 1, `**한 번만 더 걷는다** — 두 번 걸으면 두 번 기다린다: ${얕은호출.length}`);
});

test('트리가 비어서 와도(예외 아님) 같은 폴백이 돈다 — "비었다"는 두 얼굴이다', async () => {
  const r = await 관찰(타임아웃창({ 전체: '빈배열' }));
  assert.ok((r?.elements ?? []).some((e) => String(e.label ?? '').includes('넵 명심')),
    '요소 0개로 온 창에서 폴백이 안 돌았다 — 타임아웃만 보면 절반만 고친 것이다');
});

test('반대시험: 트리가 정상이면 폴백을 안 탄다 — 멀쩡한 창을 두 번 걷지 않는다', async () => {
  const 부른것 = [];
  const 정상 = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [실물창] };
      if (이름 === 'get_accessibility_tree') return { apps: [{ pid: 1048, name: '카카오톡' }], windows: [실물창] };
      return {};
    },
    async 조각들() { return []; },
    async 구조와조각(이름, 인자 = {}) {
      부른것.push({ 이름, 인자 });
      return { 구조: { snapshot_id: 's1', elements: [{ id: 'a', element_token: 's1:1', role: 'AXButton', label: '9' }] }, 조각: [] };
    },
  };
  const r = await 관찰(정상);
  assert.equal(r?.얕게걷기, undefined, '멀쩡한 창인데 폴백이 돌았다 — 매 관찰마다 값을 두 번 치른다');
  assert.equal(부른것.filter((c) => Number(c.인자?.max_depth) > 0).length, 0, '얕은 재호출이 나갔다');
});
