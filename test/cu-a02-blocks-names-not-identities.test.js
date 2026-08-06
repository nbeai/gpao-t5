// **A02 는 "이름으로만 가리켰을 때" 무는 규율이다** — 신분까지 물면 안 된다.
//
// 밟은 사실(라이브 2026-08-06 · 계산기 12×34). 모델은 요소를 정확히 짚어 보냈다:
//   `대상: { id: 's0000000c:13', label: '1', 지문: 'Button[s0000000c:13]: 1' }`
// 그런데 손은 *"1 이라는 이름이 여러 개라 어느 것을 누를지 알 수 없어요"* 로 막았다.
// 계산기에는 요소가 152개고 같은 라벨이 여럿이라, **숫자 버튼은 사실상 전부 막혔다.**
// 몇 번 헛돈 끝에 화면에는 `1,492,031` 이 찍혔다 — 408 이 아니다.
//
// A02 가 겨눈 것은 **임의 선택**이다(같은 이름 둘 중 아무거나 누르는 것).
// `id`·`토큰`·`번호` 는 이름이 아니라 **신분**이고, 신분을 줬으면 임의가 아니다.
// 낡은 신분은 A02 가 아니라 **A04(지문)** 가 맡는다 — 자리가 다르다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';

const 키패드 = [
  { id: 's1:13', 토큰: 's1:13', 스냅샷: 's1', 번호: 13, role: 'AXButton', label: '1', 창: 9, pid: 77, isEnabled: true },
  { id: 's1:23', 토큰: 's1:23', 스냅샷: 's1', 번호: 23, role: 'AXButton', label: '1', 창: 9, pid: 77, isEnabled: true },
];

function 손세우기(간것 = []) {
  return makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({
        frontmost: { name: '계산기' }, windows: [{ id: 9, pid: 77 }],
        본창: { id: 9, app: '계산기', pid: 77 }, elements: 키패드,
      }),
      act: (요청) => { 간것.push(요청); return { ok: true, 확인됨: true, 근거: 'ok' }; },
    }],
  });
}

test('신분(id)으로 짚었으면 이름이 겹쳐도 누른다 — 계산기 숫자판이 통째로 막혔다', async () => {
  const 간것 = [];
  const r = await 손세우기(간것).handler({
    action: 'click',
    대상: { id: 's1:13', label: '1', 지문: 'Button[s1:13]: 1' },
    기대: { 요소: 's1:13', 값: '1' },
  });
  assert.notEqual(r.blocked, true,
    `**신분을 줬는데 이름으로 막는다**: ${r.userSafeSummary}`);
  assert.equal(간것[0]?.대상?.토큰, 's1:13', `엉뚱한 것을 눌렀다: ${JSON.stringify(간것[0]?.대상)}`);
});

test('이름만 줬으면 그대로 막는다 — 임의로 고르지 않는다(A02 는 살아 있다)', async () => {
  const r = await 손세우기().handler({ action: 'click', 대상: { label: '1' } });
  assert.equal(r.blocked, true, '**같은 이름 둘 중 아무거나 누른다**');
  assert.ok((r.result?.골라야함 ?? r.골라야함 ?? []).length > 0 || /여러 개/.test(r.userSafeSummary));
});

test('낡은 신분은 A02 가 아니라 지문이 막는다 — 자리가 다르다', async () => {
  const 간것 = [];
  const r = await 손세우기(간것).handler({
    action: 'click',
    // 지금 화면에 없는 신분 — 앞 회차 것이다.
    대상: { id: 's0:99', label: '1', 지문: 'Button[s0:99]: 1' },
    기대: { 요소: 's0:99', 값: '1' },
  });
  assert.equal(간것.length, 0, `**없는 신분으로 눌렀다** — 아무 데도 안 눌리고 "했어요"가 된다: ${JSON.stringify(간것)}`);
  assert.ok(!/여러 개/.test(String(r.userSafeSummary)), `이름 탓으로 돌렸다: ${r.userSafeSummary}`);
});

// ── 우리가 다시 보기 때문에 토큰은 **늘** 낡는다 ─────────────────────────
// 라이브(2026-08-06). 모델이 `s00000009:13` 을 짚으면, 손은 실행 전에 화면을 다시 본다
// (A04 지문 확인). 그 순간 회차가 `s0000000a` 로 넘어가 **모델의 토큰은 반드시 안 맞는다.**
// 그래서 계산기 버튼이 하나도 안 눌렸다 — 우리가 만든 벽이다.
//
// cua 토큰은 `<회차>:<자리>` 다. **회차는 매번 바뀌고 자리는 그대로다.**
// 그래서 신분을 찾을 때 회차가 다르면 **자리로 찾는다**(`element_index` 가 바로 그것이다).
// 이름으로 떨어지는 것과는 다르다 — 자리는 신분이고 이름은 아니다.
test('회차가 넘어가도 자리로 같은 것을 찾는다 — 우리가 다시 보는 것이 벽이 되면 안 된다', async () => {
  const { 신분찾기 } = await import('../src/runtime/desktop-identity.js');
  const 지금 = [
    { id: 's2:13', 토큰: 's2:13', 스냅샷: 's2', 번호: 13, label: '1' },
    { id: 's2:14', 토큰: 's2:14', 스냅샷: 's2', 번호: 14, label: '2' },
  ];
  const 찾음 = 신분찾기(지금, { id: 's1:14', label: '2' });
  assert.equal(찾음?.토큰, 's2:14',
    `**회차가 넘어갔다고 못 찾는다** — 버튼이 하나도 안 눌린다: ${JSON.stringify(찾음)}`);
});

test('자리도 이름도 안 맞으면 그때는 못 찾는다 — 아무거나 집지 않는다', async () => {
  const { 신분찾기 } = await import('../src/runtime/desktop-identity.js');
  const 지금 = [{ id: 's2:13', 토큰: 's2:13', 스냅샷: 's2', 번호: 13, label: '1' }];
  assert.equal(신분찾기(지금, { id: 's1:99', label: '9' }), null);
});

test('자리로 찾은 것이 다른 이름이면 안 쓴다 — 화면이 바뀐 것이다', async () => {
  const { 신분찾기 } = await import('../src/runtime/desktop-identity.js');
  const 지금 = [{ id: 's2:14', 토큰: 's2:14', 스냅샷: 's2', 번호: 14, label: '지우기' }];
  assert.equal(신분찾기(지금, { id: 's1:14', label: '2' }), null,
    '**자리만 같고 다른 버튼인데 누른다** — 화면이 밀렸을 때 엉뚱한 것을 누른다');
});
