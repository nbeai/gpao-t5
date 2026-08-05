// **모른다를 안 됐다로 바꿔 말하지 않는다.** (A14 의 나머지 절반)
//
// 라이브(2026-08-05) `계산기 앞으로 가져오고 숫자 7 눌러줘` — 승인까지 받고 눌렀다.
// 드라이버가 정직하게 답했다:
//   `{"delivery":{"mode":"background"},"effect":"unverifiable","route":"accessibility"}`
// **"보냈고, 효과는 확인 못 한다"** 는 뜻이다.
//
// 우리는 이렇게 말했다 — *"실행은 했는데 원하신 상태가 되지 않았어요."* (`failed`)
// 모델은 그걸 읽고 사용자에게 떠넘겼다: *"Dock에서 계산기를 앞으로 꺼내고 7 키를 누르세요."*
//
// **모른다를 안 됐다로 바꾼 것**이고, 조용한 0 의 거울상이다. 오늘 세 번째다.
//
// ── 왜 확인이 안 되나(기계 사실) ─────────────────────────────────────────
// 계산기 창의 접근성 트리에 요소가 151개인데 **값이 있는 것은 0개**다.
// 종류는 `AXWindow·AXButton·AXToolbar·AXMenu*` 뿐 — **표시창(AXStaticText)이 트리에 없다.**
// 즉 이 대상에서는 T5 가 눌린 결과를 볼 수단이 없다. 그건 T5 의 결함이 아니라 **사실**이고,
// 사실은 사실대로 말해야 한다.
//
// ── 두 자리에서 같은 병이 났다 ───────────────────────────────────────────
//   ① 드라이버가 `unverifiable` 이라고 밝혀도 우리는 전후 대조로 실패를 만들었다
//   ② 기대한 요소를 **못 찾았는데** 값이 다른 것으로 쳤다
//      (`요소값` 주석은 *"못 찾은 것과 값이 빈 것을 안 섞는다"* 인데, 대조에서 다시 섞였다)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';

const 버튼 = { id: 'b7', 토큰: 's1:5', role: 'AXButton', label: '7', isEnabled: true };
const 표시창 = { id: 'disp', role: 'AXStaticText', label: '결과', value: '0', isEnabled: true };

function 손세우기({ 요소들 = [버튼], 낸것 = { ok: true }, 누른뒤 = null } = {}) {
  let 눌렀나 = false;
  return makeDesktopActTool({
    drivers: [{
      id: 'f',
      status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({ frontmost: { name: '계산기' }, windows: [{ id: 1 }],
        elements: 눌렀나 && 누른뒤 ? 누른뒤 : 요소들 }),
      act: () => { 눌렀나 = true; return 낸것; },
    }],
  });
}

// ── ① 드라이버가 모른다고 하면 모른다 ────────────────────────────────────
// `failed: true` 자체는 **거짓 성공 영수증을 막는 장치**라 그대로 둔다(A14).
// 가르는 것은 **판정과 사용자 말**이다 — 모델이 "안 됐다"와 "모른다"를 구분해야 한다.
test('드라이버가 확인 못 한다고 밝히면 "안 됐다"가 아니라 "모른다"다', async () => {
  // **값이 기대대로 보이는 화면**으로 잰다 — 그래야 `unverifiable` 하나만 판정을 가른다.
  // 처음엔 표시창이 없는 화면으로 쟀는데, 그건 "못 찾음" 쪽이 이미 unknown 을 만들어서
  // 이 계약이 죽어도 검사가 안 물었다(돌연변이가 잡았다).
  const 손 = 손세우기({
    요소들: [버튼, 표시창], 누른뒤: [버튼, { ...표시창, value: '7' }],
    낸것: { delivery: { mode: 'background' }, effect: 'unverifiable', route: 'accessibility' },
  });
  const r = await 손.handler({ action: 'click', 대상: 버튼, 기대: { 요소: 'disp', 값: '7' } });
  assert.equal(r.진행?.판정, 'unknown', `**모른다를 안 됐다로 바꿨다**: ${JSON.stringify(r).slice(0, 220)}`);
});

