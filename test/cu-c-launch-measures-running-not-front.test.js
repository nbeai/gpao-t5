// **CU C 되돌아보기 — 재는 자리가 비어 있었다.**
//
// 라이브(2026-08-05) `계산기 켜줘` 한 마디에 T5 가 이렇게 답했다:
//   *"제가 앞쪽으로 가져오는 동작이 막혀 있어서 … 윤님이 Dock에서 한 번 더 눌러서 활성화하기"*
// **켜져 있는 앱을 두고 사용자에게 직접 하라고 떠넘겼다.** §0 이 깨지는 그 모양이다.
//
// 원장을 폈더니 둘 다 실패로 찍혀 있었다:
//   `launch Calculator` → "실행은 했는데 원하신 상태가 되지 않았어요"
//   `focus 계산기`      → "그 동작을 실행하지 못했어요"
//
// 드라이버에 직접 물어보니 **드라이버는 둘 다 잘 했다.** 우리 층이 틀렸다.
//
// ── 결함 ① 재는 자리가 아예 비어 있었다 ──────────────────────────────────
// `대조할값.launch` 는 `본것.apps` 의 개수를 셌는데 **`observe` 는 `apps` 를 주지 않는다.**
// 그 칸은 늘 `0` 이었다 — 전에도 0, 후에도 0. 그래서 판정은 옆에 있던 `frontmost` 로 갔고,
// **`launch` 를 "앞에 떴나"로 재게 됐다.**
//
// 그런데 cua 는 **일부러 앞으로 안 올린다**(`self_activation_suppressed: true`).
// 켜는 것과 앞에 두는 것은 다른 일이고, 그래서 켜기는 **영원히 실패로 찍힌다.**
// §4.3 그대로다 — **재는 자리를 먼저 검증하지 않으면 잰 값이 전부 거짓말이다.**
//
// ── 결함 ② 이름 축이 하나 빠졌다 ─────────────────────────────────────────
// `focus Calculator` 는 못 찾고 `focus 계산기` 만 찾았다. OS 표시 이름은 `계산기` 인데
// 사용자와 모델은 `Calculator` 라고 쓴다. 둘을 잇는 것은 **`launch_path` 의 파일 이름**
// (`/System/Applications/Calculator.app`)이다 — 추측이 아니라 기계 사실이다.
//
// 그리고 `.find()` 는 **여럿이면 앞엣것을 임의로 골랐다** — A02(같은 이름 → 임의 선택 0)가
// 바로 이 자리인데, 우리 손 안쪽에 그대로 남아 있었다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';

/** cua 가 실제로 주는 모양 그대로(라이브 실측 2026-08-05). */
const 계산기 = {
  name: '계산기', bundle_id: 'com.apple.calculator', pid: 43149, running: true,
  launch_path: '/System/Applications/Calculator.app',
};
const 클로드 = {
  name: 'Claude', bundle_id: 'com.anthropic.claudefordesktop', pid: 650, running: true,
  launch_path: '/Applications/Claude.app',
};

function 가짜cua(부른것, { apps = [계산기, 클로드], launch = null } = {}) {
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_apps') return { apps };
      if (이름 === 'launch_app') {
        return launch ?? {
          name: '계산기', pid: 43149, bundle_id: 'com.apple.calculator',
          // **켰지만 앞으로는 안 올린다** — cua 가 일부러 이렇게 한다.
          self_activation_suppressed: true,
          launch_state: { process_running: true, requested: true, window_ready: true },
        };
      }
      if (이름 === 'bring_to_front') return { activated: true, code: 'bring_to_front_exact_window_verified' };
      if (이름 === 'check_permissions') return { permissions: { accessibility: 'granted' } };
      return {};
    },
  };
  return makeCuaDriver({ mcp });
}

// ── ① 켜기는 "켜졌나"로 잰다 — "앞에 떴나"가 아니다 ───────────────────────
test('앱을 켰는데 앞으로 안 올라와도 성공이다 — cua 는 일부러 안 올린다', async () => {
  const 부른것 = [];
  const 손 = makeDesktopActTool({ drivers: [가짜cua(부른것)] });
  const r = await 손.handler({ action: 'launch', app: 'Calculator' });
  assert.notEqual(r.result?.단계, undefined, `실패로 왔다: ${JSON.stringify(r).slice(0, 200)}`);
  assert.equal(r.result.단계, 'goal_verified', '**켰는데 실패라고 한다** — 사용자가 직접 하라는 말을 듣는 그 자리다');
  assert.match(r.userSafeSummary, /켰|열었|실행/, `사용자 말이 이상하다: ${r.userSafeSummary}`);
});

