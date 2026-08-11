// **CU E · 무엇이 되는지 모르면 묻는다.** 위험을 낱말로 알아맞히지 않는다.
//
// 지금 뚫려 있는 자리(기계 사실): `desktop.act` 의 `click` 은 무조건 `organize` 다.
// 그래서 **"보내기 눌러줘"가 카드 없이 실행된다.** D 를 닫을 때 일부러 그렇게 두고
// `action-plan.js` 주석에 *"바깥으로 나가는 클릭은 … E 의 일이다"* 라고 적어 뒀다. 그 자리다.
//
// ── 길이 둘인데 하나는 이미 두 번 뚫린 길이다 ────────────────────────────
//   ✗ 위험한 버튼 이름 목록   `보내기`·`삭제`·`결제`… — 문구 목록 늘리기다.
//                            영어면? 아이콘이면? 목록은 **항상 뚫린다.**
//                            게다가 화면 문구로 등급을 정하는 건 A10 을 정면으로 어긴다.
//   ✓ **돌려 봐야 안다**      `local.terminal` 이 이미 이 길로 간다 — 위험 명령 목록이 아니라
//                            probe 가 등급을 정한다. **화면도 똑같이 돌려 보면 된다.**
//
// ── 무엇을 돌려 보나 ──────────────────────────────────────────────────────
// 화면에서 **되돌릴 수 있는 것과 없는 것은 구조로 갈린다**(낱말이 아니다):
//
//   값이 있는 요소   체크박스·스위치·팝업·슬라이더·글자칸
//                    → 전후 값 대조가 자명하고, **되돌리려면 다시 놓으면 된다**
//   값이 없는 버튼   눌러 보기 전엔 무엇이 되는지 모르고, 되돌릴 방법도 없다
//                    → **모른다.** 모름은 자동이 아니라 확인 쪽이다
//
// C 가 "대조가 자명한 것부터"로 첫 손을 자른 것과 **같은 기준**이다. 새 규율이 아니다.
//
// ── 그리고 모델의 말로 갈리지 않는다 ─────────────────────────────────────
// 지금은 `기대.바깥으로` 를 **모델이 밝혀야** 막힌다. 모델이 안 밝히면 안 막힌다.
// probe 는 **화면에 다시 물어본다** — 모델이 뭐라 적어 내든 화면이 이긴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolActionKind } from '../src/kernel/l2-plan/action-plan.js';
import { UNKNOWN_KIND } from '../src/kernel/l2-plan/authority.js';
import { decideAutoGrant } from '../src/kernel/l2-plan/authority.js';
import { 실행전판정 } from '../src/kernel/l2-plan/tool-boundary.js';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';

const 자동인가 = (kind) => decideAutoGrant({ kind, label: 'desktop.act' });

/** 화면을 흉내 내는 드라이버. **요소는 여기서만 나온다** — 모델이 준 것이 아니다. */
function 가짜드라이버(요소들) {
  return {
    id: 'fake', status: () => ({ permissions: { accessibility: 'granted' } }),
    observe: () => ({ elements: 요소들 }),
    act: () => ({ ok: true }),
  };
}

const 체크박스 = { role: 'AXCheckBox', label: '다크 모드', value: '0', isEnabled: true };
const 보내기 = { role: 'AXButton', label: '보내기', isEnabled: true };
const 글자칸 = { role: 'AXTextField', label: '받는 사람', value: '', isEnabled: true };

// ── ① 값이 없는 버튼은 미상이다 — 무엇이 되는지 모른다 ────────────────────
test('값 없는 버튼 클릭은 자동으로 안 흘린다 — "보내기 눌러줘"가 카드 없이 실행되던 자리', () => {
  const kind = toolActionKind({ toolId: 'desktop.act', args: { action: 'click', 눌러본사실: { 찾음: true, 값있음: false } } });
  assert.equal(kind, UNKNOWN_KIND, '**값 없는 버튼이 자동으로 실행된다** — E 가 겨눈 그 자리다');
  assert.equal(자동인가(kind), false, '분류는 올렸는데 헌장이 안 받는다');
});

