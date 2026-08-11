// **쿠아 정본대로 화면 손을 고친다 — 대본 드라이버로 잰다.**
//
// ── 왜 대본인가 ─────────────────────────────────────────────────────────
// **라이브 금지다.** 오너가 그 컴퓨터에서 일하고 있고, 오늘 채점기가 화면을 계속 뺏어
// 질책받았다. 창을 앞으로 가져오는 시험을 여기서 돌리면 같은 사고가 난다.
// 그래서 **드라이버를 대본으로 깔고** 우리 층의 판정만 잰다 — 이 단위의 결함 넷은
// 전부 T5 배선이라 대본으로 다 걸린다.
//
// ── 무엇을 대조했나 ─────────────────────────────────────────────────────
// 정본은 이 기계에 있다: `/Users/jyp/.cua-driver/skills/cua-driver/`(SKILL.md 1019줄 등)와
// 읽기 전용 명령 `cua-driver describe <tool>` · `dump-docs`.
//
// ```
// describe bring_to_front
//   "With window_id, success means the exact ordinary macOS window was **independently
//    verified** as the focused window and first in WindowServer layer-0 order.
//    **Request acceptance alone is reported as a partial result, never as activation.**"
// SKILL.md:339
//   "After any action, keep using verify_state or **a fresh state snapshot for the actual
//    task postcondition**."
// SKILL.md (Read action facts)
//   "These fields describe **the actuator**; they do not declare the user's task complete."
// describe list_windows
//   "z_index (integer or null; **null means stacking order is unavailable and callers must
//    not infer one**) … To select a frontmost candidate, **take the maximum integer z_index**;
//    if every value is null, **use an explicit fallback instead of relying on array order**."
//   창마다 오는 것: window_id · pid · app_name · title · bounds · z_index · is_on_screen ·
//                 space_ids · current_space_id · on_current_space
// start_session / end_session
//   "call this (or pass session on your first action) to opt in … End it with end_session"
// ```
//
// `dump-docs` 전문 검색(213KB · 2026-08-11):
//   `exact_window_effect` **0건** · `focused_window_id` **0건** ·
//   `activated`(행동 결과 칸) **0건** — 유일한 1건은 browser 입력 설명문의 동사다.
// 우리는 그 없는 칸 둘을 **성공 칸으로 세워 두고** 있었다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';
import { makeDesktopTool } from '../src/runtime/desktop-tool.js';
import { makeCuaDriver, 맨앞앱 } from '../src/runtime/desktop-cua-driver.js';

const 클로드앱 = { name: 'Claude', bundle_id: 'com.anthropic.claudefordesktop', pid: 650, running: true };
const 카톡앱 = { name: '카카오톡', bundle_id: 'com.kakao.KakaoTalkMac', pid: 1048, running: true };

/**
 * **대본 드라이버.** 창 목록·앞뒤·`bring_to_front` 의 답을 판마다 갈아 끼운다.
 * 실물 모양 그대로다 — `list_windows` 가 무거운 축을 주고 `get_accessibility_tree` 는 가볍다.
 */
function 대본(설정 = {}) {
  const {
    apps = [클로드앱, 카톡앱],
    windows = [],
    앞으로답 = { effect: 'confirmed' },
    // 앞으로 띄운 **뒤에** 창 목록이 어떻게 되는가. 안 주면 **안 바뀐다**(그게 거짓 성공 판이다).
    앞으로띄운뒤 = null,
  } = 설정;
  const 부른것 = [];
  let 띄웠나 = false;
  const 지금창 = () => ((띄웠나 && 앞으로띄운뒤) ? 앞으로띄운뒤 : windows);
  const mcp = {
    부른것,
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'check_permissions') return { accessibility: true, screen_recording: true };
      if (이름 === 'list_apps') return { apps };
      if (이름 === 'list_windows') return { windows: 지금창() };
      // **실물처럼 `active` 를 안 준다.** `describe get_accessibility_tree` 에는 그 칸을
      // 보장한다는 문장이 없다 — 있다고 가정한 것은 우리였다.
      if (이름 === 'get_accessibility_tree') {
        return { apps: apps.map(({ active: _버림, ...나머지 }) => 나머지), windows: 지금창() };
      }
      if (이름 === 'get_window_state') return { snapshot_id: 'snap1', elements: [] };
      if (이름 === 'bring_to_front') { 띄웠나 = true; return 앞으로답; }
      return {};
    },
    async 조각들() { return []; },
    async 구조와조각() { return { 구조: { snapshot_id: 'snap1', elements: [] }, 조각: [] }; },
  };
  return { mcp, 부른것, 드라이버: makeCuaDriver({ mcp }) };
}

