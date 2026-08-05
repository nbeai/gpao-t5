// **CU C — 첫 손. 눌렀는지가 아니라 됐는지로 판정한다.**
//
// 닫는 문장(계획 §5): *"그 창 앞으로 띄워줘"* → 뜨고, **frontmost 값이 그 말을 뒷받침한다.**
//
// ── 왜 클릭이 아니라 이 넷인가 ──────────────────────────────────────────
// 계획 §5.1 이 첫 손을 **창 앞으로 띄우기·스크롤·창 옮기기·앱 켜고 끄기** 넷으로 잘랐다.
// 클릭·타이핑을 **일부러 뺐다.** 이유는 하나다 —
//
// 반대시험 **A14**(*"event dispatch 성공, 화면 변화 없음 → 성공 영수증 0"*)가 CU 에서 가장
// 어려운 요구인데 **화면은 대조 기준이 없다**(시계·애니메이션으로 늘 조금씩 변한다).
// 그런데 저 넷은 대조가 자명하다 — frontmost 값 · 스크롤 위치 · 창 좌표 · 프로세스 존재.
//
// **가장 어려운 계약을 가장 쉬운 대상에서 먼저 세운다.** 여기서 A14 가 *"전후 값 비교 한 줄"*로
// 서면, D(클릭·입력)부터는 **같은 계약을 어려운 대상에 적용**하는 일이 된다.
// 거꾸로 하면 대조 기준 없이 계약을 세우게 된다.
//
// ── 정본 §7 의 다섯 상태 ────────────────────────────────────────────────
//   requested → resolved → dispatched → effect_observed → goal_verified
// **`dispatched` 만으로 ToolReceipt 성공을 만들지 않는다.** 확인할 수 없으면 성공이 아니라
// `unverified_effect` 다. 그 한 줄이 이 파일의 전부다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSlotRegistry } from '../src/kernel/l2-plan/slot-registry.js';
import { DESKTOP_SLOT, 화면슬롯세우기 } from '../src/runtime/desktop-slot.js';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';

const 다줌 = { accessibility: 'granted', screenRecording: 'denied' };

/**
 * 값을 통제하는 가짜 백엔드. `효과` 가 true 면 실제로 값이 바뀌고, false 면
 * **호출은 성공하는데 값이 안 바뀐다** — 그게 A14 가 겨눈 바로 그 상황이다.
 */
function 백엔드({ 효과 = true, 앞 = 'Safari', 던지기 = null } = {}) {
  let 현재앞 = 앞;
  const 부른것 = [];
  return {
    id: '시험백엔드', needs: [],
    부른것,
    async status() { return { permissions: 다줌, backend: { id: '시험', ready: true } }; },
    async observe() { return { frontmost: { name: 현재앞, bundleId: `com.${현재앞}`, pid: 1 }, windows: [{ id: 1, title: '창' }] }; },
    async act(요청) {
      부른것.push(요청);
      if (던지기) throw new Error(던지기);
      if (효과) 현재앞 = 요청?.대상?.app ?? 현재앞;
      return { dispatched: true };
    },
  };
}

const 손세우기 = (백) => {
  const 등록소 = 화면슬롯세우기(makeSlotRegistry());
  등록소.붙이기(DESKTOP_SLOT, 백);
  return makeDesktopActTool({ drivers: 등록소.드라이버(DESKTOP_SLOT) });
};

// ── 닫는 문장 ────────────────────────────────────────────────────────────
test('"그 창 앞으로 띄워줘" — 뜨고, frontmost 값이 그 말을 뒷받침한다', async () => {
  const 백 = 백엔드({ 효과: true, 앞: 'Safari' });
  const out = await 손세우기(백).handler({ action: 'focus', app: 'TextEdit' });

  assert.equal(out.blocked, undefined);
  assert.equal(out.result.단계, 'goal_verified', `다섯 단계 중 어디서 멈췄나: ${out.result.단계}`);
  assert.equal(out.result.전.frontmost, 'Safari');
  assert.equal(out.result.후.frontmost, 'TextEdit', '값이 안 바뀌었는데 성공이라고 했다');
  assert.match(out.userSafeSummary, /TextEdit/);
});