// ── ② 값이 있는 요소는 그대로 자동 — 카드를 늘리지 않는다 ─────────────────
test('값 있는 요소는 자동이다 — 다크 모드 켜기가 다시 묻지 않는다', () => {
  const kind = toolActionKind({ toolId: 'desktop.act', args: { action: 'click', 눌러본사실: { 찾음: true, 값있음: true } } });
  assert.equal(kind, 'organize', 'D 의 문장이 카드로 막혔다 — 카드가 늘어나는 변경은 실패다');
  assert.equal(자동인가(kind), true);
});

// 계약 변경 두 번, 그 이력을 지우지 않는다.
//   (가-2) PM 2026-08-09: 글자 넣기를 `field_input`(기본 카드)으로 올렸다.
//          이유 — *"탐침이 선 대화 입력칸이면 카드 없이 밖으로 나갈 수 있는 구멍"*
//   결재 ① 오너 2026-08-11: **되돌린다.** 칸에 글자 넣기는 자동이다.
//
// **(가-2)의 이유는 무너지지 않았다 — 카드가 자리를 옮겼다.** 구멍이라던 것은 *넣기* 가
// 아니라 *나가기* 였고, 나가는 걸음 셋은 아래·옆 검사가 그대로 문다(신고된 전송 = send ·
// 칸 내용이 실린 엔터 = field_input · 값 없는 전송 버튼 = 미상).
// 되돌린 값: 네이버 한 문장이 카드 2장이었고, 다음 회차에서 T5 가 *"제 권한으로는 아직
// 못 합니다"* 라고 **거짓 무능**을 답했다(30분 전 같은 판에서 친 손이다).
// 자동의 조건 셋은 `test/no-rationing-hands-are-not-scarce.test.js` 가 전수로 문다.
test('글자 넣기는 요소로 짚은 칸이면 자동이다 — 결재 ①(오너 2026-08-11)', () => {
  const kind = toolActionKind({ toolId: 'desktop.act', args: { action: 'type', 눌러본사실: { 찾음: true, 값있음: true } } });
  assert.equal(kind, 'organize', '**타이핑에 카드가 뜬다** — 사용자 손이 한 번 더 든다');
  assert.equal(자동인가(kind), true);
});

test('짚지 못한 칸에 넣기는 그대로 카드다 — 모름은 자동이 아니다', () => {
  // 대상을 안 준 것은 **커서 자리에 친다**는 뜻이라 미상이고(그 규율 그대로),
  // 대상을 줬는데 탐침이 못 찾았으면 `field_input` 이다. 둘 다 카드다.
  assert.equal(자동인가(toolActionKind({ toolId: 'desktop.act', args: { action: 'type', 눌러본사실: { 찾음: false } } })), false);
  assert.equal(toolActionKind({ toolId: 'desktop.act', args: { action: 'type', 대상: { label: '검색창' }, 눌러본사실: { 찾음: false } } }), 'field_input');
});

// ── ③ 못 찾은 자리는 미상이다 — 없는 것을 자동으로 누르지 않는다 ──────────
test('화면에서 그 자리를 못 찾으면 미상이다', () => {
  const kind = toolActionKind({ toolId: 'desktop.act', args: { action: 'click', 눌러본사실: { 찾음: false } } });
  assert.equal(kind, UNKNOWN_KIND);
});

test('돌려 본 사실이 아예 없으면 미상이다 — 모름은 자동이 아니라 확인 쪽이다', () => {
  const kind = toolActionKind({ toolId: 'desktop.act', args: { action: 'click' } });
  assert.equal(kind, UNKNOWN_KIND, '**probe 를 안 태우면 그냥 자동으로 흐른다** — 터미널이 밟은 병이다');
});

// ── ④ C·D 가 안 무너진다 ─────────────────────────────────────────────────
test('창 넷은 그대로 자동이다 — C 가 안 무너진다', () => {
  for (const a of ['focus', 'scroll', 'move', 'resize', 'launch']) {
    assert.equal(toolActionKind({ toolId: 'desktop.act', args: { action: a } }), 'read', `${a} 가 막혔다`);
  }
  assert.equal(toolActionKind({ toolId: 'desktop.act', args: { action: 'quit' } }), 'write');
});

