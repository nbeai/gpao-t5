// Phase 2-3 · 승인·복구 안내가 정책문이 아니라 **이번 요청의 사실**을 말한다.
//
// 실측 결함 둘:
//   1. 카드가 "로컬 파일 실행"이라고만 했다 — 어떤 파일이 어떻게 되는지 알 수 없다.
//   2. 파일 삭제는 휴지통으로 가서 되돌릴 수 있는데 카드는 "되돌릴 수 없음"이라고 겁을 줬다.
//      되돌리기 가능 여부를 **종류로 추측**한 결과다. 그건 도구가 아는 사실이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildActionPlan, describeAction } from '../src/kernel/l2-plan/action-plan.js';
import { explainAuthority, grantFor as authorityGrant } from '../src/kernel/l2-plan/authority.js';
import { interpret } from '../src/kernel/l1-intent/intent.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';

const selfState = buildSelfState(demoEnv());
const grantFor = (text) => buildActionPlan({ intent: interpret(text, { selfState }), selfState }).needsApproval[0];

// ── 무엇이 바뀌는지 구체적으로 ────────────────────────────────────────────
//
// 자동성 헌장(2026-08-03) 이후 되돌릴 수 있는 파일 작업에는 승인 카드가 없다. **재는 계약은
// 그대로다** — 사용자가 읽는 문장이 도구 이름이 아니라 이번 요청의 사실을 말하는가.
// 그래서 관측점만 카드에서 그 문장을 만드는 자리(`describeAction`)로 옮긴다.
// 카드가 뜨는 행동(전송 등)에서는 아래 `grantFor` 검사들이 같은 사실을 카드에서 다시 확인한다.
test('행동 설명이 대상과 행동을 말한다(도구 이름만 보여주지 않는다)', () => {
  const impact = describeAction('local.file', { action: 'delete', path: '회의록.md' });
  assert.match(impact, /회의록\.md/);
  assert.match(impact, /지웁니다/);
  assert.notEqual(impact, '로컬 파일 실행');
});

test('옮기기는 어디로 가는지까지 보여준다', () => {
  const impact = describeAction('local.file', { action: 'move', path: 'a.md', to: 'b.md' });
  assert.match(impact, /a\.md/);
  assert.match(impact, /b\.md/);
});

test('"무엇이 바뀌나"가 일반론이 아니라 같은 사실을 쓴다', () => {
  const impact = describeAction('local.file', { action: 'delete', path: '회의록.md' });
  const g = authorityGrant({ kind: 'delete', label: 'local.file', preview: { impact }, revocable: true });
  assert.equal(g.reason.whatChanges, impact, '설명과 미리보기가 다른 말을 하면 안 된다');
  assert.ok(!/상태가 바뀌어요/.test(g.reason.whatChanges), '정책문 금지');
});

// **자동으로 한 일도 무엇을 했는지 말한다.** 헌장이 카드를 걷은 자리를 메우는 문장이다 —
// 예전엔 삭제·연결·자동화가 전부 "되돌릴 수 있는 가벼운 정리"라는 한 문장을 달고 나갔다(실측).
test('자동으로 실행한 일은 무엇을 했는지와 되돌릴 길을 함께 말한다', () => {
  const del = authorityGrant({ kind: 'delete', revocable: true }).reason;
  assert.match(del.why, /휴지통/, `자동 삭제 설명이 사실을 안 말한다: ${del.why}`);
  assert.ok(!/가벼운 정리/.test(del.why), '삭제는 가벼운 정리가 아니다');
  const conn = authorityGrant({ kind: 'connect_account' }).reason;
  assert.ok(!/가벼운 정리/.test(conn.why), `연결이 가벼운 정리로 설명된다: ${conn.why}`);
});

test('대상이 없으면 지어내지 않고 도구 이름으로 떨어진다', () => {
  assert.equal(describeAction('local.file', undefined), null);
  assert.equal(describeAction('slack.post', { action: 'delete' }), null);
  const g = grantFor('슬랙에 회의 시작이라고 올려줘');
  assert.ok(g.approvalPreview.impact.length > 0);
});

// ── 되돌리기: 추측이 아니라 도구가 밝힌 사실 ──────────────────────────────
// 헌장 이후 되돌릴 수 있는 삭제는 카드가 아니라 **자동 실행 설명**으로 사용자에게 간다.
// 재는 것은 그대로다 — 되돌릴 수 있는 일을 "되돌릴 수 없다"고 겁주지 않는가.
test('되돌릴 수 있는 삭제를 "되돌릴 수 없다"고 겁주지 않는다', () => {
  const 파일손삭제 = { kind: 'delete', revocable: true, reversibleNote: '휴지통에 남아 "되돌려줘"로 되살릴 수 있어요' };
  const r = authorityGrant(파일손삭제).reason;
  assert.match(r.reversible, /되살릴 수 있어요|되돌릴 수 있어요/);
  assert.ok(!/되돌릴 수 없|되돌리기 어려워요/.test(r.reversible), `거짓 경고: ${r.reversible}`);
  assert.ok(!/되돌리기 어려운/.test(r.why), `같은 설명 안에서 말이 어긋난다: ${r.why}`);
});

test('되돌릴 수 없는 전송은 그대로 말한다(안심시키지 않는다)', () => {
  const g = grantFor('슬랙에 회의 시작이라고 올려줘');
  assert.match(g.approvalPreview.cancel, /되돌릴 수 없어요/);
});

// 이 검사는 원래 **"부드러운 문구가 게이트를 열지 않는다"** 는 문지기였다. 헌장(2026-08-03)이
// 정확히 그 문을 설계로 열었다 — 되돌릴 수 있는 삭제는 자동이다. 그래서 문지기를 없애는 대신
// **무엇이 문을 여는지**를 못박는다: 문을 여는 것은 문구가 아니라 **되돌림 선언 하나**다.
// 선언이 없으면 여전히 묻는다. (선언이 거짓일 때는 `boundary-invariants` 의 선언-실제 대조와
// 돌연변이 스윕의 휴지통 보장 변이가 잡는다 — 보호를 없앤 것이 아니라 옮겼다.)
test('삭제를 자동으로 여는 것은 문구가 아니라 되돌림 선언이다', () => {
  assert.equal(authorityGrant({ kind: 'delete', revocable: true }).approvalRequired, false, '휴지통이 있으면 자동');
  assert.equal(authorityGrant({ kind: 'delete' }).approvalRequired, true, '되돌림을 안 밝히면 묻는다');
  assert.equal(authorityGrant({ kind: 'delete', reversibleNote: '되살릴 수 있어요' }).approvalRequired, true,
    '부드러운 문구만으로는 게이트가 풀리지 않는다');
  assert.equal(authorityGrant({ kind: 'delete' }).tier, 'A3', '등급표는 그대로다');
});

// ── 불변식: 되돌리기 문구는 선언을 따른다 ─────────────────────────────────
test('불변식: 도구가 밝힌 사실이 종류 추측을 이긴다', () => {
  const declaredOk = explainAuthority({ kind: 'delete', label: 'x', revocable: true, reversibleNote: '휴지통에 있어요' });
  assert.equal(declaredOk.reversible, '휴지통에 있어요');

  const declaredNo = explainAuthority({ kind: 'organize', label: 'x', revocable: false });
  assert.match(declaredNo.reversible, /어려워요/, '되돌릴 수 없다고 밝혔으면 가벼운 종류라도 그대로 말한다');

  const unknown = explainAuthority({ kind: 'delete', label: 'x' });
  assert.match(unknown.reversible, /어려워요/, '모르면 안전한 쪽으로 말한다');
});
