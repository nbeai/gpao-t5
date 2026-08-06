// **AX 로 못 읽으면 눈으로 본다.** (F-41 · 읽기의 마지막 조각)
//
// 오너의 네 질문 중 ②(내용 읽기)가 여기서 막혀 있다. 두 종류의 벽을 만났다:
//   · 메모 앱 — 본문을 **AX 로 아예 안 내놓는다**(1000개를 받아도 본문 0건)
//   · 카톡 대화창 — `get_window_state` 가 **20초를 넘겨 timeout**
// 둘 다 앞세우기(흡수 ③)로도 안 풀린다. **AX 가 답을 못 주는 대상이 있다.**
//
// 해법은 이미 우리 안에 있다. F-2 에서 `verify` 에 붙인 화면 증거를 **읽기에도** 붙인다.
// 커널은 그림을 읽지 않는다(심문 금지). **모델이 본다.**
//
// **어느 손으로 찍느냐는 실물이 정했다**(2026-08-06 실측, 카톡 창 13637/pid 4340):
//   `get_window_state(include_screenshot: true)`  20,114ms → **그림 없음**
//   `zoom(window_id, pid, x1..y2)`                 3,223ms → **image/jpeg 67,492B**
// 이유도 드라이버가 글로 말한다: *"AX tree walk for pid=4340 timed out after 20 s …
// then **act by pixel (x,y) off the screenshot** if the tree stays unusable."*
// `include_screenshot` 은 **트리 걷기와 한 몸이라 같이 죽는다.** 그래서 따로 찍는다.
//
// 규율은 F-2 와 같다: **AX 로 읽혔으면 그림을 안 받는다**(비용도 노출도 공짜가 아니다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';
import { makeDesktopTool } from '../src/runtime/desktop-tool.js';

const 창 = {
  window_id: 9, app_name: '카카오톡', title: '정영현', pid: 77,
  is_on_screen: true, z_index: 1, bounds: { x: 0, y: 0, width: 380, height: 675 },
};

function 가짜({ 부른것 = [], AX로읽힘 = false, 터짐 = false } = {}) {
  return {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [창] };
      if (이름 === 'get_accessibility_tree') return { windows: [], apps: [{ name: 'Claude', pid: 1, active: true }] };
      if (이름 === 'bring_to_front') return { activated: true };
      if (이름 === 'get_window_state') {
        if (터짐) throw new Error('timeout');
        return AX로읽힘
          ? { snapshot_id: 's1', elements: [{ element_token: 's1:1', role: 'AXTextArea', value: '대화 한 줄' }] }
          : { elements: [], degraded: true, degraded_reason: 'ax_window_unresolved' };
      }
      return {};
    },
    async 조각들(이름, 인자) {
      부른것.push({ 이름, 인자, 조각: true });
      // 실물 그대로 — 트리와 한 몸인 길은 그림을 못 낸다. 따로 찍는 길만 낸다.
      if (이름 !== 'zoom') return [{ type: 'text', text: 'AX tree walk timed out after 20 s.' }];
      return [{ type: 'image', mimeType: 'image/jpeg', data: 'PIXELS' }];
    },
  };
}

test('AX 로 못 읽으면 화면을 받아 온다 — 못 읽는 대상이 실제로 있다', async () => {
  const 부른것 = [];
  const o = await makeCuaDriver({ mcp: 가짜({ 부른것 }) }).observe({ scope: 'window', app: '카카오톡' });
  assert.equal(o.그림?.base64, 'PIXELS',
    `**AX 가 답을 못 주는데 눈도 안 쓴다** — 읽기가 영영 안 된다: ${JSON.stringify(o).slice(0, 200)}`);
  const 요청 = 부른것.find((c) => c.조각 && c.이름 === 'zoom');
  assert.ok(요청, `**트리와 한 몸인 길로만 찍으려 한다** — 20초 쓰고 빈손이다: ${부른것.filter((c) => c.조각).map((c) => c.이름).join(',')}`);
  // **창 좌상단 0,0 의 스크린샷 픽셀**로 찍는다(계약). 화면 절대 좌표를 주면 위쪽만 담긴다.
  // Retina 는 논리 크기의 2배이고, 넘치면 드라이버가 자른다.
  assert.deepEqual(
    [요청.인자.x1, 요청.인자.y1, 요청.인자.x2, 요청.인자.y2],
    [0, 0, 380 * 2, 675 * 2],
    `창 전체를 안 찍는다: ${JSON.stringify(요청.인자)}`,
  );
});

test('읽다가 터져도 화면은 받아 본다 — timeout 이 곧 실패가 아니다', async () => {
  const o = await makeCuaDriver({ mcp: 가짜({ 터짐: true }) }).observe({ scope: 'window', app: '카카오톡' });
  assert.equal(o.그림?.base64, 'PIXELS', `**터지면 그대로 포기한다**: ${JSON.stringify(o).slice(0, 160)}`);
});