test('모를 때는 다시 하라고 하지 않는다 — 두 번 눌리면 안 된다', async () => {
  const 손 = 손세우기({ 요소들: [버튼, 표시창], 누른뒤: [버튼, { ...표시창, value: '7' }], 낸것: { effect: 'unverifiable' } });
  const r = await 손.handler({ action: 'click', 대상: 버튼, 기대: { 요소: 'disp', 값: '7' } });
  const 다음 = JSON.stringify(r.다음수단 ?? []);
  assert.doesNotMatch(다음, /retry|다시 해/, `**모르는 채로 재시도를 권한다**: ${다음}`);
});

test('모를 때 사용자 말은 정직하다 — 했다고도 안 했다고도 하지 않는다', async () => {
  const 손 = 손세우기({ 낸것: { effect: 'unverifiable' } });
  const r = await 손.handler({ action: 'click', 대상: 버튼, 기대: { 요소: 'disp', 값: '7' } });
  // **보낸 사실도 말해야 한다.** 사진으로 확인했다(2026-08-05): cua 가 `unverifiable` 을 준
  // 계산기 클릭이 실제로 눌려 화면에 `778` 이 찍혔다. 보낸 것을 안 말하면 모델은
  // "아무것도 못 했다"로 읽고 떠넘긴다.
  assert.match(r.userSafeSummary, /^했어요/, `보낸 사실을 안 말한다: ${r.userSafeSummary}`);
  assert.match(r.userSafeSummary, /확인/, `사용자 말이 사실과 다르다: ${r.userSafeSummary}`);
  // 낱말로 재지 않는다 — 정직한 문장("됐는지 안 됐는지 모르겠어요")에도 `안 됐` 이 들어 있다.
  // 재는 것은 **실패를 단정하는 그 문장**이다.
  assert.doesNotMatch(r.userSafeSummary, /원하신 상태가 되지 않았/, '**안 됐다고 단정한다**');
  assert.match(r.userSafeSummary, /모르겠/, '모른다고 말해야 모델이 재시도를 안 한다');
});

// ── ② 기대한 요소를 못 찾은 것은 값이 다른 것이 아니다 ───────────────────
test('기대한 요소가 화면에 없으면 모른다 — 값이 다른 것으로 치지 않는다', async () => {
  // 표시창이 트리에 아예 없다(라이브의 계산기가 그렇다).
  const 손 = 손세우기({ 요소들: [버튼] });
  const r = await 손.handler({ action: 'click', 대상: 버튼, 기대: { 요소: 'disp', 값: '7' } });
  assert.equal(r.진행?.판정, 'unknown', `**못 본 것을 안 됐다고 한다**: ${JSON.stringify(r).slice(0, 200)}`);
});

test('요소가 있는데 값이 다르면 그건 진짜 안 된 것이다', async () => {
  const 손 = 손세우기({ 요소들: [버튼, 표시창], 누른뒤: [버튼, { ...표시창, value: '0' }] });
  const r = await 손.handler({ action: 'click', 대상: 버튼, 기대: { 요소: 'disp', 값: '7' } });
  assert.equal(r.failed, true, '**진짜 실패를 모른다로 덮었다** — 반대 방향의 거짓이다');
  assert.equal(r.진행?.판정, 'unsatisfied');
});

test('값이 기대대로면 됐다고 말한다 — 있던 길이 안 막힌다', async () => {
  const 손 = 손세우기({ 요소들: [버튼, 표시창], 누른뒤: [버튼, { ...표시창, value: '7' }] });
  const r = await 손.handler({ action: 'click', 대상: 버튼, 기대: { 요소: 'disp', 값: '7' } });
  assert.equal(r.result?.단계, 'goal_verified', `${JSON.stringify(r).slice(0, 200)}`);
});
