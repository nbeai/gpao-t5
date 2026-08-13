import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTier, grantFor, isExecutionAllowed } from '../src/kernel/l2-plan/authority.js';

test('읽기·요약은 A0 자동', () => {
  assert.equal(classifyTier({ kind: 'read' }), 'A0');
  const g = grantFor({ label: '읽기', kind: 'read' });
  assert.equal(g.approvalRequired, false);
  assert.equal(isExecutionAllowed(g), true);
});

// S20: 외부 전송은 A2, 승인 없이는 실행 불가.
test('외부 전송(A2)은 승인 전 실행 불가', () => {
  const g = grantFor({ label: '메일 발송', kind: 'send', counterpartKnown: false });
  assert.equal(g.tier, 'A2');
  assert.equal(g.approvalRequired, true);
  assert.equal(g.granted, false);
  assert.equal(isExecutionAllowed(g), false); // S23: 미승인이면 실행 금지
  assert.ok(g.approvalPreview, 'A2 는 approvalPreview 를 가진다');
});

test('승인되면 실행 허용', () => {
  const g = grantFor({ label: '메일 발송', kind: 'send', counterpartKnown: false });
  assert.equal(isExecutionAllowed({ ...g, granted: true }), true);
});

// S22: 삭제·결제·공개는 A3, 기본 non-revocable.
test('비가역 삭제(A3)는 강한 승인, 되돌리기 불가', () => {
  const g = grantFor({ label: '삭제', kind: 'delete', revocable: false });
  assert.equal(g.tier, 'A3');
  assert.equal(g.approvalRequired, true);
  assert.equal(g.revocable, false);
});

test('애매하면 높은 등급으로 — 알 수 없는 종류는 최소 A0 이상 안전값', () => {
  // 알 수 없는 kind 는 read(A0)로 떨어지되, 외부성이 있는 종류는 명시적으로 상향돼 있어야 한다.
  assert.equal(classifyTier({ kind: 'promote_memory' }), 'A2');
  assert.equal(classifyTier({ kind: 'publish' }), 'A3');
});
