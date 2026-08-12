// **흡수 ① · 드라이버가 인자로 주는 것을 손으로 하지 않는다.**
//
// 오너 지적(2026-08-06): *"왜 어려운 길만 고집하냐. 흡수할 건 해야지."*
// 맞다. 오늘 헤맨 자리마다 **이미 인자가 있었다.**
//
//   내가 손으로 한 것                     드라이버가 주는 것
//   ─────────────────────────────────────────────────────────
//   안 보이는 창 걸러내기(20초 timeout)   `list_windows(on_screen_only: true)`
//   요소 129개를 40개씩 페이징            `get_window_state(query: …)`
//   트리가 커서 느림                      `max_depth`
//   앞뒤를 몰라 앞 창을 못 고름           `z_index`
//
// 실측(2026-08-06): `on_screen_only` 하나로 창 **117개 → 12개**, **103ms → 3ms**.
//
// 그리고 앱 매칭 순서도 비교군에서 가져온다(`_match_windows_for_app`):
//   **정확 일치가 부분 일치를 이긴다.** 창이름 정확 → 앱별칭 정확 → 창이름 부분 → 앱별칭 부분.
//   *"`Code` 를 물었는데 앞에 있다는 이유로 `Visual Studio Code` 가 잡히면 안 된다."*
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';

function 가짜({ 부른것 = [], 창들, 앱들 = [], 요소 = [] }) {
  return {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') {
        const ws = 인자?.on_screen_only ? 창들.filter((w) => w.is_on_screen !== false) : 창들;
        return { windows: ws };
      }
      if (이름 === 'list_apps') return { apps: 앱들 };
      if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: 요소 };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      return {};
    },
  };
}

const 창 = (id, app, title, 보임 = true, z = id) => ({
  window_id: id, app_name: app, title, pid: 100 + id, is_on_screen: 보임, z_index: z,
  bounds: { x: 0, y: 0, width: 100, height: 100 },
});

// ── 안 보이는 창은 드라이버가 거른다 ─────────────────────────────────────
test('창 목록은 보이는 것만 달라고 한다 — 손으로 거르지 않는다', async () => {
  const 부른것 = [];
  const d = makeCuaDriver({ mcp: 가짜({ 부른것, 창들: [창(1, 'A', 'a'), 창(2, 'B', 'b', false)] }) });
  await d.observe({ scope: 'screen' });
  const 부름 = 부른것.find((c) => c.이름 === 'list_windows');
  assert.equal(부름?.인자?.on_screen_only, true,
    `**전부 달라고 한다** — 117개를 받아 손으로 거르다 20초를 쓴다: ${JSON.stringify(부름?.인자)}`);
});

test('앱을 지목하면 안 보이는 창도 본다 — 사용자가 그 창을 말했다', async () => {
  const 부른것 = [];
  const d = makeCuaDriver({
    mcp: 가짜({ 부른것, 창들: [창(1, 'Claude', 'c'), 창(2, '카카오톡', '정영현', false)] }),
  });
  const o = await d.observe({ scope: 'window', app: '카카오톡' });
  assert.equal(o.본창?.id, 2,
    `**지목했는데 안 보인다고 버렸다** — 최소화된 창은 영영 못 본다: ${JSON.stringify(o.본창)}`);
});

// ── 앱 매칭 — 정확이 부분을 이긴다 ──────────────────────────────────────
test('창 이름 정확 일치가 부분 일치를 이긴다', async () => {
  const d = makeCuaDriver({
    mcp: 가짜({ 창들: [창(1, 'Visual Studio Code', 'vsc', true, 9), 창(2, 'Code', 'c', true, 1)] }),
  });
  const o = await d.observe({ scope: 'window', app: 'Code' });
  assert.equal(o.본창?.id, 2, `**앞에 있다는 이유로 엉뚱한 앱을 골랐다**: ${JSON.stringify(o.본창)}`);
});

test('창 이름으로 못 찾으면 앱 별칭(bundle id·앱 파일 이름)으로 찾는다', async () => {
  // **창 이름과 전혀 안 겹치는 이름**으로 물어야 별칭 경로를 실제로 탄다.
  // `KakaoTalk` 은 창 이름 `카카오톡` 과 부분 일치가 안 되므로 별칭이 유일한 길이다 —
  // 그런데 별칭 안에도 `kakaotalk`(앱 파일 이름)이 있어 부분 경로가 받쳐 준다.
  // 그물이 물게 하려면 **별칭 없이는 못 찾는 것**으로 재야 한다.
  const d = makeCuaDriver({
    mcp: 가짜({
      창들: [창(9, '카카오톡', '정영현')],
      앱들: [{ name: '카카오톡', bundle_id: 'com.kakao.KakaoTalkMac', pid: 109, launch_path: '/Applications/KakaoTalk.app', running: true }],
    }),
  });
  const o = await d.observe({ scope: 'window', app: 'com.kakao.KakaoTalkMac' });
  assert.equal(o.본창?.id, 9, '**bundle id 로는 못 찾는다** — 창 이름과 한 글자도 안 겹친다');
});

test('앱 목록은 필요할 때만 부른다 — 창 이름으로 찾으면 안 부른다', async () => {
  const 부른것 = [];
  const d = makeCuaDriver({ mcp: 가짜({ 부른것, 창들: [창(9, '카카오톡', '정영현')] }) });
  await d.observe({ scope: 'window', app: '카카오톡' });
  assert.equal(부른것.some((c) => c.이름 === 'list_apps'), false,
    '**매번 앱 목록을 훑는다** — 실측 472ms 짜리다');
});

// ── 찾기·깊이는 드라이버에게 맡긴다 ──────────────────────────────────────
test('창 안에서 찾을 때 query 를 넘긴다 — 40개씩 페이징하지 않는다', async () => {
  const 부른것 = [];
  const d = makeCuaDriver({ mcp: 가짜({ 부른것, 창들: [창(9, 'K', 'k')] }) });
  await d.observe({ scope: 'window', app: 'K', 찾는말: '정영현' });
  const 부름 = 부른것.find((c) => c.이름 === 'get_window_state');
  assert.equal(부름?.인자?.query, '정영현',
    `**찾기를 안 맡긴다** — 129개를 40개씩 넘겨보게 된다: ${JSON.stringify(부름?.인자)}`);
});

test('트리 깊이를 정할 수 있다 — 거대한 창에서 시간을 다 쓰지 않는다', async () => {
  const 부른것 = [];
  const d = makeCuaDriver({ mcp: 가짜({ 부른것, 창들: [창(9, 'K', 'k')] }) });
  await d.observe({ scope: 'window', app: 'K', 깊이: 8 });
  assert.equal(부른것.find((c) => c.이름 === 'get_window_state')?.인자?.max_depth, 8);
});