test('켜기가 확인된 근거를 원장에 남긴다 — 무엇을 믿고 됐다고 하는지', async () => {
  const 손 = makeDesktopActTool({ drivers: [가짜cua([])] });
  const r = await 손.handler({ action: 'launch', app: 'Calculator' });
  assert.match(String(r.result.확인방법 ?? ''), /launch_state|드라이버 확인/, '근거 없는 성공이다');
});

test('켜기가 실제로 안 됐으면 성공이라 하지 않는다', async () => {
  // **꺼져 있는 앱**으로 잰다 — 켜져 있으면 켜는 일은 이미 끝난 일이라 이 길로 안 온다.
  const 손 = makeDesktopActTool({
    drivers: [가짜cua([], {
      apps: [{ ...계산기, running: false, pid: null }],
      launch: { name: 'X', launch_state: { process_running: false, window_ready: false } },
    })],
  });
  const r = await 손.handler({ action: 'launch', app: 'Calculator' });
  assert.notEqual(r.result?.단계, 'goal_verified', '**안 켜졌는데 켰다고 한다** — A14 가 겨눈 자리');
});

// ── ② 이름 축 — 사용자가 쓰는 이름과 OS 이름이 다르다 ─────────────────────
test('Calculator 로 불러도 계산기를 찾는다 — 둘을 잇는 것은 앱 파일 이름이다', async () => {
  const 부른것 = [];
  const 손 = makeDesktopActTool({ drivers: [가짜cua(부른것)] });
  const r = await 손.handler({ action: 'focus', app: 'Calculator' });
  assert.notEqual(r.failed, true, `**못 찾았다** — 라이브에서 난 그 자리다: ${JSON.stringify(r).slice(0, 200)}`);
  const 앞으로 = 부른것.find((c) => c.이름 === 'bring_to_front');
  assert.equal(앞으로?.인자?.pid, 43149, '엉뚱한 앱을 앞으로 띄웠다');
});

test('OS 이름 그대로 불러도 찾는다 — 있던 길이 안 막힌다', async () => {
  const 부른것 = [];
  const 손 = makeDesktopActTool({ drivers: [가짜cua(부른것)] });
  await 손.handler({ action: 'focus', app: '계산기' });
  assert.equal(부른것.find((c) => c.이름 === 'bring_to_front')?.인자?.pid, 43149);
});

test('bundle id 로 불러도 찾는다', async () => {
  const 부른것 = [];
  const 손 = makeDesktopActTool({ drivers: [가짜cua(부른것)] });
  await 손.handler({ action: 'focus', app: 'com.apple.calculator' });
  assert.equal(부른것.find((c) => c.이름 === 'bring_to_front')?.인자?.pid, 43149);
});

// ── ③ A02 — 여럿이면 임의로 안 고른다 ────────────────────────────────────
test('같은 이름 앱이 둘이면 임의로 고르지 않는다 — 부르지도 않는다', async () => {
  const 부른것 = [];
  const 둘 = [
    { name: '계산기', bundle_id: 'com.apple.calculator', pid: 1, launch_path: '/System/Applications/Calculator.app' },
    { name: '계산기', bundle_id: 'com.other.calc', pid: 2, launch_path: '/Applications/Calculator.app' },
  ];
  const 손 = makeDesktopActTool({ drivers: [가짜cua(부른것, { apps: 둘 })] });
  const r = await 손.handler({ action: 'focus', app: '계산기' });
  assert.equal(부른것.some((c) => c.이름 === 'bring_to_front'), false, '**둘 중 하나를 임의로 골라 띄웠다** — A02 위반');
  assert.equal(r.blocked, true, '고를 수 없다는 사실을 안 알렸다');
  assert.equal(r.후보?.length, 2, '후보를 안 줬다 — 사용자가 고를 수가 없다');
});

test('정확히 맞는 것이 하나면 부분 일치 여럿이 있어도 그것으로 간다', async () => {
  const 부른것 = [];
  const 앱들 = [
    { name: '메모', bundle_id: 'com.apple.Notes', pid: 7, launch_path: '/System/Applications/Notes.app' },
    { name: '메모 도우미', bundle_id: 'com.x.helper', pid: 8, launch_path: '/Applications/NotesHelper.app' },
  ];
  const 손 = makeDesktopActTool({ drivers: [가짜cua(부른것, { apps: 앱들 })] });
  await 손.handler({ action: 'focus', app: '메모' });
  assert.equal(부른것.find((c) => c.이름 === 'bring_to_front')?.인자?.pid, 7, '정확히 맞는 것을 두고 헤맸다');
});

