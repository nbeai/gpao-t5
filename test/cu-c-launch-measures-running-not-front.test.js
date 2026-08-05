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
  const 손 = makeDesktopActTool({
    drivers: [가짜cua([], { launch: { name: 'X', launch_state: { process_running: false, window_ready: false } } })],
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
