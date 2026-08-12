// **CU B 되돌아보기 — 커널이 조용한 0 을 만들어 모델에게 건넸다.**
//
// 라이브(2026-08-05) `계산기 창 안을 자세히 봐. 숫자 버튼 보이면 7 눌러줘`.
// 모델은 창 안을 **다섯 번** 봤다(`scope:'window'` · `type:'button'` · offset 까지 바꿔 가며).
// 매번 0 개가 왔다. 그래서 이렇게 답했다:
//   *"창 안의 숫자 버튼들이 개별 요소로 잡히지 않아서 … `7` 은 윤님이 직접 눌러줘야 해요."*
//
// **버튼은 있었다.** 드라이버는 `AXButton:7` 을 포함해 151개를 줬다.
// 우리 거르개가 `type:'button'` 을 `AXButton` 과 안 맞춘 것이다.
//
// **모델을 탓할 자리가 아니다.** 모델은 다섯 번 확인하고 정직하게 답했다 —
// 커널이 *"없다"* 는 거짓을 건넸다. 조용한 0 의 가장 나쁜 판이다:
// 사람이 아니라 **모델에게** 먹여서, 모델의 정직함이 그대로 떠넘김이 된다.
//
// ── 영수증은 이미 모순을 들고 있었다 ─────────────────────────────────────
//   `{"총":0,"종류":"button","전체":151}`
// **전체가 151인데 총이 0** — 거르개가 안 문 것이 여기 그대로 적혀 있었는데 아무도 안 봤다.
// 그래서 이 파일은 그 모순 자체를 계약으로 세운다: **거르개는 스스로를 증명해야 한다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDesktopTool } from '../src/runtime/desktop-tool.js';

/** cua 가 실제로 주는 모양(라이브 실측). `type` 도 `role` 도 `AX` 접두가 붙어 온다. */
const 계산기요소 = [
  { id: 'w1', type: 'AXWindow', role: 'AXWindow', label: '계산기', isEnabled: true },
  { id: 'b1', type: 'AXButton', role: 'AXButton', label: '7', isEnabled: true },
  { id: 'b2', type: 'AXButton', role: 'AXButton', label: '8', isEnabled: true },
  { id: 'm1', type: 'AXMenuItem', role: 'AXMenuItem', label: '7', isEnabled: true },
  { id: 'c1', type: 'AXCheckBox', role: 'AXCheckBox', label: '다크 모드', value: '0', isEnabled: true },
];

const 손세우기 = (요소들 = 계산기요소) => makeDesktopTool({
  drivers: [{
    id: 'fake',
    status: () => ({ permissions: { accessibility: 'granted' } }),
    observe: () => ({ frontmost: { name: '계산기' }, windows: [{ id: 1, app: '계산기' }], elements: 요소들 }),
  }],
});

// ── ① 거르개가 실제로 문다 ───────────────────────────────────────────────
test('type:button 이 AXButton 을 문다 — 모델이 다섯 번 물어보고 0 을 받던 자리', async () => {
  const r = await 손세우기().handler({ action: 'observe', scope: 'window', type: 'button' });
  const es = r.result?.elements ?? [];
  assert.equal(es.length, 2, `**버튼이 있는데 0 개로 왔다**: ${JSON.stringify(r.result?.요소창)}`);
  assert.deepEqual(es.map((e) => e.label).sort(), ['7', '8']);
});

test('AX 를 붙여 물어도 문다 — 모델이 화면에서 본 이름 그대로 쓸 수 있어야 한다', async () => {
  const r = await 손세우기().handler({ action: 'observe', scope: 'window', type: 'AXButton' });
  assert.equal((r.result?.elements ?? []).length, 2);
});

test('거르개는 그 종류만 문다 — 메뉴 항목까지 버튼이라 하지 않는다', async () => {
  const r = await 손세우기().handler({ action: 'observe', scope: 'window', type: 'menuitem' });
  assert.deepEqual((r.result?.elements ?? []).map((e) => e.id), ['m1']);
});

test('없는 종류를 물으면 0 이 맞다 — 없는 것을 만들어 주지 않는다', async () => {
  const r = await 손세우기().handler({ action: 'observe', scope: 'window', type: 'slider' });
  assert.equal((r.result?.elements ?? []).length, 0);
  assert.equal(r.result?.요소창?.총, 0);
});

// ── ② 영수증이 모순을 들고 나가지 못한다 ─────────────────────────────────
test('거르개가 하나도 못 물면 그 사실을 적는다 — 전체는 있는데 총이 0 인 채로 안 내보낸다', async () => {
  const r = await 손세우기().handler({ action: 'observe', scope: 'window', type: '없는종류' });
  const 창 = r.result?.요소창 ?? {};
  assert.equal(창.총, 0);
  assert.equal(창.전체 > 0, true);
  // **"못 물었다"와 "정말 없다"는 다른 사실이다.** 모델이 그 둘을 구분할 수 있어야
  // 다섯 번 헛돌지 않는다 — 라이브에서 정확히 다섯 번 헛돌았다.
  assert.equal(창.거르개가못물었다, true, '**전체 151에 총 0 을 그냥 "없다"로 내보낸다**');
  assert.ok(Array.isArray(창.있는종류) && 창.있는종류.length, '무엇이 있는지 안 알려 준다 — 모델이 다시 물을 길이 없다');
});

test('물었으면 못 물었다고 하지 않는다', async () => {
  const r = await 손세우기().handler({ action: 'observe', scope: 'window', type: 'button' });
  assert.notEqual(r.result?.요소창?.거르개가못물었다, true);
});

test('아예 요소가 없는 화면에서는 못 물었다고 하지 않는다 — 없는 것은 없는 것이다', async () => {
  const r = await 손세우기([]).handler({ action: 'observe', scope: 'window', type: 'button' });
  assert.notEqual(r.result?.요소창?.거르개가못물었다, true);
});

// ── ③ 요약이 무엇을 봤는지 말한다 ────────────────────────────────────────
test('창 안을 봤으면 요약도 창 안을 말한다 — 늘 같은 화면 문장이 나가지 않는다', async () => {
  const r = await 손세우기().handler({ action: 'observe', scope: 'window', type: 'button' });
  assert.match(r.userSafeSummary, /버튼|요소/, `**창 안을 봤는데 요약은 화면 이야기다**: ${r.userSafeSummary}`);
  assert.doesNotMatch(r.userSafeSummary, /^지금 .* 창 \d+개가 떠 있어요\.$/, '요약이 scope 와 무관하게 같다');
});

test('화면을 봤으면 요약은 창 이야기 그대로다 — A 가 안 무너진다', async () => {
  const r = await 손세우기().handler({ action: 'observe', scope: 'screen' });
  assert.match(r.userSafeSummary, /창 \d+개/);
});
