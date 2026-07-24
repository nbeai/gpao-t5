import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineConnector, connectorReadiness, sendNeedsApproval, connectorToConnection } from '../src/kernel/l2-plan/connector-profile.js';
import { normalizeInboundEvent } from '../src/kernel/l1-intent/inbound-gate.js';

test('connectorReadiness: 연결 안 됨=disconnected, 연결+자격=ok', () => {
  assert.equal(connectorReadiness(defineConnector({ id: 'x', connected: false })), 'disconnected');
  assert.equal(connectorReadiness(defineConnector({ id: 'tg', connected: true, authState: 'oauth' })), 'ok');
});

// 핵심: auth ≠ approval. 연결·인증돼도 외부 전송은 승인 필요(헌법 §3-6).
test('auth≠approval: 연결·인증된 커넥터도 전송은 승인 필요', () => {
  const c = defineConnector({ id: 'tg', label: '텔레그램', connected: true, authState: 'oauth' });
  const conn = connectorToConnection(c);
  assert.equal(conn.status, 'usable', '실행 가능(연결·인증됨)');
  assert.equal(conn.needsApproval, true, '그래도 전송은 승인');
  assert.equal(sendNeedsApproval(), true);
});

test('연결 안 된 커넥터는 needs_connection', () => {
  const conn = connectorToConnection(defineConnector({ id: 'sl', connected: false }));
  assert.equal(conn.status, 'needs_connection');
  assert.equal(conn.executable, false);
});

// 단일 정규화: 채널이 달라도 같은 이벤트 형태로 InboundEventGate를 탄다.
test('normalizeInboundEvent: 채널 플래그 → triggerSignals(결정적)', () => {
  const e = normalizeInboundEvent({ channel: 'telegram', chatId: '1', text: '이거 봐줘', isMention: true });
  assert.equal(e.source, 'external_channel');
  assert.deepEqual(e.triggerSignals, ['mention']);
  assert.equal(e.channelMeta.channel, 'telegram');
  assert.deepEqual(normalizeInboundEvent({ channel: 't', text: '그룹 잡담' }).triggerSignals, []);
  const dm = normalizeInboundEvent({ channel: 't', text: 'hi', isDirectMessage: true, isAllowlistedUser: true });
  assert.deepEqual(dm.triggerSignals.sort(), ['allowlisted', 'direct_message']);
});