// ── A14 · 여기가 급소다 ──────────────────────────────────────────────────
test('A14: 호출은 성공했는데 값이 안 바뀌면 **성공이 아니다**', async () => {
  const 백 = 백엔드({ 효과: false, 앞: 'Safari' });
  const out = await 손세우기(백).handler({ action: 'focus', app: 'TextEdit' });

  assert.equal(백.부른것.length, 1, '실제로 부르긴 했다(dispatched)');
  assert.notEqual(out.result?.단계, 'goal_verified', '**dispatch 를 성공으로 셌다 — A14 가 뚫렸다**');
  assert.equal(out.failed, true, '실패로 안 냈다 — 사용자는 됐다고 듣는다');
  assert.equal(out.fetchState ?? out.단계 ?? out.result?.단계, undefined);
  // 문구는 나중에 좁혔다: 처음엔 "화면이 안 바뀌었어요" 였는데, **바뀜이 아니라 목표 도달**로
  // 판정을 고치면서 문장도 그렇게 바뀌었다(라이브에서 "이미 앞에 있는 크롬"을 실패로 낸 뒤).
  // 재는 것은 문구가 아니라 **무엇이 안 됐는지가 사용자 문장에 있는가** 다.
  assert.match(out.userSafeSummary, /안 바뀌|안 떴|되지 않|못/, '무엇이 안 됐는지 사용자 문장에 없다');
});

test('A14: 안 바뀐 것도 **무엇을 시도했는지는 남는다** — 조용히 사라지지 않는다', async () => {
  const out = await 손세우기(백엔드({ 효과: false })).handler({ action: 'focus', app: 'TextEdit' });
  assert.equal(out.진행?.단계, 'dispatched', '어디까지 갔는지가 없으면 다음 수를 못 정한다');
  assert.equal(out.진행?.전?.frontmost, 'Safari');
  assert.equal(out.진행?.후?.frontmost, 'Safari', '전후를 실제로 찍었다는 증거');
  assert.ok(out.다음수단?.length, '막다른 답이 되면 안 된다');
});

// ── A04 · 지문이 다르면 실행 0 ───────────────────────────────────────────
test('A04: 요소 지문이 안 맞으면 **부르지도 않는다**', async () => {
  const 백 = 백엔드({ 효과: true });
  const out = await 손세우기(백).handler({
    action: 'focus', app: 'TextEdit',
    대상: { id: 'W1', 지문: 'aaaaaaaaaaaa' },
    확인지문: 'bbbbbbbbbbbb',
  });
  assert.equal(백.부른것.length, 0, '**지문이 다른데 실행했다** — 다른 것을 조작한 것이다');
  assert.equal(out.blocked, true);
  assert.match(out.userSafeSummary, /바뀌었/, '왜 안 했는지가 없다');
  assert.ok(out.다음수단?.some((m) => m.방법 === 'observe'), '다시 보라는 길이 없다');
});

test('A04: 지문이 맞으면 그대로 간다 — 없는 벽을 만들지 않는다', async () => {
  const 백 = 백엔드({ 효과: true });
  const out = await 손세우기(백).handler({
    action: 'focus', app: 'TextEdit',
    대상: { id: 'W1', 지문: 'same00000000' },
    확인지문: 'same00000000',
  });
  assert.equal(백.부른것.length, 1);
  assert.equal(out.result.단계, 'goal_verified');
});

