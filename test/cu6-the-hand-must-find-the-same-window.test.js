// **보는 손이 찾은 창을 하는 손도 찾아야 한다.**
//
// 오너 계획서 ③ *"스크롤을 해서 이전 대화 내용도 살펴봐 줄 수 있는가"* 를 라이브로 재다가
// 손 자체에서 막혔다(2026-08-06):
// ```
// d.act({ 행동: 'scroll', 창제목: 'TNT', 값: 'up' })
//   → Error: Missing required integer field: pid
// ```
// `desktop.screen` 은 `창제목` 으로 창을 정확히 고른다(`정영현`·`TNT` — 사용자는 앱이 아니라
// **대화창 이름**을 말한다). 그런데 `act` 는 그 축을 **아예 안 본다**: `대상.창`·`대상.pid` 만
// 쓰고, 없으면 `앱고르기` 로 **앱 이름**만 찾는다.
//
// 카카오톡은 한 pid 가 창 열 개를 가진다. 앱만 찾아서는 어느 창인지 알 수 없고, 드라이버도
// 그래서 거절한다 — *"pid 4340 owns 6 other eligible top-level window(s) … could mutate a
// sibling window"*(`same_pid_keyboard_ambiguity`). **옳은 거절이다.**
//
// 스키마는 이미 약속하고 있었다: *"`desktop.screen` 에서 이걸로 골랐으면 여기에도 똑같이
// 줘라"*. 약속만 하고 안 지킨 것은 우리다. 두 손이 같은 축으로 창을 좁혀야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';

const 카톡창들 = [
  { window_id: 16045, app_name: '카카오톡', title: 'TNT(The Next Table)', pid: 4340, is_on_screen: true, z_index: 3, bounds: { x: 51, y: 97, width: 454, height: 773 } },
  { window_id: 16076, app_name: '카카오톡', title: '정영현', pid: 4340, is_on_screen: true, z_index: 2, bounds: { x: 600, y: 97, width: 454, height: 773 } },
  { window_id: 15579, app_name: '카카오톡', title: '카카오톡', pid: 4340, is_on_screen: true, z_index: 1, bounds: { x: 0, y: 0, width: 380, height: 700 } },
];

function 가짜(부른것 = []) {
  return {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: 카톡창들 };
      if (이름 === 'list_apps') return { apps: [{ name: '카카오톡', pid: 4340, running: true }] };
      if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: [] };
      if (이름 === 'scroll') {
        // 실물 계약 그대로: 셋 중 하나만 빠져도 안 굴러간다.
        if (!Number.isInteger(인자?.pid)) throw new Error('Missing required integer field: pid');
        if (!인자?.direction) throw new Error('Missing required string field: direction');
        return { effect: 'confirmed' };
      }
      return {};
    },
    async 조각들() { return []; },
    async 구조와조각(이름, 인자) { return { 구조: await this.call(이름, 인자), 조각: [] }; },
  };
}

test('창제목으로 스크롤할 수 있다 — 사용자는 앱이 아니라 대화창 이름을 말한다', async () => {
  const 부른것 = [];
  const d = makeCuaDriver({ mcp: 가짜(부른것) });
  await d.act({ 행동: 'scroll', 창제목: 'TNT', 값: 'up' });
  const s = 부른것.find((c) => c.이름 === 'scroll');
  assert.ok(s, `**스크롤을 아예 못 부른다**: ${JSON.stringify(부른것.map((c) => c.이름))}`);
  assert.equal(s.인자.pid, 4340, `**pid 를 못 싣는다** — 드라이버가 거절한다: ${JSON.stringify(s.인자)}`);
  assert.equal(s.인자.window_id, 16045,
    `**어느 창인지 안 싣는다** — 형제 창을 건드릴 수 있어 드라이버가 거절한다: ${JSON.stringify(s.인자)}`);
});

test('이전 대화는 위로 올리는 것이다 — 방향을 안 주면 아무 데도 안 간다', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜(부른것) }).act({ 행동: 'scroll', 창제목: 'TNT', 값: 'up' });
  assert.equal(부른것.find((c) => c.이름 === 'scroll').인자.direction, 'up');
});

test('창제목이 대상 안에 와도 같다 — 모델이 어디에 적든 같은 창에 닿는다', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜(부른것) })
    .act({ 행동: 'scroll', 대상: { 창제목: '정영현' }, 값: { 방향: 'up', 양: 3 } });
  const s = 부른것.find((c) => c.이름 === 'scroll');
  assert.equal(s.인자.window_id, 16076, `다른 창을 짚었다: ${JSON.stringify(s.인자)}`);
  assert.equal(s.인자.clicks, 3);
});

test('창 신분을 직접 주면 그것이 이긴다 — 찾은 것으로 덮어쓰지 않는다', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜(부른것) })
    .act({ 행동: 'scroll', 창제목: 'TNT', 대상: { 창: 16076, pid: 4340 }, 값: 'up' });
  assert.equal(부른것.find((c) => c.이름 === 'scroll').인자.window_id, 16076);
});

test('없는 창 이름이면 아무 창이나 건드리지 않는다', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜(부른것) })
    .act({ 행동: 'scroll', 창제목: '없는대화방', 값: 'up' }).catch(() => {});
  const s = 부른것.find((c) => c.이름 === 'scroll');
  assert.ok(!s || s.인자.window_id == null,
    `**엉뚱한 창을 스크롤한다**: ${JSON.stringify(s?.인자)}`);
});