// ── ⑤ 손이 실제로 화면에 다시 물어본다 ───────────────────────────────────
test('probe 는 화면에 다시 물어본다 — 모델이 준 값이 아니라', async () => {
  const 손 = makeDesktopActTool({ drivers: [가짜드라이버([체크박스, 보내기])] });
  const r = await 손.probe({ action: 'click', 대상: { label: '보내기' } });
  assert.equal(r.찾음, true);
  assert.equal(r.값있음, false, '**값 없는 버튼을 값 있는 것으로 봤다**');

  const r2 = await 손.probe({ action: 'click', 대상: { label: '다크 모드' } });
  assert.equal(r2.값있음, true, '체크박스를 못 알아봤다 — 다크 모드가 카드로 막힌다');
});

test('모델이 값을 지어내도 화면이 이긴다 — 자기신고로 승인을 못 피한다', async () => {
  const 손 = makeDesktopActTool({ drivers: [가짜드라이버([보내기])] });
  // 모델이 "이건 값이 있는 칸이에요"라고 적어 냈다.
  const r = await 손.probe({ action: 'click', 대상: { label: '보내기', value: '0', role: 'AXCheckBox' } });
  assert.equal(r.값있음, false, '**모델의 말이 화면을 이겼다** — 승인 경계가 자기신고로 뚫린다');
});

test('화면에 없는 자리는 못 찾았다고 답한다', async () => {
  const 손 = makeDesktopActTool({ drivers: [가짜드라이버([체크박스])] });
  const r = await 손.probe({ action: 'click', 대상: { label: '없는버튼' } });
  assert.equal(r.찾음, false);
});

test('probe 는 아무것도 실행하지 않는다 — 판정만 한다', async () => {
  let 실행 = 0;
  const d = 가짜드라이버([보내기]);
  d.act = () => { 실행 += 1; return { ok: true }; };
  const 손 = makeDesktopActTool({ drivers: [d] });
  await 손.probe({ action: 'click', 대상: { label: '보내기' } });
  assert.equal(실행, 0, '**판정하다가 눌러 버렸다**');
});

test('드라이버가 터져도 probe 는 안 터진다 — 모른다고 답한다', async () => {
  const d = 가짜드라이버([]);
  d.observe = () => { throw new Error('화면 안 보임'); };
  const 손 = makeDesktopActTool({ drivers: [d] });
  const r = await 손.probe({ action: 'click', 대상: { label: '보내기' } });
  assert.equal(r.찾음, false, '터지면 판정 자리 전체가 죽는다');
});

// ── ⑥ 경계가 그 길을 실제로 탄다 ─────────────────────────────────────────
test('실행 전 경계가 desktop.act 에 probe 를 태운다 — 태우지 않으면 위 전부가 죽은 계약이다', async () => {
  const 손 = makeDesktopActTool({ drivers: [가짜드라이버([보내기, 체크박스])] });
  const selfState = { connectedTools: [{ id: 'desktop.act', toolKind: 'read' }] };
  const tools = { tools: { 'desktop.act': 손 } };

  const 버튼 = await 실행전판정({
    toolId: 'desktop.act', args: { action: 'click', 대상: { label: '보내기' } }, selfState, tools,
  });
  assert.equal(버튼.kind, UNKNOWN_KIND, '**경계가 probe 를 안 태운다** — 보내기가 카드 없이 나간다');
  assert.equal(버튼.판정인자.눌러본사실.값있음, false, '돌려 본 사실이 판정인자에 안 실렸다(원장도 못 본다)');

  const 토글 = await 실행전판정({
    toolId: 'desktop.act', args: { action: 'click', 대상: { label: '다크 모드' } }, selfState, tools,
  });
  assert.equal(토글.kind, 'organize', '다크 모드가 카드로 막혔다');
});