// ── 대조할 값이 없는 행동은 안 받는다 ────────────────────────────────────
//
// **처음엔 여기서 `click`·`type` 도 막았다.** C 의 범위가 넷이었기 때문이다.
// D 가 서면서 그 둘은 **계약을 갖추고** 들어왔다 — 모델이 기대 효과를 선언하고 커널이 그
// 값으로 확인한다. 그러니 이제 재는 것은 "클릭이 막히나"가 아니라
// **"대조할 값이 없는 행동이 막히나"** 다. 계약이 옮겨 갔지 느슨해진 것이 아니다.
test('대조할 값이 없는 행동은 안 받는다 — 없이 계약을 세우지 않는다', async () => {
  const 백 = 백엔드({});
  for (const 안되는것 of ['menu_click', 'drag', 'screenshot']) {
    const out = await 손세우기(백).handler({ action: 안되는것 });
    assert.equal(out.blocked, true, `${안되는것} 이 통과했다 — 대조 기준 없이 계약을 세우게 된다`);
  }
  assert.equal(백.부른것.length, 0);
  // **"없다"고 정직하게 말한다.** 있는 척도 아니고 조용한 실패도 아니다.
  const out = await 손세우기(백).handler({ action: 'menu_click' });
  assert.match(out.userSafeSummary, /아직|못/);
});

test('클릭은 계약을 갖췄을 때만 들어온다 — 기대 없이는 여전히 안 누른다', async () => {
  const 백 = 백엔드({});
  const out = await 손세우기(백).handler({ action: 'click', 대상: { id: 'X', label: '뭔가' } });
  assert.equal(out.blocked, true, '기대 효과 없는 클릭이 통과했다');
  assert.equal(백.부른것.length, 0);
});

// ── 백엔드가 터져도 정직하다 ─────────────────────────────────────────────
test('백엔드가 터지면 실패로 낸다 — 성공도 침묵도 아니다', async () => {
  const out = await 손세우기(백엔드({ 던지기: 'boom' })).handler({ action: 'focus', app: 'TextEdit' });
  assert.equal(out.failed, true);
  assert.ok(!JSON.stringify(out).includes('boom'), '내부 오류가 사용자면으로 샜다');
  assert.ok(out.다음수단?.length);
});

// ── 자동성 헌장이 화면에서 처음 선다 ─────────────────────────────────────
//
// C 에서 처음으로 **되돌릴 수 없는 것**에 닿는다 — 앱을 끄면 저장 안 된 것이 날아간다.
// 헌장 ②(되돌릴 수 없는 파괴는 묻는다)가 걸리는 자리다.
//
// **그런데 나머지 셋은 안 묻는다.** 창을 앞으로 띄우고 내리고 옮기는 것은 되돌릴 수 있다.
// 거기까지 물으면 카드가 늘고, 카드가 늘어나는 변경은 개선이 아니라 실패다(§3.1).
import { toolActionKind } from '../src/kernel/l2-plan/action-plan.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';

test('헌장 ②: 앱 끄기는 되돌릴 수 없다 — 종류가 그렇게 판정된다', () => {
  const selfState = buildSelfState(demoEnv());
  const 끄기 = toolActionKind({ toolId: 'desktop.act', args: { action: 'quit' }, selfState });
  const 띄우기 = toolActionKind({ toolId: 'desktop.act', args: { action: 'focus' }, selfState });
  assert.notEqual(끄기, 띄우기, '끄기와 띄우기가 같은 등급이면 둘 중 하나가 틀린다');
  assert.equal(띄우기, 'read', '창을 앞으로 띄우는 데 카드가 뜨면 마찰만 는다');
});

test('헌장 ②: 되돌릴 수 있는 셋은 자동이다 — 카드를 늘리지 않는다', () => {
  const selfState = buildSelfState(demoEnv());
  for (const a of ['focus', 'scroll', 'move', 'resize']) {
    assert.equal(toolActionKind({ toolId: 'desktop.act', args: { action: a }, selfState }), 'read',
      `${a} 에 승인이 붙었다 — 되돌릴 수 있는 일에 사람을 세우면 자동성이 갉인다`);
  }
});

test('모르는 행동은 읽기로 흘리지 않는다 — 모름은 확인 쪽이다', () => {
  const selfState = buildSelfState(demoEnv());
  assert.notEqual(toolActionKind({ toolId: 'desktop.act', args: { action: '처음보는것' }, selfState }), 'read');
});

