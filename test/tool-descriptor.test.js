import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineTool, evaluateStatus, toConnection, classifyRetry } from '../src/kernel/l2-plan/tool-descriptor.js';

test('defineTool 기본값: owner=core, executor=id, availability=connected', () => {
  const d = defineTool({ id: 'x', label: 'X' });
  assert.equal(d.owner, 'core');
  assert.equal(d.executor, 'x');
  assert.deepEqual(d.availability, [{ kind: 'connected' }]);
  assert.equal(d.needsApproval, false);
});

// availability 신호 → status. allOf: 하나라도 불만족이면 그 신호 상태.
test('evaluateStatus: availability 신호를 사실에 대입해 판정', () => {
  const d = defineTool({ id: 'm', availability: [{ kind: 'connected' }, { kind: 'auth' }] });
  assert.equal(evaluateStatus(d, { connected: false }), 'needs_connection');
  assert.equal(evaluateStatus(d, { connected: true, auth: false }), 'needs_auth');
  assert.equal(evaluateStatus(d, { connected: true, auth: true }), 'usable');
  const c = defineTool({ id: 'c', availability: [{ kind: 'connected' }, { kind: 'config' }] });
  assert.equal(evaluateStatus(c, { connected: true, config: false }), 'needs_config');
});

// 핵심: auth ≠ approval. 실행 가능(usable)해도 승인이 필요할 수 있다(별도 축).
test('auth와 approval은 분리 — usable이어도 needsApproval일 수 있다', () => {
  const d = defineTool({ id: 'slack.post', toolKind: 'send', availability: [{ kind: 'connected' }], needsApproval: true });
  const conn = toConnection(d, { connected: true });
  assert.equal(conn.status, 'usable');
  assert.equal(conn.executable, true);
  assert.equal(conn.needsApproval, true, '실행 가능해도 승인 필요는 별개');
});

// 실패 재시도 분류(Hermes permanent/transient 흡수).
test('classifyRetry: 차단·취소=permanent, 실패·타임아웃=transient', () => {
  assert.equal(classifyRetry('none'), 'none');
  assert.equal(classifyRetry('blocked'), 'permanent');
  assert.equal(classifyRetry('cancelled'), 'permanent');
  assert.equal(classifyRetry('failed'), 'transient');
  assert.equal(classifyRetry('timeout'), 'transient');
});