const 창 = (id, { pid = 1048, app = '카카오톡', title = '', z = null, 보임 = true, 같은화면 = true, b = null } = {}) => ({
  window_id: id, pid, app_name: app, title,
  z_index: z, is_on_screen: 보임, on_current_space: 같은화면,
  bounds: b ?? { x: 100, y: 100, width: 400, height: 300 },
});

// ═══════════════════════════════════════════════════════════════════════
// ① 「수락」을 「활성화」로 읽지 않는다
// ═══════════════════════════════════════════════════════════════════════

test('정본에 없는 칸(activated·exact_window_effect)으로 창 전환을 닫지 않는다', async () => {
  // 드라이버는 우리가 지어낸 두 칸을 주고, **앞 창은 안 바뀐다**(Claude 가 그대로 z 최대).
  const { 드라이버 } = 대본({
    앞으로답: { activated: true, exact_window_effect: { verified: true }, code: 'bring_to_front_exact_window_verified' },
    windows: [
      창(11, { pid: 650, app: 'Claude', title: 'Claude', z: 99 }),
      창(22, { title: '카카오톡', z: 3 }),
    ],
  });
  const 손 = makeDesktopActTool({ drivers: [드라이버] });
  const r = await 손.handler({ action: 'focus', app: '카카오톡' });
  assert.notEqual(r.result?.단계, 'goal_verified',
    `**전·후 frontmost 가 같은데 성공으로 닫았다** — 자기보고 거짓의 제조 자리다: ${JSON.stringify(r).slice(0, 300)}`);
  assert.doesNotMatch(String(r.userSafeSummary ?? ''), /앞으로 띄웠어요\.$/,
    `안 띄웠는데 띄웠다고 한다: ${r.userSafeSummary}`);
});

test('effect:partial 은 부분 결과다 — 정본이 "never as activation" 이라고 못박는다', async () => {
  const { 드라이버 } = 대본({
    앞으로답: { effect: 'partial', delivery: { delivered_count: 1 } },
    windows: [
      창(11, { pid: 650, app: 'Claude', title: 'Claude', z: 99 }),
      창(22, { title: '카카오톡', z: 3 }),
    ],
  });
  const r = await makeDesktopActTool({ drivers: [드라이버] }).handler({ action: 'focus', app: '카카오톡' });
  assert.notEqual(r.result?.단계, 'goal_verified', '수락을 활성화로 읽었다');
});

test('effect:confirmed 인데 재관측이 어긋나면 성공이 아니다 — 행동 뒤 상태를 다시 본다', async () => {
  // `SKILL.md:339` 가 시키는 그 재관측이다. 예전엔 후확인을 **찍고도 비교하지 않았다.**
  const { 드라이버 } = 대본({
    앞으로답: { effect: 'confirmed' },
    windows: [
      창(11, { pid: 650, app: 'Claude', title: 'Claude', z: 99 }),
      창(22, { title: '카카오톡', z: 3 }),
    ],
    // 앞으로띄운뒤 를 안 준다 = 앞 창이 그대로다
  });
  const r = await makeDesktopActTool({ drivers: [드라이버] }).handler({ action: 'focus', app: '카카오톡' });
  assert.notEqual(r.result?.단계, 'goal_verified',
    `드라이버 말만 믿고 닫았다 — 정본은 행동 뒤 상태 재관측을 요구한다: ${JSON.stringify(r).slice(0, 300)}`);
  assert.match(String(r.진행?.근거 ?? ''), /재관측/, '어느 층이 어긋났는지 원장에 안 남는다');
});

