// **막힌 걸음을 했다고 말하면 안 된다.** 출구 그물의 네 번째.
//
// 라이브(2026-08-05) `계산기 앞으로 가져오고 숫자 7 눌러줘`. 원장은 이랬다:
//   `click 7`  → **blocked** ("7 이라는 이름이 여러 개라 어느 것을 누를지 알 수 없어요")
//   `focus`    → blocked → 다시 `focus window 14069` → 성공
//   그리고 **click 은 다시 시도되지 않았다.**
// 최종 답: *"계산기 창 앞으로 가져왔고요, 거기서 숫자 7 버튼까지 눌렀어요."*
//
// **안 눌렀다.** 사용자는 눌린 줄 안다.
//
// 있던 그물 셋은 전부 지나갔다:
//   ① 확인된 실행 0 — 아니다(focus·observe 가 성공했다)
//   ② 말한 개수 대조 — "숫자 7" 은 개수가 아니다
//   ③ 가리킨 자리 — 파일 이름 같은 게 없다
//
// 넷째를 세운다. **문구 규칙이 아니라 원장 대조다**(이 파일의 규율 그대로):
//   *이 턴에 막힌 걸음이 있고, 같은 손·같은 걸음이 끝내 성공한 적이 없는데,*
//   *답은 완료를 말한다* → **사실만 모델에게 돌려준다.**
//
// 손 이름을 안 본다 — 웹이든 파일이든 터미널이든 같은 자리에서 같은 거짓이 난다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 완료주장검증 } from '../src/kernel/l2-plan/exit-verification.js';

const 성공 = (tool, action) => ({
  failureState: 'none', actualCall: { tool, args: action ? { action } : {} }, result: {},
});
const 막힘 = (tool, action) => ({
  failureState: 'blocked', actualCall: { tool, args: action ? { action } : {} }, result: {},
});

test('막힌 걸음을 했다고 말하면 사실을 돌려준다 — 라이브에서 난 그 자리', () => {
  const r = 완료주장검증({
    reply: '계산기 창 앞으로 가져왔고요, 거기서 숫자 7 버튼까지 눌렀어요.',
    receipts: [막힘('desktop.act', 'click'), 성공('desktop.act', 'focus')],
  });
  assert.equal(r.사용자에게, false, '**안 누른 것을 눌렀다고 사용자에게 보냈다**');
  assert.match(r.모델에게, /click|막/, `사실을 안 준다: ${r.모델에게}`);
});

test('같은 손이 다른 걸음에서 성공했다고 넘어가지 않는다 — 걸음이 다르면 다른 일이다', () => {
  const r = 완료주장검증({
    reply: '눌렀어요.',
    receipts: [막힘('desktop.act', 'click'), 성공('desktop.act', 'focus'), 성공('desktop.screen', 'observe')],
  });
  assert.equal(r.사용자에게, false);
});

test('막혔다가 같은 걸음으로 다시 해서 됐으면 지나간다 — 정상 회복을 막지 않는다', () => {
  const r = 완료주장검증({
    reply: '계산기 창 앞으로 가져왔어요.',
    receipts: [막힘('desktop.act', 'focus'), 성공('desktop.act', 'focus')],
  });
  assert.equal(r.사용자에게, true, '막혔다가 다시 해서 된 것을 거짓으로 봤다 — 정직한 회복이 막힌다');
});

test('막힌 걸음이 없으면 지나간다', () => {
  const r = 완료주장검증({ reply: '눌렀어요.', receipts: [성공('desktop.act', 'click')] });
  assert.equal(r.사용자에게, true);
});

test('완료를 주장하지 않으면 지나간다 — 정직한 미완료를 막지 않는다', () => {
  const r = 완료주장검증({
    reply: '7 버튼이 여러 개로 잡혀서 아직 못 눌렀어요. 어느 쪽인지 알려주실래요?',
    receipts: [막힘('desktop.act', 'click')],
  });
  assert.equal(r.사용자에게, true, '**정직하게 못 했다고 말했는데 되돌렸다** — 반대 방향의 거짓을 만든다');
});

