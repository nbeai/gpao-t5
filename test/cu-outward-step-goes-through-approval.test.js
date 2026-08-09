// **정직하게 밝히면 벌받는 구조를 끊는다.**
//
// 밟은 사실(라이브 2026-08-06 · F-42 마지막 칸). 모델이 전송 버튼을 누르려 하면서
// `기대.바깥으로: true` 라고 **정직하게 밝혔다.** 그러자:
//   · 승인 카드가 떴다(`KakaoTalk · 전송 누르기`) → 사용자가 허락했다
//   · 그런데 손이 다시 막았다 — *"그건 바깥으로 나가는 일이라 아직 제가 누르지 않아요."*
//
// **두 자리가 서로에게 미루고 있었다.** 손의 주석은 *"밝혔으면 승인 경계가 받는 자리"* 라 하고,
// 승인 경계는 `바깥으로` 를 **보지도 않는다**(카드가 뜬 건 값 없는 버튼이라 미상이었기 때문이다).
// 그래서 밝히면 영영 못 하고, **안 밝히면 그냥 나간다** — 정직함이 벌받는다.
//
// 정리: **`바깥으로` 는 승인을 부르는 신호다.** 승인 경계가 그걸 보고 반드시 카드를 띄우고,
// 허락이 났으면 손은 한다. 잠금은 한 자리에만 둔다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';
import { toolActionKind } from '../src/kernel/l2-plan/action-plan.js';
import { UNKNOWN_KIND, decideAutoGrant } from '../src/kernel/l2-plan/authority.js';

const 보내기 = {
  id: 's1:30', 토큰: 's1:30', 스냅샷: 's1', 번호: 30,
  role: 'AXButton', label: '전송', value: 'on', 창: 9, pid: 77, isEnabled: true,
};

const 손세우기 = (간것 = []) => makeDesktopActTool({
  drivers: [{
    id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
    observe: async () => ({
      frontmost: { name: 'K' }, windows: [{ id: 9, pid: 77 }],
      본창: { id: 9, app: '카카오톡', title: '박종윤', pid: 77 }, elements: [보내기],
    }),
    act: (요청) => { 간것.push(요청); return { ok: true, 확인됨: true, 근거: 'ok' }; },
    verify: async () => ({ 판정: 'satisfied' }),
  }],
});

// ── 승인 경계가 그 신호를 본다 ───────────────────────────────────────────
test('바깥으로 나가는 걸음은 값이 있어도 반드시 카드다 — 자동으로 안 흘린다', () => {
  const kind = toolActionKind({
    toolId: 'desktop.act',
    args: { action: 'click', 눌러본사실: { 찾음: true, 값있음: true }, 기대: { 바깥으로: true } },
  });
  // 계약 이행(F-58 · 2026-08-09): 바깥으로 나가는 걸음은 이제 **미상이 아니라 `send`** 다 —
  // 미상이면 헌장 ③ 의 조건(아는 상대엔 안 묻는다)에 닿지도 못해 화면 손만 매번 물었다
  // (사거리 비대칭병). 이 봉인이 지키는 것은 종류 이름이 아니라 **"카드 없이 안 나간다"** 이고,
  // `send` 도 새 상대면 반드시 카드다(counterpartKnown 이 없으면 decideAutoGrant 는 false).
  assert.equal(kind, 'send', `바깥으로 나가는 걸음이 전송으로 안 잡힌다: ${kind}`);
  assert.equal(decideAutoGrant({ kind, label: 'desktop.act' }), false,
    '**새 상대인데 자동으로 흘린다** — 헌장 ③ 붕괴');
  // 아는 상대일 때만 조용해진다(그 조건은 F-58 봉인이 따로 문다).
  assert.equal(decideAutoGrant({ kind, label: 'desktop.act', counterpartKnown: true }), true);
});

test('바깥이 아니면 예전 그대로다 — 없던 벽을 만들지 않는다', () => {
  assert.equal(
    toolActionKind({ toolId: 'desktop.act', args: { action: 'click', 눌러본사실: { 찾음: true, 값있음: true } } }),
    'organize',
  );
});

// ── 손은 다시 막지 않는다 ────────────────────────────────────────────────
test('허락이 난 뒤에는 손이 한다 — 카드를 띄워 놓고 안 하면 거짓 카드다', async () => {
  const 간것 = [];
  const r = await 손세우기(간것).handler({
    action: 'click', app: 'KakaoTalk', 창제목: '박종윤',
    대상: { id: 's1:30', label: '전송' },
    기대: { 요소: 's1:30', 값: 'on', 바깥으로: true },
  });
  assert.equal(간것.length, 1,
    `**승인까지 받고도 안 누른다** — 사용자는 허락했는데 아무 일도 안 난다: ${r.userSafeSummary}`);
  assert.notEqual(r.blocked, true);
});

