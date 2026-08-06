// **눈이 창의 일부만 보면 짚을 수가 없다.**
//
// 밟은 사실(2026-08-06 · 오너의 n.beai 과업). `zoom` 으로 창(559×859)을 찍었더니
// **500×707** 이 왔다 — 비율 0.707 vs 창 비율 0.651. **아래가 잘렸고 입력칸이 거기 있었다.**
// 요청 영역을 아래쪽으로 바꿔도(절대·상대 둘 다) 같은 위쪽만 왔다.
// 모델은 정확히 그렇게 말했다: *"입력창과 전송 버튼이 잘려 있어서 좌표로 짚을 수가 없어요."*
//
// 드라이버에 다른 눈이 있었다 — `get_desktop_state(screenshot_out_file)` 는 **화면 전체**를
// 파일로 낸다(실측 2940×1912, 논리 1470×956). 창이 다 안 담기면 그 눈으로 간다.
//
// **잘렸는지는 재서 안다**(비율 대조). 문구로 짐작하지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 잘렸나 } from '../src/runtime/desktop-cua-driver.js';

test('창 비율과 그림 비율이 다르면 잘린 것이다', () => {
  assert.equal(잘렸나({ w: 559, h: 859 }, { w: 500, h: 707 }), true,
    '**잘린 그림을 멀쩡하다고 본다** — 모델이 입력칸을 영영 못 본다');
});

test('비율이 맞으면 잘리지 않은 것이다 — 없던 벽을 만들지 않는다', () => {
  assert.equal(잘렸나({ w: 559, h: 859 }, { w: 500, h: 768 }), false);
  assert.equal(잘렸나({ w: 400, h: 800 }, { w: 400, h: 800 }), false);
});

test('잴 수 없으면 잘렸다고 하지 않는다 — 모르면 있던 길로 간다', () => {
  assert.equal(잘렸나(null, { w: 500, h: 707 }), false);
  assert.equal(잘렸나({ w: 559, h: 859 }, null), false);
});

// ── 못 담았으면 **못 담았다고 적는다** ──────────────────────────────────
// 오너 지침(2026-08-06):
// > *"T5 의 눈은 인간이 실제로 보는 눈과 같아야만 하는 게 아니잖아. 원격에서 텔레그램으로
// >  지시한다고 가정해보자고. 모니터에 뭐가 떠 있고 어떤 상황인지가 중요할까?
// >  핵심은 인간과 티파이브 사이의 머릿속 개념 이해인 거지."*
//
// 그래서 **화면 전체를 대신 밀어 넣지 않는다** — 오너의 다른 창이 다 담기고, 그건 지시
// 수행이 아니라 눈 흉내다. 못 담았으면 그 사실을 적고, 조작은 창을 대상으로 한다.
import { writeFileSync } from 'node:fs';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';

const 창 = { window_id: 9, app_name: '카카오톡', title: 'n.BEAI', pid: 77, is_on_screen: true, z_index: 1,
  bounds: { x: 82, y: 33, width: 559, height: 859 } };

function 가짜({ 부른것 = [], 잘린그림 = true } = {}) {
  return {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [창] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') return { elements: [] };
      return {};
    },
    async 조각들(이름, 인자) {
      부른것.push({ 이름, 인자, 조각: true });
      return [{ type: 'image', mimeType: 'image/jpeg', data: 'Q'.repeat(2000), width: 500, height: 잘린그림 ? 707 : 768 }];
    },
  };
}

test('창이 다 안 담겼으면 그 사실을 적는다 — 모델이 "왜 못 짚는지" 알아야 한다', async () => {
  const o = await makeCuaDriver({ mcp: 가짜({}) }).observe({ scope: 'window', 창제목: 'n.BEAI' });
  assert.match(String(o.못읽은이유 ?? ''), /다 안 담|잘/,
    `**잘린 그림을 멀쩡한 척 준다**: ${JSON.stringify(o).slice(0, 200)}`);
});

test('화면 전체를 대신 찍지 않는다 — 오너의 다른 창까지 모델에 가면 안 된다', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜({ 부른것 }) }).observe({ scope: 'window', 창제목: 'n.BEAI' });
  assert.equal(부른것.some((c) => c.이름 === 'get_desktop_state'), false,
    '**지시 수행이 아니라 눈 흉내다** — 화면 전체를 모델에 밀어 넣었다');
});

test('다 담겼으면 아무 말도 안 붙인다 — 없던 벽을 만들지 않는다', async () => {
  const o = await makeCuaDriver({ mcp: 가짜({ 잘린그림: false }) }).observe({ scope: 'window', 창제목: 'n.BEAI' });
  assert.ok(!/다 안 담/.test(String(o.못읽은이유 ?? '')));
});