test('창 넷은 경계에서 화면을 건드리지도 않는다 — 볼 일이 없다', async () => {
  let 관찰 = 0;
  const d = 가짜드라이버([보내기]);
  const 원래 = d.observe;
  d.observe = (...a) => { 관찰 += 1; return 원래(...a); };
  const 손 = makeDesktopActTool({ drivers: [d] });
  const r = await 실행전판정({
    toolId: 'desktop.act', args: { action: 'focus', 대상: { app: 'Safari' } },
    selfState: { connectedTools: [{ id: 'desktop.act', toolKind: 'read' }] }, tools: { tools: { 'desktop.act': 손 } },
  });
  assert.equal(r.kind, 'read');
  assert.equal(관찰, 0, '창 띄우는 데 화면을 한 번 더 봤다 — 값싼 길에 비용을 붙였다');
});

// ── ⑦ 비밀칸은 여전히 0 (A09) ────────────────────────────────────────────
test('비밀칸은 판정 이전에 막힌다 — probe 가 생겨도 안 열린다', async () => {
  const 비밀 = { role: 'AXSecureTextField', label: '비밀번호', isEnabled: true };
  const 손 = makeDesktopActTool({ drivers: [가짜드라이버([비밀])] });
  const r = await 손.handler({ action: 'type', 대상: { label: '비밀번호', 비밀칸: true }, 값: 'x', 기대: { 요소: '비밀번호' } });
  assert.equal(r.막힘 ?? r.blocked ?? false, true, '**비밀칸에 글자가 들어갔다**');
});

// ── ⑧ 카드가 무엇을 허락하는 것인지 말한다 ───────────────────────────────
// 라이브(2026-08-05)에서 카드는 떴는데 이렇게 적혀 있었다: **"화면 다루기 실행"**.
// 이 저장소가 이미 싸운 병이다 — *"사용자가 무엇을 허락하는지 모르는 승인은 승인이 아니다
// (실측: '실행 중인 것 실행')"*. **뜨는 것과 말이 되는 것은 다른 일이다.**
test('카드가 무엇을 누르는지 말한다 — "화면 다루기 실행"으로는 허락할 수가 없다', async () => {
  // 미리보기는 **선언(descriptor)이 아니라 손**에 붙는다 — `turn.js` 가 거기서 읽는다
  // (`ctx.tools.tools[id].previewOf`). 처음엔 선언에서 찾다가 못 봤다: 재는 자리를 틀린 것이다.
  const 손 = makeDesktopActTool({ drivers: [가짜드라이버([보내기])] });
  assert.equal(typeof 손.previewOf, 'function', '**미리보기가 아예 없다** — 카드가 빈 채로 뜬다');
  const pv = 손.previewOf({ action: 'click', app: '계산기', 대상: { label: '보내기' }, 눌러본사실: { 찾음: true, 값있음: false } });
  assert.match(pv.impact, /보내기/, `무엇을 누르는지 없다: ${JSON.stringify(pv)}`);
  assert.match(pv.impact, /계산기/, '어디서 누르는지 없다');
});

test('되돌릴 수 있다고 함부로 약속하지 않는다 — 무엇이 되는지 모르는 버튼이다', async () => {
  const 손 = makeDesktopActTool({ drivers: [가짜드라이버([보내기])] });
  const pv = 손.previewOf({ action: 'click', app: '계산기', 대상: { label: '보내기' }, 눌러본사실: { 찾음: true, 값있음: false } });
  assert.doesNotMatch(String(pv.cancel ?? ''), /^되돌릴 수 있어요$/, '**모르는 일에 되돌림을 약속했다**');
});

test('값이 있는 요소는 되돌릴 수 있다고 말해도 된다 — 다시 놓으면 된다', async () => {
  const 손 = makeDesktopActTool({ drivers: [가짜드라이버([보내기])] });
  const pv = 손.previewOf({ action: 'click', app: '설정', 대상: { label: '다크 모드' }, 눌러본사실: { 찾음: true, 값있음: true } });
  assert.match(String(pv.cancel ?? ''), /되돌릴 수 있/);
});

