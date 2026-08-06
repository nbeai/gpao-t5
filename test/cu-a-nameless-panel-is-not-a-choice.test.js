// **이름 없는 판때기는 선택지가 아니다.**
//
// 배송(동봉본)을 실측하다 걸렸다 — *"계산기 화면에 지금 뭐라고 나와 있어?"* 에 T5 가
// 되물었다: *"지금 계산기 창이 여러 개 떠 있어서 어느 창을 봐야 할지 안 짚혀요."*
//
// 실물 창 목록은 이랬다:
// ```
// id=16172 제목="계산기"  230×408      ← 진짜 계산기
// id=16168 제목=""       1470×33      ← 메뉴바
// id=16170 제목=""       1470×33      ← 메뉴바
// id=16171 제목=""       1470×33
// id=16169 제목=""       1470×33
// ```
// A02(여럿이면 임의로 안 연다)는 **옳다** — 엉뚱한 대화를 읽고 사실로 말하는 것을 막는다.
// 그런데 여기 **여럿이 아니다.** 사용자가 말하는 창은 언제나 이름이 있는 창이고,
// 이름 없는 것은 메뉴바·팔레트·그림자다. 그걸 후보로 세워서 **하나뿐인 창을 못 골랐다.**
//
// 되묻기가 늘 규율 때문인 것은 아니다. 후보를 잘못 세우면 **규율이 옳게 작동해도 되묻는다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';

const 계산기창들 = [
  { window_id: 16172, app_name: '계산기', title: '계산기', pid: 900, is_on_screen: false, z_index: 171, bounds: { x: 431, y: 200, width: 230, height: 408 } },
  { window_id: 16168, app_name: '계산기', title: '', pid: 900, is_on_screen: false, z_index: 170, bounds: { x: 0, y: 0, width: 1470, height: 33 } },
  { window_id: 16170, app_name: '계산기', title: '', pid: 900, is_on_screen: false, z_index: 114, bounds: { x: 0, y: 0, width: 1470, height: 33 } },
  { window_id: 16171, app_name: '계산기', title: '', pid: 900, is_on_screen: false, z_index: 26, bounds: { x: 0, y: 0, width: 1470, height: 33 } },
];

function 가짜(창들, 부른것 = []) {
  return {
    부른것,
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: 창들 };
      if (이름 === 'list_apps') return { apps: [{ name: '계산기', pid: 900, running: true }] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: [] };
      return {};
    },
    async 조각들() { return []; },
    async 구조와조각(이름, 인자) { return { 구조: await this.call(이름, 인자), 조각: [] }; },
  };
}

test('이름 있는 창이 하나면 그것을 본다 — 메뉴바를 후보로 세워 되묻지 않는다', async () => {
  const o = await makeCuaDriver({ mcp: 가짜(계산기창들) }).observe({ scope: 'window', app: '계산기' });
  assert.equal(o.창을골라야함, undefined,
    `**메뉴바 때문에 되묻는다** — 계산기는 하나뿐이다: ${JSON.stringify(o.창을골라야함)}`);
  assert.equal(o.본창?.id, 16172, `엉뚱한 창을 봤다: ${JSON.stringify(o.본창)}`);
});

test('이름 있는 창이 여럿이면 여전히 되묻는다 — A02 를 무르지 않는다', async () => {
  const 카톡 = [
    { window_id: 1, app_name: '카카오톡', title: '정영현', pid: 4340, is_on_screen: true, z_index: 2, bounds: { x: 0, y: 0, width: 454, height: 773 } },
    { window_id: 2, app_name: '카카오톡', title: 'TNT', pid: 4340, is_on_screen: true, z_index: 1, bounds: { x: 0, y: 0, width: 454, height: 773 } },
    { window_id: 3, app_name: '카카오톡', title: '', pid: 4340, is_on_screen: true, z_index: 0, bounds: { x: 0, y: 0, width: 1470, height: 33 } },
  ];
  const o = await makeCuaDriver({ mcp: 가짜(카톡) }).observe({ scope: 'window', app: '카카오톡' });
  assert.equal((o.창을골라야함 ?? []).length, 2,
    `**후보가 틀렸다** — 이름 있는 둘만 물어야 한다: ${JSON.stringify(o.창을골라야함)}`);
});

test('이름 있는 창이 하나도 없으면 있는 것으로 본다 — 볼 수 있는 것을 안 버린다', async () => {
  const 이름없는것만 = [
    { window_id: 7, app_name: '어떤앱', title: '', pid: 5, is_on_screen: true, z_index: 1, bounds: { x: 0, y: 0, width: 600, height: 400 } },
  ];
  const o = await makeCuaDriver({ mcp: 가짜(이름없는것만) }).observe({ scope: 'window', app: '어떤앱' });
  assert.equal(o.본창?.id, 7, `**볼 수 있는 창을 버렸다**: ${JSON.stringify(o)}`);
});
