// Phase 2-3 · 승인·복구 안내가 정책문이 아니라 **이번 요청의 사실**을 말한다.
//
// 실측 결함 둘:
//   1. 카드가 "로컬 파일 실행"이라고만 했다 — 어떤 파일이 어떻게 되는지 알 수 없다.
//   2. 파일 삭제는 휴지통으로 가서 되돌릴 수 있는데 카드는 "되돌릴 수 없음"이라고 겁을 줬다.
//      되돌리기 가능 여부를 **종류로 추측**한 결과다. 그건 도구가 아는 사실이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildActionPlan, describeAction } from '../src/kernel/l2-plan/action-plan.js';
import { explainAuthority } from '../src/kernel/l2-plan/authority.js';
import { interpret } from '../src/kernel/l1-intent/intent.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';

const selfState = buildSelfState(demoEnv());
const grantFor = (text) => buildActionPlan({ intent: interpret(text, { selfState }), selfState }).needsApproval[0];

// ── 무엇이 바뀌는지 구체적으로 ────────────────────────────────────────────
test('승인 카드가 대상과 행동을 말한다(도구 이름만 보여주지 않는다)', () => {
  const g = grantFor('회의록.md 지워줘');
  assert.match(g.approvalPreview.impact, /회의록\.md/);
  assert.match(g.approvalPreview.impact, /지웁니다/);
  assert.notEqual(g.approvalPreview.impact, '로컬 파일 실행');
});

test('옮기기는 어디로 가는지까지 보여준다', () => {
  const g = grantFor('a.md 를 b.md 로 옮겨줘');
  assert.match(g.approvalPreview.impact, /a\.md/);
  assert.match(g.approvalPreview.impact, /b\.md/);
});

test('"무엇이 바뀌나"가 일반론이 아니라 같은 사실을 쓴다', () => {
  const g = grantFor('회의록.md 지워줘');
  assert.equal(g.reason.whatChanges, g.approvalPreview.impact, '카드와 설명이 다른 말을 하면 안 된다');
  assert.ok(!/상태가 바뀌어요/.test(g.reason.whatChanges), '정책문 금지');
});

test('대상이 없으면 지어내지 않고 도구 이름으로 떨어진다', () => {
  assert.equal(describeAction('local.file', undefined), null);
  assert.equal(describeAction('slack.post', { action: 'delete' }), null);
  const g = grantFor('슬랙에 회의 시작이라고 올려줘');
  assert.ok(g.approvalPreview.impact.length > 0);
});

// ── 되돌리기: 추측이 아니라 도구가 밝힌 사실 ──────────────────────────────
test('되돌릴 수 있는 삭제를 "되돌릴 수 없다"고 겁주지 않는다', () => {
  const g = grantFor('회의록.md 지워줘');
  assert.match(g.approvalPreview.cancel, /되살릴 수 있어요|되돌릴 수 있어요/);
  assert.ok(!/되돌릴 수 없|되돌리기 어려워요/.test(g.approvalPreview.cancel), `거짓 경고: ${g.approvalPreview.cancel}`);
  assert.ok(!/되돌리기 어려운/.test(g.reason.why), `같은 카드 안에서 말이 어긋난다: ${g.reason.why}`);
});

test('되돌릴 수 없는 전송은 그대로 말한다(안심시키지 않는다)', () => {
  const g = grantFor('슬랙에 회의 시작이라고 올려줘');
  assert.match(g.approvalPreview.cancel, /되돌릴 수 없어요/);
});

test('삭제라도 승인은 그대로 받는다(문구를 부드럽게 한다고 게이트가 풀리지 않는다)', () => {
  const g = grantFor('회의록.md 지워줘');
  assert.equal(g.approvalRequired, true);
  assert.equal(g.safetyFloor, true);
  assert.equal(g.tier, 'A3');
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