// ── ⑨ 막을 때는 다음 수를 함께 준다 ──────────────────────────────────────
// 라이브(2026-08-05): 계산기 `7` 이 `AXButton` 과 `AXMenuItem` 둘로 잡혀 A02 가 막았다.
// 옳게 막았는데 **후보를 안 줬다.** 모델은 갈 곳이 없어 사용자에게 떠넘겼다 —
// *"윤님이 직접 한 번만 계산기 창을 클릭해서…"*. 웹에서 이미 세운 계약이 여기만 없었다:
// **하나가 막혔다고 전부를 버리지 않는다.**
//
// 그리고 A02 는 **임의 선택**을 막는 규율이지 신분이 확실한 것까지 막는 규율이 아니다.
// cua 는 이름이 아니라 **토큰**으로 누른다 — 토큰을 주면 어느 것인지 모호하지 않다.
const 같은이름 = [
  { role: 'AXButton', label: '7', 토큰: 't-btn', 스냅샷: 's1', isEnabled: true },
  { role: 'AXMenuItem', label: '7', 토큰: 't-menu', 스냅샷: 's1', isEnabled: true },
];

test('같은 이름이 여럿이면 막되 후보를 준다 — 갈 곳 없는 막힘은 떠넘김이 된다', async () => {
  const 손 = makeDesktopActTool({ drivers: [가짜드라이버(같은이름)] });
  const r = await 손.handler({ action: 'click', 대상: { label: '7' }, 기대: { 요소: 'x', 값: '7' } });
  assert.equal(r.blocked ?? r.막힘, true, '**둘 중 하나를 임의로 눌렀다** — A02 위반');
  assert.equal(r.후보?.length, 2, `후보를 안 줬다: ${JSON.stringify(r).slice(0, 200)}`);
  assert.ok(r.후보.some((c) => c.토큰 === 't-btn'), '무엇으로 다시 부르는지가 후보에 없다');
  assert.ok(r.다음수단?.length, '다음 수가 없다');
});

test('토큰을 주면 이름이 겹쳐도 누른다 — 신분이 확실하면 모호하지 않다', async () => {
  let 누른것 = null;
  const d = 가짜드라이버(같은이름);
  d.act = (요청) => { 누른것 = 요청; return { ok: true }; };
  const 손 = makeDesktopActTool({ drivers: [d] });
  const r = await 손.handler({ action: 'click', 대상: { label: '7', 토큰: 't-btn' }, 기대: { 요소: 'x', 값: '7' } });
  assert.notEqual(r.blocked, true, `**신분을 줬는데도 막았다**: ${JSON.stringify(r).slice(0, 200)}`);
  assert.equal(누른것?.대상?.토큰, 't-btn', '토큰이 드라이버까지 안 갔다');
});

// ── ⑩ 준 길을 우리가 막아 두지 않는다 ────────────────────────────────────
// 라이브(2026-08-05): A02 로 막으며 **토큰 실린 다음수단**을 줬는데 모델이 재시도를 안 했다.
// 스키마의 `대상` 에 **토큰 칸이 없었다.** 관찰은 토큰을 주고 막힘은 토큰을 가리키는데,
// 모델이 그걸 적어 낼 자리가 없다. 길을 주고 문을 잠근 셈이다.
test('대상 스키마에 토큰 칸이 있다 — 없으면 다음수단이 죽은 길이다', async () => {
  const { demoDescriptors } = await import('../src/surface/demo-context.js');
  const d = (demoDescriptors({ desktopAct: true }) ?? []).find((x) => x.id === 'desktop.act');
  const 대상 = d?.schema?.parameters?.properties?.대상?.properties ?? {};
  assert.ok(대상.토큰, '**토큰 칸이 없다** — 막힘이 준 토큰을 모델이 넣을 자리가 없다');
});

test('관찰이 내보내는 요소에 토큰이 실린다 — 스키마 칸과 짝이 맞아야 한다', async () => {
  const { makeDesktopTool } = await import('../src/runtime/desktop-tool.js');
  const 손 = makeDesktopTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({ frontmost: { name: 'X' }, windows: [{ id: 1 }],
        elements: [{ id: 'e1', 토큰: 's1:5', type: 'AXButton', label: '7', isEnabled: true }] }),
    }],
  });
  const r = await 손.handler({ action: 'observe', scope: 'window', type: 'button' });
  assert.equal(r.result.elements[0].토큰, 's1:5', '관찰이 토큰을 떨어뜨리면 모델이 줄 것이 없다');
});