test('실제로 앞에 오면 성공이고, 재관측으로 확인했다고 적는다', async () => {
  const { 드라이버 } = 대본({
    앞으로답: { effect: 'confirmed' },
    windows: [
      창(11, { pid: 650, app: 'Claude', title: 'Claude', z: 99 }),
      창(22, { title: '카카오톡', z: 3 }),
    ],
    앞으로띄운뒤: [
      창(11, { pid: 650, app: 'Claude', title: 'Claude', z: 3 }),
      창(22, { title: '카카오톡', z: 99 }),
    ],
  });
  const r = await makeDesktopActTool({ drivers: [드라이버] }).handler({ action: 'focus', app: '카카오톡' });
  assert.equal(r.result?.단계, 'goal_verified', `됐는데 안 됐다고 한다: ${JSON.stringify(r).slice(0, 300)}`);
  assert.match(String(r.result.확인방법), /재관측/, '무엇으로 확인했는지가 원장에 없다');
});

// ── 반례: 좁히다가 「됐는데 안 됐다」를 만들지 않는다 ─────────────────────
// `desktop-act-tool.js` 의 `목표도달` 주석이 적어 둔 선례다 — 처음엔 전후가 같으면 무조건
// 실패로 냈고, **이미 앞에 있는 크롬**을 앞으로 띄워 달라는 요청에서 *"화면이 안 바뀌었어요"*
// 가 나갔다. ① 을 좁히면서 그 병을 되살리면 안 된다.
test('반례 — 이미 앞에 있는 창을 다시 focus 하면 성공이다(거짓 실패 금지)', async () => {
  const { 드라이버 } = 대본({
    앞으로답: { effect: 'confirmed' },
    // 카카오톡이 **처음부터** 맨 앞이고, 앞으로 띄워도 그대로다.
    windows: [
      창(22, { title: '카카오톡', z: 99 }),
      창(11, { pid: 650, app: 'Claude', title: 'Claude', z: 3 }),
    ],
  });
  const r = await makeDesktopActTool({ drivers: [드라이버] }).handler({ action: 'focus', app: '카카오톡' });
  assert.equal(r.result?.단계, 'goal_verified',
    `**됐는데 안 됐다고 한다** — 좁히다가 만든 거짓 실패다: ${JSON.stringify(r).slice(0, 300)}`);
});

test('반례 — 창 id 로 지목한 창이 이미 앞이면 성공이다', async () => {
  const { 드라이버 } = 대본({
    앞으로답: { effect: 'confirmed' },
    windows: [창(31, { z: 5 }), 창(32, { z: 99 }), 창(33, { z: 2 })],
  });
  const r = await makeDesktopActTool({ drivers: [드라이버] }).handler({ action: 'focus', window: 32 });
  assert.equal(r.result?.단계, 'goal_verified', `이미 앞인 창을 실패로 냈다: ${JSON.stringify(r).slice(0, 300)}`);
});

test('창 id 로 지목하면 그 창이 앞에 왔는지로 가른다 — 앱 이름보다 좁다', async () => {
  // 무제목 창 넷짜리 앱에서 이름 대조는 **엉뚱한 창이 앞에 와도 통과시킨다.**
  const { 드라이버 } = 대본({
    앞으로답: { effect: 'confirmed' },
    windows: [창(31, { z: 5 }), 창(32, { z: 9 }), 창(33, { z: 2 }), 창(34, { z: 1 })],
    앞으로띄운뒤: [창(31, { z: 5 }), 창(32, { z: 99 }), 창(33, { z: 2 }), 창(34, { z: 1 })],
  });
  // 33번을 띄워 달라고 했는데 앞에 온 것은 32번이다.
  const r = await makeDesktopActTool({ drivers: [드라이버] }).handler({ action: 'focus', window: 33 });
  assert.notEqual(r.result?.단계, 'goal_verified',
    `**다른 창이 앞에 왔는데 성공이라 한다**: ${JSON.stringify(r).slice(0, 300)}`);
});

// ═══════════════════════════════════════════════════════════════════════
// ② frontmost 는 최대 z_index 로 고른다 — 배열 순서는 정본이 금지한 폴백이다
// ═══════════════════════════════════════════════════════════════════════

