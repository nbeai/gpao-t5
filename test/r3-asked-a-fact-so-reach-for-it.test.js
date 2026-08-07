// **사실을 물으면 손을 뻗는다 — 방법을 설명하지 않는다.**
//
// PM 방향 재조정(2026-08-07): ③은 K 가 아니라 **R** 이다.
//   *"막으면 「이번 턴엔 안 봤어요」가 나간다. 정직하지만 사장님이 원한 건 확인이다 —
//     동반 실패다. 뻗으면 「방금 확인했어요, 맞습니다」가 나가고 그 문장이 참이 된다.
//     거짓말을 막는 문제가 아니라 참으로 만드는 문제다."*
//
// 셋이 같은 병이다 — **물었는데 안 뻗는다**(전부 원장 0):
// ```
// ③  "그거 진짜 됐어?"       앞 턴에 만든 파일이 실제로 있는데 안 읽고 "확인했어요"
// ⑤  "이번 달 얼마 벌었지?"   "컴퓨터에 있는 정산 파일을 읽어서 계산해 드려야 해요" — 안 읽는다
// ⑬  "통장이 자꾸 비어"       원장 0
// ```
// ⑤ 라이브가 진단을 준다: **모델은 무엇을 해야 하는지 안다.** 파일을 읽어야 한다고
// 말해 놓고 안 읽고, 대신 사장님께 *"가능한 방법 두 가지"* 를 설명한다.
//
// `도구쓰는순서` 에 **얻으러 가는 걸음이 없다**:
// ```
// ① 무엇을 얻으면 답이 되는지 정한다
// ② 결과가 그것을 줬는지 대조한다        ← ①과 ② 사이가 비어 있다
// ```
// 손을 쓰기 시작한 뒤의 순서만 있고, **시작할 것인가**가 없다. 그 빈칸을 모델이
// *"사용자에게 물어야 한다"* 로 메운다. 억제가 아니라 **라우팅**이다(승인 계약을 안 건드린다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';

const 순서 = () => String(buildTaskContext({
  processEnv: {},
  selfState: { currentModel: { id: 't' }, connectedTools: [], riskyActions: [], limits: {} },
  intent: { answerMode: 'work', goal: 'x', currentRequest: '이번 달 얼마 벌었지?' },
  plan: { autoAllowed: [], needsApproval: [], forbidden: [] }, receipts: [],
}).도구쓰는순서 ?? '');

test('묻기 전에 찾는다는 걸음이 순서에 있다 — 없으면 모델이 그 자리를 되묻기로 메운다', () => {
  const s = 순서();
  assert.match(s, /찾/,
    `**얻으러 가는 걸음이 없다** — ① 다음이 바로 대조라, 모델은 방법만 설명한다: ${s}`);
  assert.match(s, /묻기 전|먼저 찾|물어보기 전/,
    `**"먼저 찾는다"가 없다** — 어디 있는지 모르면 사장님께 묻는 것이 기본값이 된다: ${s}`);
});

test('이미 있던 네 걸음은 그대로다 — 있는 규율을 없애지 않는다', () => {
  const s = 순서();
  for (const 조각 of ['무엇을 얻으면 답이 되는지', '대조', '다음수단', '대신 찾아보라고 넘기지 않는다']) {
    assert.ok(s.includes(조각), `**기존 걸음이 사라졌다**: ${조각}`);
  }
});

// ── 그 순서가 모델까지 간다 ─────────────────────────────────────────────
// **밟고 나서 안 것**(2026-08-07): `도구쓰는순서` 는 `task-context.js` 가 만들고
// **아무도 안 읽는다**(소비자 0곳). 내가 넣기 전부터 죽어 있던 필드다.
//
// 그래서 위 걸음을 더한 뒤 라이브가 안 움직인 것을 나는 *"문구 세 번째 실패"* 로 셌는데,
// **문구가 안 통한 게 아니라 문구가 안 갔다.** 오늘 일곱 번째 같은 병이고,
// 이번엔 내가 만든 것이 아니라 원래 끊겨 있던 자리다 — 그래서 더 조용했다.
import { buildModelMessages } from '../src/runtime/model-provider.js';

test('도구 쓰는 순서가 모델 프롬프트에 실린다 — 소비자가 0곳이면 무엇을 적든 안 간다', () => {
  const tc = buildTaskContext({
    processEnv: {},
    selfState: { currentModel: { id: 't' }, connectedTools: [], riskyActions: [], limits: {} },
    intent: { answerMode: 'work', goal: 'x', currentRequest: '이번 달 얼마 벌었지?' },
    plan: { autoAllowed: [], needsApproval: [], forbidden: [] }, receipts: [],
  });
  const 글 = String(buildModelMessages({ currentRequest: '이번 달 얼마 벌었지?', ...tc }).system ?? '');
  assert.match(글, /먼저 손으로 찾아본다/,
    `**순서가 모델에게 안 간다** — 커널이 만들어 놓고 아무도 안 읽는다: ${글.slice(-300)}`);
});