// 계산기는 `com.apple.calculator` 라 **bundle id 만으로도** 우연히 이어진다.
// 그래서 앱 파일 이름 축이 진짜로 일하는지는 계산기로 증명되지 않는다(돌연변이가 잡았다).
// 이름·bundle id 어느 쪽으로도 안 이어지고 **앱 파일 이름으로만 이어지는** 경우로 잰다.
test('이름도 bundle id 도 안 걸리는 앱은 앱 파일 이름으로 찾는다', async () => {
  const 부른것 = [];
  const 한글 = {
    name: '한글', bundle_id: 'com.hancom.hoffice', pid: 55,
    launch_path: '/Applications/Hword.app',
  };
  const 손 = makeDesktopActTool({ drivers: [가짜cua(부른것, { apps: [한글, 클로드] })] });
  const r = await 손.handler({ action: 'focus', app: 'Hword' });
  assert.notEqual(r.failed, true, `**못 찾았다**: ${JSON.stringify(r).slice(0, 160)}`);
  assert.equal(부른것.find((c) => c.이름 === 'bring_to_front')?.인자?.pid, 55);
});

// ── 라이브 2차(2026-08-05) — 우리 층이 신분을 좁게 본다 ───────────────────
// `계산기 창 앞으로 띄우고, 그 창 안에서 7 버튼 눌러줘` 에서 셋이 실패했다:
//   `launch app:'계산기'`   → 실패. cua `launch_app` 은 **앱 파일 이름**을 받는데 표시 이름을 줬다.
//                             게다가 **이미 켜져 있었다** — 켜져 있으면 켜는 일은 이미 끝난 일이다.
//   `focus window:14213`   → 실패. **창 id 는 그 자체로 신분인데** 앱 이름이 없다고 거절했다.
//   `focus app:'계산기'`    → 안 보이는 창까지 후보로 줬다. 안 보이는 창을 앞으로 띄우라고
//                             고르게 하는 건 고를 수 있는 척하는 것이다.
// T5 가 못 한 게 아니라 **T5 가 안 한 것**이고, 사용자는 "Dock에서 직접 누르라"는 말을 들었다.

test('이미 켜져 있으면 켜는 일은 끝난 일이다 — 다시 켜지 않는다', async () => {
  const 부른것 = [];
  const 손 = makeDesktopActTool({ drivers: [가짜cua(부른것)] });
  const r = await 손.handler({ action: 'launch', app: '계산기' });
  assert.equal(r.result?.단계, 'goal_verified', `**켜져 있는데 실패라 한다**: ${JSON.stringify(r).slice(0, 180)}`);
  assert.equal(부른것.some((c) => c.이름 === 'launch_app'), false, '켜져 있는데 또 켰다');
});

test('안 켜져 있으면 앱 파일 이름으로 켠다 — 표시 이름으로는 cua 가 못 받는다', async () => {
  const 부른것 = [];
  const 꺼진계산기 = { ...계산기, running: false, pid: null };
  const 손 = makeDesktopActTool({ drivers: [가짜cua(부른것, { apps: [꺼진계산기, 클로드] })] });
  const r = await 손.handler({ action: 'launch', app: '계산기' });
  const 켠것 = 부른것.find((c) => c.이름 === 'launch_app');
  assert.equal(켠것?.인자?.name, 'Calculator', `표시 이름을 그대로 넘겼다: ${JSON.stringify(켠것?.인자)}`);
  // **켠 뒤 확인까지** 잰다 — 이 줄이 없으면 `launch_state` 로 확인하는 계약이 죽어도 안 물린다.
  assert.equal(r.result?.단계, 'goal_verified', `켰는데 실패라 한다: ${JSON.stringify(r).slice(0, 160)}`);
});

test('모르는 앱은 사용자가 말한 그대로 켜 본다 — 우리가 아는 것만 켤 수 있는 건 아니다', async () => {
  const 부른것 = [];
  const 손 = makeDesktopActTool({ drivers: [가짜cua(부른것, { apps: [클로드] })] });
  await 손.handler({ action: 'launch', app: 'Notion' });
  assert.equal(부른것.find((c) => c.이름 === 'launch_app')?.인자?.name, 'Notion');
});

test('창 id 만 줘도 앞으로 띄운다 — 창 id 는 그 자체로 신분이다', async () => {
  const 부른것 = [];
  const 손 = makeDesktopActTool({ drivers: [가짜cua(부른것)] });
  const r = await 손.handler({ action: 'focus', window: 14213 });
  assert.notEqual(r.failed, true, `**창 id 를 줬는데 앱을 못 찾았다고 거절한다**: ${JSON.stringify(r).slice(0, 160)}`);
  assert.equal(부른것.find((c) => c.이름 === 'bring_to_front')?.인자?.window_id, 14213);
});

