// **되는 것은 모델에게 가는 칸에 적어야 한다.**
//
// 오너 라이브(2026-08-06): `카톡에서 정영현이 보낸 마지막 메세지 봐줄래?` 에
// T5 가 손을 **한 번도 안 쓰고** *"카카오톡이랑 연결이 안 돼 있어서 못 해요"* 라며
// 복사해 붙여 달라고 떠넘겼다. **할 수 있었다** — 실측하니 그 창 요소 130개 중 66개에
// 글자가 있고 대화가 `AXTextArea` 로 그대로 읽힌다. 앞으로 안 가져오고도 읽힌다.
//
// 계측기로 모델이 실제로 받는 문장을 폈다. 결과는 하나였다:
//   **`operatorFact` 만 간다. `capability` 는 안 간다.**
// 그래서 능력 문장에 아무리 잘 써도 모델은 못 본다. 오늘 내가 거기에 썼고, 소용없었다.
//
// (곁가지 정정: 처음엔 *"`화면 보기` 라는 이름이 둘"* 이라고 읽었는데 착시였다 —
//  `브라우저로 화면 보기` 의 뒷부분이 잡힌 것이다. 이름은 실제로 안 겹친다.
//  **내 grep 이 만든 결함을 하마터면 고칠 뻔했다.**)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoDescriptors } from '../src/surface/demo-context.js';

/** 이번 런에 실제로 서는 손 전부 — 화면 손까지 켜서 본다. */
const 모든손 = () => demoDescriptors({ desktop: true, desktopAct: true }) ?? [];
const 손 = (id) => 모든손().find((d) => d.id === id);

test('선언된 손 이름이 겹치지 않는다 — 겹치면 모델이 고를 수가 없다(A02 의 프롬프트 판)', () => {
  const 이름들 = 모든손().map((d) => d.label ?? d.id);
  const 겹친것 = [...new Set(이름들.filter((n, i) => 이름들.indexOf(n) !== i))];
  assert.deepEqual(겹친것, [], `**같은 이름이 둘이다**: ${겹친것.join(' · ')}`);
});

// ── 모델에게 가는 칸에 되는 것이 적혀 있는가 ─────────────────────────────
test('창 안의 글자를 읽는다는 사실이 **operatorFact** 에 있다 — 거기만 모델에게 간다', () => {
  const d = 손('desktop.screen');
  assert.match(String(d?.operatorFact ?? ''), /글자|내용|본문/,
    '**모델이 받는 칸에 그 사실이 없다** — "창 목록 보기"로 읽고 커넥터를 찾는다');
});

test('앞에 없는 앱도 본다는 사실이 operatorFact 에 있다 — 그게 없어서 "앞에 안 떠 있다"로 답했다', () => {
  const d = 손('desktop.screen');
  assert.match(String(d?.operatorFact ?? ''), /앞에 없|앞으로 가져오지|뒤에 있/,
    '**뒤에 있는 창도 본다는 말이 없다** — 앞에 없으면 못 한다고 답하게 된다');
});

// 모델에게 가는 통로는 **둘**이다(계측기 확인): 손 목록의 `operatorFact` 와 도구 스키마의
// `description`. `capability` 는 어느 쪽도 아니다 — 화면용이다.
// 그러니 재는 것은 *"둘 중 한 곳에는 있는가"* 다. 둘 다 비면 모델은 그 손이 뭔지 모른다.
test('모델이 받는 통로 둘 중 한 곳에는 그 손이 뭘 하는지 적혀 있다', () => {
  for (const d of 모든손()) {
    if (!d.capability) continue;
    const 가는말 = `${d.operatorFact ?? ''} ${d.schema?.description ?? ''}`.trim();
    assert.ok(가는말, `**${d.id} 는 모델에게 자기가 뭘 하는지 한 마디도 안 한다**`);
  }
});