test('active 가 하나도 없고 z 가 뒤죽박죽이면 최대 z 의 앱이 앞이다', async () => {
  const { 드라이버 } = 대본({
    // 배열 순서로는 Claude 가 먼저다. z 로는 카카오톡이 앞이다.
    windows: [
      창(11, { pid: 650, app: 'Claude', title: 'Claude', z: 3 }),
      창(22, { title: '카카오톡', z: 77 }),
      창(33, { pid: 650, app: 'Claude', title: 'Claude 2', z: 12 }),
    ],
  });
  const 본것 = await 드라이버.observe({ scope: 'screen' });
  assert.equal(본것.frontmost?.name, '카카오톡',
    `**배열 순서 폴백이 살아 있다** — 정본이 정확히 금지한 자리다: ${JSON.stringify(본것.frontmost)}`);
  assert.equal(본것.frontmost?.pid, 1048, 'pid 도 최대 z 창 것이어야 한다');
});

test('z 가 전부 null 이면 배열 첫째를 앞이라고 하지 않는다 — 모르면 모른다', () => {
  // 정본: "null means stacking order is unavailable and **callers must not infer one**."
  const 앞 = 맨앞앱(
    [{ 층: null, pid: 650, app: 'Claude' }, { 층: null, pid: 1048, app: '카카오톡' }],
    [{ name: 'Claude', pid: 650 }, { name: '카카오톡', pid: 1048 }],
  );
  assert.equal(앞, null, `**z 를 모르는데 앞 창을 지어냈다**: ${JSON.stringify(앞)}`);
});

test('z 가 전부 null 이어도 드라이버가 active 를 밝히면 그것은 쓴다 — 명시적 폴백', () => {
  const 앞 = 맨앞앱(
    [{ 층: null, pid: 650 }, { 층: null, pid: 1048 }],
    [{ name: 'Claude', pid: 650 }, { name: '카카오톡', pid: 1048, active: true }],
  );
  assert.equal(앞?.name, '카카오톡');
});

// ═══════════════════════════════════════════════════════════════════════
// ③ 후보에 가를 축을 싣는다 — 무제목 창 넷을 고를 수 있게
// ═══════════════════════════════════════════════════════════════════════

const 무제목넷 = [
  창(41, { z: 9, b: { x: 0, y: 0, width: 1470, height: 33 } }),
  창(42, { z: 7, b: { x: 200, y: 120, width: 420, height: 780 } }),
  창(43, { z: 5, b: { x: 660, y: 120, width: 900, height: 700 } }),
  창(44, { z: 1, 같은화면: false, b: { x: 40, y: 40, width: 300, height: 200 } }),
];

test('무제목 창 넷이면 후보에 bounds·z·보임·같은화면을 함께 싣는다', async () => {
  const { 드라이버 } = 대본({ windows: 무제목넷 });
  const 본것 = await 드라이버.observe({ scope: 'window', app: '카카오톡' });
  const 후보 = 본것.창을골라야함 ?? [];
  assert.equal(후보.length, 4, `후보가 안 왔다: ${JSON.stringify(본것).slice(0, 200)}`);
  for (const c of 후보) {
    assert.ok(c.bounds && Number.isFinite(Number(c.bounds.w)), `bounds 가 없다: ${JSON.stringify(c)}`);
    assert.ok(Number.isFinite(c.층), `z_index 가 없다: ${JSON.stringify(c)}`);
    assert.equal(typeof c.보임, 'boolean', `is_on_screen 이 없다: ${JSON.stringify(c)}`);
  }
  assert.equal(후보.find((c) => c.window === 44)?.같은화면, false, 'on_current_space 를 안 실었다');
});

test('모델이 읽는 문장에 축이 들어간다 — 「카카오톡 · (제목 없음)」 ×4 가 아니다', async () => {
  const { 드라이버 } = 대본({ windows: 무제목넷 });
  const 손 = makeDesktopTool({ drivers: [드라이버] });
  const r = await 손.handler({ scope: 'window', app: '카카오톡' });
  const 말 = String(r.userSafeSummary ?? '');
  assert.match(말, /1470×33/, `크기가 문장에 없다 — 넷이 똑같아 보인다: ${말}`);
  assert.match(말, /z9|z7|z5|z1/, `앞뒤가 문장에 없다: ${말}`);
  const 길 = r.result?.다음수단 ?? [];
  assert.equal(길.length, 4, `길이 넷이 아니다: ${JSON.stringify(길)}`);
  // **제목이 없으면 `창제목` 은 손잡이가 못 된다.** 창 id 를 줘야 모델이 다시 부를 수 있다.
  for (const g of 길) assert.ok(Number.isFinite(Number(g.window)), `창 id 를 안 줬다: ${JSON.stringify(g)}`);
  const 서로다름 = new Set(길.map((g) => g.왜));
  assert.equal(서로다름.size, 4, `**넷이 같은 문장이다 — 고를 수가 없다**: ${JSON.stringify([...서로다름])}`);
});

