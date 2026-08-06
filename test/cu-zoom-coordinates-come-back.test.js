// **좌표계는 실험으로 알아낼 게 아니라 계약에 적혀 있었다.**
//
// 오너 지적(2026-08-06): *"쿠아가 깃허브에서 사랑받는 이유가 있을 거야. 사용자들이 왜
// 좋아하는지, 개발자는 왜 개발했는지를 알면 우리가 어떻게 활용해야 하는지 방향이 잡히지 않을까?"*
//
// 읽었더니 오늘 하루 헤맨 것이 전부 `click` 도구 설명에 적혀 있었다:
//
//   `x, y` — *"**window-local screenshot pixels**, top-left origin of the PNG returned by
//     get_window_state … the pixel you read **IS** the pixel that gets clicked; no scaling math."*
//   `zoom` — *"cropped JPEG … with **20% padding** added on each side. The output image is
//     **at most 500 px wide**."*
//   `from_zoom` — *"set true after a zoom call to **auto-translate zoom-image pixel coordinates**
//     to full-window space."*
//
// 그래서 두 가지가 틀렸다:
//   ① 559×859 창이 500×707 로 온 것은 **잘린 게 아니라 패딩+축소**다. 내 `잘렸나` 는 틀린 자다.
//   ② 우리가 주는 그림은 **언제나 zoom 산출물**이다. 모델이 그 그림을 보고 말하는 좌표는
//      zoom 이미지 좌표이므로 **`from_zoom: true`** 로 보내야 그 자리가 눌린다.
//      안 붙이면 드라이버가 창 좌표로 읽어 **엉뚱한 데를 누른다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';

const 창 = { window_id: 9, app_name: '카카오톡', title: 'n.BEAI', pid: 77, is_on_screen: true, z_index: 1,
  bounds: { x: 82, y: 33, width: 559, height: 859 } };

function 가짜(부른것 = []) {
  return {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [창] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') return { elements: [] };
      return { effect: 'confirmed' };
    },
    async 조각들() { return [{ type: 'image', mimeType: 'image/jpeg', data: 'Q'.repeat(2000), width: 500, height: 707 }]; },
  };
}

test('그림을 보고 짚은 좌표는 zoom 기준이라고 말한다 — 안 그러면 엉뚱한 데를 누른다', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜(부른것) }).act({ 행동: 'click', 대상: { 창: 9, pid: 77, x: 250, y: 640 } });
  const c = 부른것.find((x) => x.이름 === 'click');
  assert.equal(c?.인자?.from_zoom, true,
    `**zoom 그림 좌표를 창 좌표인 척 보낸다** — 드라이버가 딴 데를 누른다: ${JSON.stringify(c?.인자)}`);
  assert.equal(c?.인자?.x, 250, '좌표를 우리가 고쳐 보내면 안 된다 — 되돌리는 일은 드라이버가 한다');
});

test('글자 넣기도 같은 자를 쓴다', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜(부른것) })
    .act({ 행동: 'set_value', 대상: { 창: 9, pid: 77, x: 250, y: 640 }, 값: 'ㄱ' });
  const c = 부른것.find((x) => x.이름 === 'type_text');
  assert.equal(c?.인자?.from_zoom, true, `**입력 자리만 딴 자를 쓴다**: ${JSON.stringify(c?.인자)}`);
});

test('토큰으로 짚으면 그 말을 안 붙인다 — 좌표를 안 쓰니까', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜(부른것) }).act({ 행동: 'click', 대상: { 창: 9, pid: 77, 토큰: 's1:5', 스냅샷: 's1' } });
  const c = 부른것.find((x) => x.이름 === 'click');
  assert.equal(c?.인자?.from_zoom, undefined, `**안 쓰는 말을 붙인다**: ${JSON.stringify(c?.인자)}`);
});

test('패딩+축소는 잘린 것이 아니다 — 틀린 자로 "못 담았다"고 하지 않는다', async () => {
  const o = await makeCuaDriver({ mcp: 가짜([]) }).observe({ scope: 'window', 창제목: 'n.BEAI' });
  assert.ok(!/다 안 담|잘/.test(String(o.못읽은이유 ?? '')),
    `**zoom 계약(20% 패딩 · 최대 500px)을 잘림으로 오해한다**: ${o.못읽은이유}`);
});

// ── zoom 에 주는 좌표도 **창 스크린샷 픽셀**이다 ────────────────────────
// 계약: *"Capture a cropped JPEG of a window region (x1,y1)–(x2,y2) **in screenshot pixel
// coordinates**"* — 화면 절대 좌표가 아니다. 창 좌상단이 0,0 이고 Retina 는 2배다.
//
// 밟은 사실(2026-08-06). 화면 절대 좌표(x82 y33 ~ x641 y892)를 줬더니 **창 위쪽만** 왔다
// (500×707, 비율 0.707 ≠ 창 0.651). 창 픽셀(0,0 ~ w*2,h*2)로 주니 **500×768** — 창 비율과
// 정확히 일치하고 **입력칸과 전송 버튼까지** 담겼다.
//
// 이 하나 때문에 모델은 입력칸이 안 보이는 그림을 받고 **추측으로 좌표를 짚었다.**
test('zoom 은 창 좌상단 0,0 의 스크린샷 픽셀로 요청한다 — 화면 절대 좌표가 아니다', async () => {
  const 부른것 = [];
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [창] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') return { elements: [] };
      return {};
    },
    async 조각들(이름, 인자) {
      부른것.push({ 이름, 인자, 조각: true });
      return [{ type: 'image', mimeType: 'image/jpeg', data: 'Q'.repeat(2000), width: 500, height: 768 }];
    },
  };
  await makeCuaDriver({ mcp }).observe({ scope: 'window', 창제목: 'n.BEAI' });
  const z = 부른것.find((c) => c.이름 === 'zoom');
  assert.equal(z?.인자?.x1, 0, `**화면 절대 좌표를 준다** — 창 위쪽만 담긴다: ${JSON.stringify(z?.인자)}`);
  assert.equal(z?.인자?.y1, 0);
  // 창 논리 559×859 → 스크린샷 픽셀은 그 2배(Retina). 넘치면 드라이버가 자른다.
  assert.equal(z?.인자?.x2, 559 * 2, `창 전체를 요청하지 않는다: ${JSON.stringify(z?.인자)}`);
  assert.equal(z?.인자?.y2, 859 * 2);
});