test('걸음 이름이 없는 손도 손 단위로는 본다 — 웹·파일에서도 같은 거짓이 난다', () => {
  const r = 완료주장검증({
    reply: '자료 다 모았어요.',
    receipts: [막힘('web.collect'), 성공('web.search')],
  });
  assert.equal(r.사용자에게, false);
});

test('한 턴에 두 번 되돌리지 않는다 — 왕복 비용은 사용자가 문다', () => {
  const r = 완료주장검증({
    reply: '눌렀어요.',
    receipts: [막힘('desktop.act', 'click')],
    이미돌려줬나: true,
  });
  assert.equal(r.사용자에게, true);
});

test('취소는 막힘이 아니다 — 사용자가 그만두라고 한 것이다', () => {
  const r = 완료주장검증({
    reply: '거기까지 하고 멈췄어요.',
    receipts: [{ failureState: 'cancelled', actualCall: { tool: 'desktop.act', args: { action: 'click' } }, result: {} },
      성공('desktop.screen', 'observe')],
  });
  assert.equal(r.사용자에게, true, '사용자가 멈춘 것을 모델의 거짓으로 몰았다');
});

// ── 막힘의 "다음 한마디"가 손을 접게 만들면 안 된다 ──────────────────────
// 라이브(2026-08-05): 화면 손이 A02 로 막으며 **토큰까지 실은 다음수단 둘**을 줬는데,
// 같은 영수증에 `nextSafeAction: "공개 자료/대체 경로로 이어갈까요?"` 가 붙어 나갔다.
// 웹 문구다. 모델은 그걸 읽고 *"desktop.act 가 막혀 있어서"* 라며 사용자에게 떠넘겼다.
//
// **가진 길을 두고 없는 것처럼 말하게 만든 것**은 기본값이지 모델이 아니다.
// 방법(기본 문구)이 목적(지금 누르기)을 덮은 자리다.
import { ToolRunner } from '../src/runtime/tool-runner.js';

test('다음 수를 쥔 막힘은 그 길을 가리킨다 — 웹 기본 문구로 손을 접게 하지 않는다', async () => {
  const runner = new ToolRunner({
    'desktop.act': {
      async handler() {
        return {
          blocked: true,
          userSafeSummary: '"7" 이라는 이름이 여러 개라 어느 것을 누를지 알 수 없어요.',
          다음수단: [{ 방법: 'click', 토큰: 't1', 왜: 'AXButton · 7' }],
        };
      },
    },
  });
  const r = await runner.run('desktop.act', { action: 'click' },
    { connectedTools: [{ id: 'desktop.act', executable: true }] });
  assert.equal(r.failureState, 'blocked');
  assert.doesNotMatch(String(r.nextSafeAction ?? ''), /공개 자료|대체 경로/,
    '**화면 손에 웹 문구가 붙어 나간다** — 모델이 그걸 읽고 손을 접는다');
  // 낱말 하나로 재지 않는다 — 첫 판은 `이어` 로 쟀다가 **다른 분기의 문구**("연결/권한을
  // 준비하면 **이어**서 할 수 있어요")에 우연히 맞아 초록이었다. 재는 자리를 못 박는다.
  assert.match(String(r.nextSafeAction ?? ''), /다음 수가 있어요/, `길을 안 가리킨다: ${r.nextSafeAction}`);
});

test('다음 수가 없으면 있던 기본 문구 그대로다 — 없는 길을 만들지 않는다', async () => {
  // 같은 손으로 잰다 — 손을 바꾸면 다른 분기(연결·권한)로 떨어져 재는 자리가 달라진다.
  const runner = new ToolRunner({
    'desktop.act': { async handler() { return { blocked: true, userSafeSummary: '막혔어요.' }; } },
  });
  const r = await runner.run('desktop.act', { action: 'click' },
    { connectedTools: [{ id: 'desktop.act', executable: true }] });
  assert.match(String(r.nextSafeAction ?? ''), /공개 자료|대체 경로/);
});
