import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admitInboundEvent } from '../src/kernel/l1-intent/inbound-gate.js';

// user_chat은 항상 우회(respond). fast_chat 자연스러움 보존.
test('user_chat은 게이트를 우회해 항상 respond', () => {
  const r = admitInboundEvent({ source: 'user_chat' });
  assert.equal(r.disposition, 'respond');
  assert.equal(r.admittedAsContext, false);
});

// trusted_runtime_event(복구·보안·권한)는 게이트에 묻히지 않는다 — 절대 ignore되지 않음.
test('trusted_runtime_event는 절대 무시되지 않고 Recovery·Authority로 직행', () => {
  const r = admitInboundEvent({ source: 'trusted_runtime_event' });
  assert.notEqual(r.disposition, 'ignore');
  assert.equal(r.disposition, 'respond');
  assert.equal(r.diagnosticReason.routedTo, 'recovery_authority');
});

// 외부 채널 + 트리거 없음 → 조용히 무시, 사용자 설명문 없음.
test('외부 이벤트에 트리거 없으면 ignore + userSafeReason 없음(알림 콘솔화 방지)', () => {
  const r = admitInboundEvent({ source: 'external_channel', triggerSignals: [] });
  assert.equal(r.disposition, 'ignore');
  assert.equal(r.admittedAsContext, false);
  assert.equal(r.userSafeReason, undefined, 'ignore는 사용자 설명문을 만들지 않는다');
});

// 외부 채널 + mention → respond.
test('외부 이벤트에 결정적 트리거(mention) 있으면 respond', () => {
  const r = admitInboundEvent({ source: 'external_channel', triggerSignals: ['mention'] });
  assert.equal(r.disposition, 'respond');
});

// 트리거 없지만 맥락 backfill 허용 → context_only(사용자 설명문 없음).
test('keepAsContext면 context_only로 맥락 backfill, 설명문 없음', () => {
  const r = admitInboundEvent({ source: 'automation_trigger', triggerSignals: [], keepAsContext: true });
  assert.equal(r.disposition, 'context_only');
  assert.equal(r.admittedAsContext, true);
  assert.equal(r.userSafeReason, undefined);
});

// 모델을 부르지 않는 결정적 판정(신호 집합만 검사) — 알 수 없는 신호는 트리거로 안 침.
test('알 수 없는 신호는 트리거로 인정되지 않는다(결정적)', () => {
  const r = admitInboundEvent({ source: 'external_channel', triggerSignals: ['random_noise'] });
  assert.equal(r.disposition, 'ignore');
});