test('밝힌 사실은 영수증에 남는다 — 조용히 나가지 않는다', async () => {
  const r = await 손세우기().handler({
    action: 'click', app: 'KakaoTalk',
    대상: { id: 's1:30', label: '전송' },
    기대: { 요소: 's1:30', 값: 'on', 바깥으로: true },
  });
  assert.equal(r.result?.바깥으로, true, `**바깥으로 나간 걸음인지 원장에 없다**: ${JSON.stringify(r.result)}`);
});

// ── 카드는 **무엇이 나가는지** 말해야 한다 ───────────────────────────────
// 라이브(2026-08-06)에서 전송 카드에 적힌 말은 **"화면 press_key"** 였다.
// 사용자는 그걸 보고 허락했는데, **무엇이 어디로 나가는지 한 글자도 없었다.**
// 이 저장소가 이미 싸운 병이다(*"화면 다루기 실행"* · *"실행 중인 것 실행"*) —
// **뜨는 것과 말이 되는 것은 다른 일이다.** 되돌릴 수 없는 걸음일수록 더 그렇다.
test('전송 카드는 무엇이 어디로 나가는지 말한다', () => {
  const 손 = makeDesktopActTool({ drivers: [] });
  const p = 손.previewOf({
    action: 'press_key', app: 'KakaoTalk', 창제목: '박종윤', 값: 'return',
    기대: { 값: 'F42 최종', 바깥으로: true },
  });
  assert.match(p.impact, /박종윤|KakaoTalk/, `**어디로 가는지 없다**: ${p.impact}`);
  assert.match(p.impact, /F42 최종/, `**무엇이 가는지 없다**: ${p.impact}`);
  assert.match(String(p.cancel), /되돌릴 수 없|취소할 수 없/,
    `**바깥으로 나가는데 되돌릴 수 있다고 말한다**: ${p.cancel}`);
});

test('키 누르기 카드도 어떤 키인지 말한다 — "화면 press_key"는 말이 아니다', () => {
  const p = makeDesktopActTool({ drivers: [] }).previewOf({ action: 'press_key', 값: 'escape' });
  assert.match(p.impact, /escape/, `**무슨 키인지 없다**: ${p.impact}`);
});

// ── 모델에게 가는 문장도 같이 바뀌어야 한다 ─────────────────────────────
// 라이브(2026-08-06 · 마지막 확인). 입력은 카드 없이 자동으로 됐는데 모델이
// **전송을 아예 시도하지 않고** *"아직 전송은 누르지 않은 상태입니다"* 로 끝냈다.
// 사용자는 *"보내줘"* 라고 했다. 손은 이미 할 수 있게 고쳤는데, **모델이 읽는 문장에는
// *"그건 아직 이 손이 하지 않는다"* 가 그대로 남아 있었다.**
// 계약을 바꾸면 **계약을 읽는 쪽 문장도 같이** 바꿔야 한다 — 안 그러면 손은 되는데 아무도 안 시킨다.
test('손이 할 수 있게 됐으면 모델도 그렇게 읽는다', async () => {
  const { demoDescriptors } = await import('../src/surface/demo-context.js');
  const 선언 = demoDescriptors({ desktopAct: { handler: async () => ({}) } })
    .find((t) => t.id === 'desktop.act');
  const 글 = JSON.stringify(선언 ?? {});
  assert.ok(!/아직 이 손이 하지 않는다/.test(글),
    '**손은 되는데 모델은 안 된다고 읽는다** — 사용자가 시켜도 아무 일이 안 난다');
  assert.match(글, /허락|승인|물어/,
    `**밝히면 어떻게 되는지 안 말한다** — 모델이 밝히기를 꺼린다: ${글.slice(0, 300)}`);
});

test('능력 선언도 같이 바뀐다 — "못 한다"고 적혀 있으면 모델은 시도조차 안 한다', async () => {
  const { demoDescriptors } = await import('../src/surface/demo-context.js');
  const 선언 = demoDescriptors({ desktopAct: { handler: async () => ({}) } })
    .find((t) => t.id === 'desktop.act');
  const 못하는것 = JSON.stringify(선언?.limits ?? []);
  assert.ok(!/바깥으로 나가는 클릭은 아직 하지 못한다/.test(못하는것),
    `**손은 되는데 "못 한다"고 선언한다** — 모델이 전송을 계획에 안 넣는다: ${못하는것}`);
});
