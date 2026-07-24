import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyModelAuth, buildSelfState, isToolExecutable } from '../src/kernel/l0-evidence/self-state.js';

// S28/S29: billing 과 rate_limit 은 반드시 구분된다(T3 오분류 회귀 방지).
test('billing 신호는 billing_blocked (재시도 아님)', () => {
  assert.equal(classifyModelAuth('insufficient_quota'), 'billing_blocked');
  assert.equal(classifyModelAuth('You exceeded your current quota'), 'billing_blocked');
});

test('rate limit 신호는 rate_limited (billing 아님)', () => {
  assert.equal(classifyModelAuth('rate_limit'), 'rate_limited');
  assert.equal(classifyModelAuth('429 Too Many Requests'), 'rate_limited');
});

test('billing 과 rate_limit 은 서로 다른 상태로 분류된다', () => {
  assert.notEqual(classifyModelAuth('insufficient_quota'), classifyModelAuth('429'));
});

test('auth 실패와 정상은 구분된다', () => {
  assert.equal(classifyModelAuth('invalid_api_key'), 'auth_failed');
  assert.equal(classifyModelAuth('ok'), 'usable');
  assert.equal(classifyModelAuth(undefined), 'usable');
});

// S15: 목록에 있어도 executable=false 면 실행 가능 아님(헌법 §3-3).
test('연결됐지만 실행 준비 안 된 도구는 실행 불가로 판정', () => {
  const s = buildSelfState({
    model: { id: 'm' },
    connections: [{ id: 'slack.post', connected: true, executable: false }],
  });
  assert.equal(isToolExecutable(s, 'slack.post'), false);
  // 한계는 사용자 라벨로 표시하고 내부 id 는 노출하지 않는다(안티 대시보드).
  assert.ok(s.limits.some((l) => l.includes('슬랙 게시')));
  assert.ok(!s.limits.some((l) => l.includes('slack.post')));
});

// Phase 5.1(§6): connectedTools.status 세분화 + executable 파생.
test('connectedTools.status: usable/needs_connection/blocked 세분화, executable은 파생', () => {
  const s = buildSelfState({
    model: { id: 'm' },
    connections: [
      { id: 'a', connected: true, executable: true },
      { id: 'b', connected: false, executable: false },
      { id: 'c', connected: true, executable: false },
      { id: 'd', connected: true, executable: false, needs: 'auth' },
    ],
  });
  const by = Object.fromEntries(s.connectedTools.map((t) => [t.id, t]));
  assert.equal(by.a.status, 'usable');
  assert.equal(by.a.executable, true);
  assert.equal(by.b.status, 'needs_connection');
  assert.equal(by.c.status, 'blocked');
  assert.equal(by.d.status, 'needs_auth');
  // executable은 status===usable의 파생
  assert.equal(by.c.executable, false);
  assert.equal(by.d.executable, false);
});

test('billing_blocked 는 결제 문구의 다음 안전 행동을 준다(재시도 문구 아님)', () => {
  const s = buildSelfState({ model: { id: 'm', authSignal: 'insufficient_quota' } });
  assert.equal(s.modelAuthState, 'billing_blocked');
  assert.match(s.nextSafeAction, /결제/);
  assert.doesNotMatch(s.nextSafeAction, /잠시 후/);
});