// ── A14 를 과하게 적용하지 않는다 — 됐는데 안 됐다고 하지 않는다 ────────────
//
// 라이브에서 잡았다. **이미 앞에 있는 크롬**을 앞으로 띄워 달라니 전후가 같았고,
// 내 계약이 *"화면이 안 바뀌었어요"* 를 냈다 — **됐는데 안 됐다고 한 것**이다.
// 조용한 0 의 거울상을 하루에 두 번째로 밟았다(첫 번째는 권한 게이트).
//
// 정본 §7 이 이미 적어 뒀다: *"변화가 없어도 정상인 행동은 사전에 정의된 verification
// contract 로 확인한다."* 그러니 판정은 **"바뀌었나"가 아니라 "목표 상태인가"** 다.
test('이미 그 상태면 안 바뀌어도 성공이다 — 그리고 이미 그랬다고 말한다', async () => {
  const 백 = 백엔드({ 효과: true, 앞: 'Safari' });
  const out = await 손세우기(백).handler({ action: 'focus', app: 'Safari' });
  assert.equal(out.failed, undefined, '**됐는데 안 됐다고 했다** — A14 를 과하게 적용한 자리');
  assert.equal(out.result.단계, 'goal_verified');
  assert.equal(out.result.이미그상태였다, true, '숨기면 모델이 자기가 바꾼 줄 안다');
  assert.match(out.userSafeSummary, /이미/);
});

test('목표에 못 닿으면 여전히 실패다 — 느슨해진 게 아니다', async () => {
  const 백 = 백엔드({ 효과: false, 앞: 'Safari' });
  const out = await 손세우기(백).handler({ action: 'focus', app: 'TextEdit' });
  assert.equal(out.failed, true, '목표 상태가 아닌데 성공으로 셌다');
  assert.equal(out.진행.단계, 'dispatched');
});

test('이름이 딱 같지 않아도 된다 — 사용자는 "크롬", OS 는 "Google Chrome"', async () => {
  const 백 = 백엔드({ 효과: true, 앞: 'Google Chrome' });
  const out = await 손세우기(백).handler({ action: 'focus', app: 'Chrome' });
  assert.equal(out.result?.단계, 'goal_verified', '이름 표기 차이로 없는 실패를 만들었다');
});

// ── 변화로 판정하는 행동에서도 A14 가 문다 ────────────────────────────────
//
// 돌연변이가 여기서 빠져나갔다: `같은가(전,후)` 분기를 지워도 검사가 초록이었다.
// **내가 목표 상태를 말할 수 있는 행동(focus)만 쟀기 때문이다.** 스크롤·창 옮기기는
// "얼마나"를 우리가 모르니 목표를 못 적고 **변화로만** 판정하는데, 그 길을 안 밟았다.
// 안 무는 그물은 곧 안 재는 자리다(§4.6).
function 스크롤백엔드({ 효과 = true } = {}) {
  let 위치 = 0;
  const 부른것 = [];
  return {
    id: '스크롤시험', needs: [], 부른것,
    async status() { return { permissions: 다줌, backend: { id: '시험', ready: true } }; },
    async observe() { return { frontmost: { name: 'Safari' }, scroll: 위치, windows: [] }; },
    async act(요청) { 부른것.push(요청); if (효과) 위치 += 100; return { dispatched: true }; },
  };
}

test('A14: 스크롤이 실제로 안 움직이면 성공이 아니다', async () => {
  const 백 = 스크롤백엔드({ 효과: false });
  const out = await 손세우기(백).handler({ action: 'scroll' });
  assert.equal(백.부른것.length, 1, '부르긴 했다');
  assert.equal(out.failed, true, '**안 움직였는데 됐다고 했다 — A14 가 뚫렸다**');
  assert.equal(out.진행?.단계, 'dispatched');
  assert.equal(out.진행?.전?.스크롤, out.진행?.후?.스크롤, '전후를 실제로 찍었다는 증거');
});

test('스크롤이 실제로 움직이면 성공이다 — 없는 벽을 만들지 않는다', async () => {
  const out = await 손세우기(스크롤백엔드({ 효과: true })).handler({ action: 'scroll' });
  assert.equal(out.result?.단계, 'goal_verified');
  assert.notEqual(out.result.전.스크롤, out.result.후.스크롤);
});