test('AX 로 읽혔으면 화면을 안 받는다 — 비용도 노출도 공짜가 아니다', async () => {
  const 부른것 = [];
  const o = await makeCuaDriver({ mcp: 가짜({ 부른것, AX로읽힘: true }) }).observe({ scope: 'window', app: '카카오톡' });
  assert.equal((o.elements ?? []).length, 1);
  assert.equal(o.그림, undefined, '**잘 읽히는데 화면까지 받아 온다**');
  assert.equal(부른것.some((c) => c.조각), false);
});

// ── 손이 그림을 옆길로 넘긴다 (F-2 통로 그대로) ─────────────────────────
test('읽기의 그림도 영수증에 안 남는다 — 원장은 디스크로 간다', async () => {
  const 손 = makeDesktopTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({
        frontmost: { name: 'X' }, windows: [{ id: 9 }], 본창: { id: 9, app: '카카오톡' },
        elements: [], 못읽은이유: 'ax_window_unresolved',
        그림: { mime: 'image/png', base64: 'PIXELS' },
      }),
    }],
  });
  const r = await 손.handler({ action: 'observe', scope: 'window', app: '카카오톡' });
  assert.equal(r.그림?.base64, 'PIXELS', '**옆길이 없다** — 모델이 화면을 못 본다');
  assert.equal(JSON.stringify(r.result ?? {}).includes('PIXELS'), false,
    '**그림이 결과에 박혀 원장으로 간다**');
});

test('그림이 있으면 사용자 말도 달라진다 — "못 읽었다"로 끝내지 않는다', async () => {
  const 손 = makeDesktopTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({
        frontmost: { name: 'X' }, windows: [{ id: 9 }], 본창: { id: 9, app: '카카오톡' },
        elements: [], 못읽은이유: 'ax_window_unresolved',
        그림: { mime: 'image/png', base64: 'PIXELS' },
      }),
    }],
  });
  const r = await 손.handler({ action: 'observe', scope: 'window', app: '카카오톡' });
  assert.match(r.userSafeSummary, /화면|눈|보고/, `사용자 말이 그대로다: ${r.userSafeSummary}`);
});

test('화면도 못 찍는다고 이미 말했으면 그림을 시도하지 않는다 — 20초를 또 쓰지 않는다', async () => {
  const 부른것 = [];
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [창] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') {
        // 실물이 이렇게 답한다 — 트리도 비고 **스크린샷도 실패**했다고 함께 말한다.
        return {
          elements: [], degraded: true, degraded_reason: 'ax_window_unresolved',
          screenshot_error: { code: 'px_capture_unavailable' },
        };
      }
      return {};
    },
    async 조각들(이름, 인자) { 부른것.push({ 이름, 인자, 조각: true }); return []; },
  };
  const o = await makeCuaDriver({ mcp }).observe({ scope: 'window', app: '카카오톡' });
  assert.equal(부른것.some((c) => c.조각), false,
    '**못 찍는다고 했는데 또 찍어 본다** — 그 한 번이 20초다');
  assert.equal(o.그림, undefined);
  assert.match(String(o.못읽은이유 ?? ''), /px_capture_unavailable|ax_window_unresolved/);
});

// ── 그림을 건넸으면 말도 달라진다 (라이브 2026-08-06) ────────────────────
// 실물에서 그림은 붙었는데 **모델이 "못 읽었다"고 답했다.** 손이 붙인 말이
// 그대로 *"창 안에 글자 있는 것만 요소가 없어요"* 였기 때문이다 — 모델은 그 말을 따랐다.
// 그림을 건네 놓고 "못 읽었다"고 말하면 **건넨 적이 없는 것과 같다.**
test('그림을 건넸으면 이유가 없어도 화면을 보라고 말한다', async () => {
  const 손 = makeDesktopTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      // 이유 칸이 비어 있다 — 실물에서 호출이 통째로 터지면 이렇게 온다.
      observe: () => ({
        frontmost: { name: 'X' }, windows: [{ id: 9 }], 본창: { id: 9, app: '카카오톡' },
        elements: [], 그림: { mime: 'image/jpeg', base64: 'PIXELS' },
      }),
    }],
  });
  const r = await 손.handler({ action: 'observe', scope: 'window', app: '카카오톡', 글자만: true });
  assert.match(r.userSafeSummary, /화면을 보고/,
    `**그림을 주고도 "못 읽었다"고 말한다** — 모델은 그 말을 따른다: ${r.userSafeSummary}`);
});

test('읽기가 통째로 터지면 그 사실을 이유로 남긴다 — 조용한 0 이 아니다', async () => {
  const o = await makeCuaDriver({ mcp: 가짜({ 터짐: true }) }).observe({ scope: 'window', app: '카카오톡' });
  assert.ok(String(o.못읽은이유 ?? '').length > 0,
    '**왜 0개인지 아무 말이 없다** — 모델이 이유를 지어낸다');
});
