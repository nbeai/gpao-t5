// **화면에 실제로 배선되는 손들이 헌장과 어긋나지 않는가.**
//
// 라이브 관통(2026-08-03)에서 잡힌 자리다. 헌장이 `connect_account` 를 자동으로 돌렸고
// `decideAutoGrant` 도 자동으로 판정했는데, 사용자 화면에는 "새 서비스 붙이기 · 꼭 확인" 카드가
// 그대로 떴다 — 손 선언이 `needsApproval: true` 를 미리 달고 있었기 때문이다.
// **손이 승인을 미리 달면 권한 층의 판정은 화면에 도달하지 못한다.**
//
// 그때 `connector.connect` 에서는 그 한 줄을 걷었는데 `connector.declare` 를 놓쳤고,
// 오너가 든 카드는 정확히 **놓친 쪽**의 것이었다. 회귀 2,088 건이 전부 초록이었다 —
// 어느 검사도 "라이브에 실제로 배선되는 손 선언"을 본 적이 없었기 때문이다.
//
// 그래서 여기서는 도구를 하나씩 알아맞히지 않는다. **liveDeps 가 만든 선언 전체**를 훑어
// 헌장이 자동으로 돌린 종류에 승인이 미리 달려 있으면 잡는다 — 새 손이 늘어도 같은 그물이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveDeps } from '../src/surface/live-context.js';
import { CHARTER_AUTO_KINDS, decideAutoGrant } from '../src/kernel/l2-plan/authority.js';

/** 라이브가 실제로 배선하는 손 선언들. 데모 fixture 가 아니라 사용자에게 도달하는 그 목록이다. */
function 라이브손선언() {
  const deps = liveDeps({}, {});
  return deps.toolDescriptors ?? deps.descriptors ?? [];
}

test('헌장이 자동으로 돌린 종류에 손이 승인을 미리 달지 않는다', () => {
  const 선언들 = 라이브손선언();
  assert.ok(선언들.length > 0, 'liveDeps 가 손 선언을 내지 않으면 이 그물은 아무 것도 못 잡는다');

  const 어긋난것 = 선언들
    .filter((d) => CHARTER_AUTO_KINDS.includes(d.toolKind) && d.needsApproval === true)
    .map((d) => `${d.id}(${d.toolKind})`);

  assert.deepEqual(어긋난것, [], `헌장은 자동인데 손이 승인을 미리 달았다 — 화면에는 카드가 뜬다: ${어긋난것.join(', ')}`);
});

test('그 손들은 실제로 자동으로 판정된다 — 선언과 판정이 같은 답을 낸다', () => {
  for (const d of 라이브손선언().filter((x) => CHARTER_AUTO_KINDS.includes(x.toolKind))) {
    const 판정 = decideAutoGrant({ kind: d.toolKind, revocable: d.reversible, needsApproval: d.needsApproval });
    assert.equal(판정, true, `${d.id}: 헌장 자동 종류인데 승인으로 떨어졌다`);
  }
});

// 반대 방향도 함께 못박는다 — 그물이 "전부 자동"으로 느슨해지면 이 검사는 의미가 없다.
test('안전 바닥 종류에는 이 그물이 자동을 강요하지 않는다', () => {
  assert.equal(decideAutoGrant({ kind: 'pay' }), false, '돈은 언제나 묻는다(헌장 ④)');
  assert.equal(decideAutoGrant({ kind: 'delete' }), false, '되돌릴 수 있다고 밝히지 않은 삭제는 묻는다(헌장 ②)');
  assert.equal(decideAutoGrant({ kind: 'send' }), false, '모르는 상대로의 전송은 묻는다(헌장 ③)');
});