test('focus 되묻기 후보도 같은 축을 싣고, 다른 화면(Space)의 창은 안 권한다', async () => {
  const { 드라이버 } = 대본({
    windows: 무제목넷,
    // 드라이버가 문서에 없는 `candidates` 로 되묻는 판(실물 2026-08-05 Finder).
    앞으로답: { candidates: [{ window_id: 42 }, { window_id: 43 }, { window_id: 44 }] },
  });
  const r = await makeDesktopActTool({ drivers: [드라이버] }).handler({ action: 'focus', app: '카카오톡', window: 0 });
  const 후보 = r.후보 ?? [];
  assert.ok(후보.length >= 2, `되묻기가 안 왔다: ${JSON.stringify(r).slice(0, 300)}`);
  assert.ok(!후보.some((c) => c.window === 44), '**다른 화면에 있는 창을 후보로 준다** — 앞세우면 화면이 통째로 바뀐다');
  for (const c of 후보) assert.ok(c.bounds, `후보에 자리가 없다: ${JSON.stringify(c)}`);
  const 길 = r.다음수단 ?? [];
  assert.equal(new Set(길.map((g) => g.왜)).size, 길.length, '길 문장이 서로 같다 — 고를 수가 없다');
});

// ═══════════════════════════════════════════════════════════════════════
// ④ 세션을 명시적으로 열고 닫는다
// ═══════════════════════════════════════════════════════════════════════

test('브라우저에 붙기 전에 세션을 선언하고, 닫을 때 끝낸다', async () => {
  const 크롬창 = 창(51, { pid: 900, app: 'Google Chrome', title: '새 탭', z: 9 });
  const { mcp, 부른것 } = 대본({ apps: [{ name: 'Google Chrome', pid: 900, running: true }], windows: [크롬창] });
  const 드라이버 = makeCuaDriver({ mcp, 기존프로필허용: true });
  await 드라이버.observe({ scope: 'window', app: 'Google Chrome' });

  const 연것 = 부른것.findIndex((c) => c.이름 === 'start_session');
  const 붙인것 = 부른것.findIndex((c) => c.이름 === 'browser_prepare');
  assert.ok(연것 >= 0, `**start_session 을 한 번도 안 부른다** — 암묵 생성만 하고 있었다: ${JSON.stringify(부른것.map((c) => c.이름))}`);
  assert.ok(연것 < 붙인것, '세션을 선언하기 전에 붙었다 — 정본 순서는 start_session → 작업 → end_session 이다');
  assert.equal(부른것[연것].인자?.capture_scope, 'auto', 'capture_scope 를 우리가 안 골랐다');
  assert.equal(부른것[연것].인자?.session, 'gpao-t5', '세션 이름이 브라우저 호출과 달라지면 다른 세션이 된다');

  await 드라이버.close();
  const 닫은것 = 부른것.filter((c) => c.이름 === 'end_session');
  assert.equal(닫은것.length, 1, `**아무도 세션을 안 끝낸다** — idle-TTL 이 회수할 때까지 커서·설정이 남는다: ${닫은것.length}`);
  assert.equal(닫은것[0].인자?.session, 'gpao-t5');
});

test('세션을 안 연 드라이버는 end_session 을 부르지 않는다 — 없는 것을 닫지 않는다', async () => {
  const { mcp, 부른것, 드라이버 } = 대본({ windows: [창(61, { z: 1 })] });
  await 드라이버.observe({ scope: 'screen' });
  await 드라이버.close();
  assert.equal(부른것.filter((c) => c.이름 === 'end_session').length, 0);
  assert.equal(mcp.부른것.filter((c) => c.이름 === 'start_session').length, 0,
    '브라우저를 안 쓰는데 세션을 열면 다른 호출들이 스코프 심사를 받게 된다 — 지금 되는 것이 막힌다');
});