test('안 보이는 창은 후보로 주지 않는다 — 고를 수 있는 척하지 않는다', async () => {
  const 부른것 = [];
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_apps') return { apps: [계산기, 클로드] };
      if (이름 === 'bring_to_front') {
        return { candidates: [
          { window_id: 1, app: '계산기', title: '계산기', visible: true },
          { window_id: 2, app: '계산기', title: '', visible: false },
          { window_id: 3, app: '계산기', title: '', visible: false },
        ] };
      }
      return {};
    },
  };
  const 손 = makeDesktopActTool({ drivers: [makeCuaDriver({ mcp })] });
  const r = await 손.handler({ action: 'focus', app: '계산기' });
  // 보이는 창이 하나뿐이면 고를 것이 없다 — 그것으로 간다.
  assert.notEqual(r.blocked, true, `**보이는 창이 하나인데 고르라고 한다**: ${JSON.stringify(r.후보)}`);
});

test('보이는 창이 여럿이면 그때는 고르게 한다', async () => {
  const mcp = {
    async call(이름) {
      if (이름 === 'list_apps') return { apps: [계산기, 클로드] };
      if (이름 === 'bring_to_front') {
        return { candidates: [
          { window_id: 1, app: '계산기', title: 'A', visible: true },
          { window_id: 2, app: '계산기', title: 'B', visible: true },
          { window_id: 3, app: '계산기', title: '', visible: false },
        ] };
      }
      return {};
    },
  };
  const 손 = makeDesktopActTool({ drivers: [makeCuaDriver({ mcp })] });
  const r = await 손.handler({ action: 'focus', app: '계산기' });
  assert.equal(r.blocked, true);
  assert.equal(r.후보.length, 2, '안 보이는 창까지 섞였다');
});

// ── 라이브 3차 — 확인해 준 것을 실패로 내지 않는다 ────────────────────────
// 앞의 고침이 길을 하나 더 만들었다(후보에서 하나 고르기). **거기에 확인 표식을 안 붙여서**
// 드라이버가 `activated:true` 로 확인해 준 focus 가 실패로 나갔다 — 내가 낸 회귀다.
// 그리고 `frontmost` 는 오버레이(Claude)를 가리켜서 우리 전후 대조로는 focus 를 영영 못 본다.
// **드라이버가 확인해 주는 것이 유일한 길**이라, 표식을 흘리면 그대로 거짓 실패가 된다.
test('후보에서 하나 골라 다시 부를 때도 확인 표식이 붙는다', async () => {
  let 몇번 = 0;
  const mcp = {
    async call(이름) {
      if (이름 === 'list_apps') return { apps: [계산기, 클로드] };
      if (이름 === 'bring_to_front') {
        몇번 += 1;
        // 첫 번째는 후보만, 두 번째(창 지정)에서 확인해 준다 — 실물이 이 모양이다.
        return 몇번 === 1
          ? { candidates: [{ window_id: 9, app: '계산기', title: '계산기', visible: true },
            { window_id: 10, app: '계산기', title: '', visible: false }] }
          : { activated: true, code: 'bring_to_front_exact_window_verified' };
      }
      return {};
    },
  };
  const 손 = makeDesktopActTool({ drivers: [makeCuaDriver({ mcp })] });
  const r = await 손.handler({ action: 'focus', app: '계산기' });
  assert.equal(r.result?.단계, 'goal_verified', `**드라이버가 확인해 줬는데 실패로 낸다**: ${JSON.stringify(r).slice(0, 180)}`);
});

test('창 id 만 줘도 그 창 주인의 pid 를 찾아 부른다 — cua 는 pid 를 반드시 받는다', async () => {
  const 부른것 = [];
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'get_accessibility_tree') return { windows: [{ id: 14213, app: '계산기', pid: 32079 }] };
      if (이름 === 'bring_to_front') return { activated: true, code: 'ok' };
      return {};
    },
  };
  const 손 = makeDesktopActTool({ drivers: [makeCuaDriver({ mcp })] });
  const r = await 손.handler({ action: 'focus', window: 14213 });
  assert.equal(r.result?.단계, 'goal_verified', JSON.stringify(r).slice(0, 160));
  assert.equal(부른것.find((c) => c.이름 === 'bring_to_front')?.인자?.pid, 32079, '**pid 없이 불러 거절당한다**');
});

test('"인자가 모자라다"는 답을 결과로 흘리지 않는다 — 없는 실패가 만들어진다', async () => {
  const mcp = {
    async call(이름) {
      if (이름 === 'list_apps') return { apps: [계산기] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'bring_to_front') return [{ type: 'text', text: 'Missing required integer field: pid' }];
      return {};
    },
  };
  const 손 = makeDesktopActTool({ drivers: [makeCuaDriver({ mcp })] });
  const r = await 손.handler({ action: 'focus', window: 99 });
  assert.notEqual(r.result?.단계, 'goal_verified', '**못 부른 것을 됐다고 한다**');
  assert.equal(r.진행?.판정, 'not_dispatched', `실행이 안 나간 것을 다르게 적었다: ${JSON.stringify(r.진행)}`);
});
