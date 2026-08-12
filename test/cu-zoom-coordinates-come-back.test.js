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

async function 본자리(드라이버, x, y) {
  const 관측 = await 드라이버.observe({ scope: 'window', 창제목: 'n.BEAI' });
  return { 창: 9, pid: 77, x, y, 스냅샷: 관측.그림스냅샷 };
}

test('그림을 보고 짚은 좌표는 zoom 기준이라고 말한다 — 안 그러면 엉뚱한 데를 누른다', async () => {
  const 부른것 = [];
  const 드라이버 = makeCuaDriver({ mcp: 가짜(부른것) });
  await 드라이버.act({ 행동: 'click', 대상: await 본자리(드라이버, 250, 640) });
  const c = 부른것.find((x) => x.이름 === 'click');
  assert.equal(c?.인자?.from_zoom, true,
    `**zoom 그림 좌표를 창 좌표인 척 보낸다** — 드라이버가 딴 데를 누른다: ${JSON.stringify(c?.인자)}`);
  assert.equal(c?.인자?.x, 250, '좌표를 우리가 고쳐 보내면 안 된다 — 되돌리는 일은 드라이버가 한다');
});

// **`type_text` 는 `from_zoom` 을 안 받는다** — 인자 목록에 없다(실물 확인 2026-08-06:
// `delay_ms · delivery_mode · element_index · element_token · pid · scope · session ·
// snapshot_id · text · window_id · x · y`). 그래서 zoom 그림 좌표로 글자를 넣으려면
// **`click(from_zoom)` 이 커서를 두고, `type_text` 가 친다.** 그 순서가 아래 검사다.
test('글자 넣을 자리는 click 이 되돌린다 — type_text 는 그 자를 모른다', async () => {
  const 부른것 = [];
  const 드라이버 = makeCuaDriver({ mcp: 가짜(부른것) });
  await 드라이버.act({ 행동: 'set_value', 대상: await 본자리(드라이버, 250, 640), 값: 'ㄱ' });
  const 누름 = 부른것.find((x) => x.이름 === 'click');
  assert.equal(누름?.인자?.from_zoom, true, `**커서를 딴 자로 둔다**: ${JSON.stringify(누름?.인자)}`);
  const 침 = 부른것.find((x) => x.이름 === 'type_text');
  assert.equal(침?.인자?.from_zoom, undefined,
    `**계약에 없는 인자를 보낸다** — 드라이버가 거절한다: ${JSON.stringify(침?.인자)}`);
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

// ── 글자를 넣는다 = **눌러서 커서를 두고 친다** ─────────────────────────
// 밟은 사실(2026-08-06 · 마지막 조각). `focus → type → return` 을 다 실행했는데 화면에
// 아무 변화가 없었다. `type_text` 는 **커서가 있는 곳**에 치는데, 그 턴에 모델이 클릭을
// 건너뛰어 커서가 입력칸에 없었기 때문이다.
//
// 순서를 모델에게 맡기면 계속 틀린다. **한 손에 묶는다** — 사람이 하는 그대로다:
// 자리를 짚었으면 **눌러서 커서를 두고**, 그 다음 친다.
test('좌표로 글자를 넣으면 먼저 눌러 커서를 둔다 — 안 그러면 아무 데도 안 들어간다', async () => {
  const 부른것 = [];
  const 드라이버 = makeCuaDriver({ mcp: 가짜(부른것) });
  await 드라이버.act({ 행동: 'set_value', 대상: await 본자리(드라이버, 250, 640), 값: '오늘도 힘!' });
  const 순서 = 부른것.map((c) => c.이름).filter((n) => n === 'click' || n === 'type_text');
  assert.deepEqual(순서, ['click', 'type_text'],
    `**커서를 안 두고 친다** — "했어요"라고 하는데 화면은 그대로다: ${순서.join(' → ')}`);
  assert.equal(부른것.find((c) => c.이름 === 'click')?.인자?.x, 250, '누른 자리가 다르다');
});

test('요소를 짚었으면 누르지 않는다 — 값을 바로 놓는다', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜(부른것) })
    .act({ 행동: 'set_value', 대상: { 창: 9, pid: 77, 토큰: 's1:26', 스냅샷: 's1' }, 값: 'ㄱ' });
  assert.equal(부른것.some((c) => c.이름 === 'click'), false, '**값 놓기에 클릭을 끼워 넣었다**');
});

test('자리도 요소도 없으면 커서 자리에 친다 — 다만 어디인지 모른다고 남긴다', async () => {
  const 부른것 = [];
  const r = await makeCuaDriver({ mcp: 가짜(부른것) })
    .act({ 행동: 'set_value', 대상: { 창: 9, pid: 77 }, 값: 'ㄱ' });
  assert.equal(부른것.some((c) => c.이름 === 'click'), false);
  assert.equal(r?.커서자리, true, `**어디에 쳤는지 모르는데 아무 말이 없다**: ${JSON.stringify(r)}`);
});
