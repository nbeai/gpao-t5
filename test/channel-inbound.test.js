// Phase 0-5 · 채널 수신 — 채널이 선언한 수신 정책이 **실제로 소비되는가**.
// 결함(이 슬라이스 전): `inboundPolicy` 는 채널에 선언만 되고 판정에 안 쓰였다. 그래서
// allowlist_only 채널도 mention 하나면 열렸다 — 정책이 장식이었다.
//
// 이 파일은 그 결함만 고정한다. 감사 기준 중 이미 다른 곳에서 고정된 것은 중복하지 않는다:
//   미등록·미연결 채널 차단·미기록 → test/server.test.js
//   전송의 A2 승인·보낸 척 금지·Delivery 원장·실패 시 다음 행동 → test/channel-sender.test.js, test/delivery.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { admitInboundEvent, normalizeInboundEvent } from '../src/kernel/l1-intent/inbound-gate.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { defineChannel } from '../src/kernel/l2-plan/channel-registry.js';
import { defineConnector } from '../src/kernel/l2-plan/connector-profile.js';
import { AllowlistStore } from '../src/surface/allowlist-store.js';

// ── 커널 게이트: 정책이 판정에 쓰인다 ────────────────────────────────────
test('allowlist_only 는 mention 만으로 열리지 않는다(정책이 장식이면 여기서 respond 가 된다)', () => {
  const g = admitInboundEvent({ source: 'external_channel', triggerSignals: ['mention'], channelPolicy: 'allowlist_only' });
  assert.equal(g.disposition, 'ignore');
  assert.equal(g.diagnosticReason.reason, 'sender_not_allowlisted');
  assert.equal(g.userSafeReason, undefined, '무시한 것은 사용자에게 설명하지 않는다(알림 콘솔화 방지)');
});

test('allowlist_only 라도 허용된 발신자는 처리한다(막기만 하는 게이트가 아니다)', () => {
  const g = admitInboundEvent({ source: 'external_channel', triggerSignals: ['allowlisted'], channelPolicy: 'allowlist_only' });
  assert.equal(g.disposition, 'respond');
});

test('mention_required 는 부름·DM 이 있어야, dm_open 은 DM 만으로 열린다', () => {
  const base = { source: 'external_channel', channelConnected: true };
  assert.equal(admitInboundEvent({ ...base, triggerSignals: [], channelPolicy: 'mention_required' }).disposition, 'ignore');
  assert.equal(admitInboundEvent({ ...base, triggerSignals: ['mention'], channelPolicy: 'mention_required' }).disposition, 'respond');
  assert.equal(admitInboundEvent({ ...base, triggerSignals: ['direct_message'], channelPolicy: 'dm_open' }).disposition, 'respond');
});

test('커널도 스스로 연결을 본다 — 미연결 채널은 mention 이 있어도 응답하지 않는다(이중 방어)', () => {
  const g = admitInboundEvent({ source: 'external_channel', triggerSignals: ['mention'], channelConnected: false });
  assert.equal(g.disposition, 'ignore');
  assert.equal(g.diagnosticReason.reason, 'channel_not_connected');
});

test('정규화가 채널 메타·정책·연결 상태를 함께 싣는다(하나라도 빠지면 게이트가 판단 못 한다)', () => {
  const e = normalizeInboundEvent({
    channel: 'telegram', chatId: 'c1', userId: 'u1', text: '안녕',
    isMention: true, inboundPolicy: 'allowlist_only', connected: true,
  });
  assert.deepEqual(e.channelMeta, { channel: 'telegram', chatId: 'c1', userId: 'u1' });
  assert.equal(e.channelPolicy, 'allowlist_only');
  assert.equal(e.channelConnected, true);
  assert.deepEqual(e.triggerSignals, ['mention']);
});

// ── 서버 경로: 레지스트리의 정책이 커널까지 실제로 도달한다 ──────────────
// 서버가 정책을 안 실으면 위 커널 수정은 무용지물이다. 그래서 HTTP 로 관통 검사한다.
const allowlistOnlyDeps = () => {
  const connector = defineConnector({ id: 'telegram', label: '텔레그램', kind: 'channel', authState: 'oauth', connected: true });
  return {
    connectors: [connector],
    channels: [defineChannel({ id: 'telegram', connector, inboundPolicy: 'allowlist_only', outboundTool: 'telegram.send' })],
  };
};

async function withServer(fn, deps = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-inbound-'));
  const store = new SessionStore(dir);
  // P5-1: 허용 발신자는 **저장된 목록**으로 판정한다(요청 본문의 주장이 아니라).
  const allowlistStore = new AllowlistStore(dir);
  await allowlistStore.allow('telegram', { userId: 'u-allowed', label: '오너' });
  const server = makeServer({ store, allowlistStore, ...deps });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
  const inbound = async (body) => (await fetch(`${base}/channel/inbound`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, channel: 'telegram', ...body }),
  })).json();
  const transcript = async () => (await store.load(session.id)).transcript;
  try { return await fn({ inbound, transcript, base, session }); }
  finally { await new Promise((r) => server.close(r)); }
}

test('allowlist_only 채널: 목록 밖 발신자는 부르더라도 처리·기록하지 않는다(HTTP 관통)', async () => {
  await withServer(async ({ inbound, transcript }) => {
    const r = await inbound({ text: '야 답해봐', isMention: true });
    assert.equal(r.kind, 'gated', '서버가 정책을 안 실으면 여기서 응답이 나온다');
    assert.equal((await transcript()).length, 0);
  }, allowlistOnlyDeps());
});

test('allowlist_only 채널: 허용된 발신자만 턴으로 들어가고 대화에 남는다', async () => {
  await withServer(async ({ inbound, transcript }) => {
    const r = await inbound({ text: '안녕', chatId: 'c9', userId: 'u-allowed' });
    assert.ok(['reply', 'clarify', 'approval'].includes(r.kind), `실제: ${r.kind}`);
    assert.equal(r.channelMeta.chatId, 'c9', '어느 방에서 온 말인지 잃지 않는다');
    assert.ok((await transcript()).length >= 2);
  }, allowlistOnlyDeps());
});

test('외부에서 들어온 전송 요청도 승인 게이트를 탄다(외부라고 봐주지 않는다)', async () => {
  await withServer(async ({ inbound }) => {
    const r = await inbound({ text: '슬랙에 회의 시작이라고 올려줘', userId: 'u-allowed' });
    assert.notEqual(r.kind, 'reply', '승인 없이 보내면 안 된다');
    assert.ok(['approval', 'clarify'].includes(r.kind), `실제: ${r.kind}`);
  }, allowlistOnlyDeps());
});

// ── 라이브 산출물 (절대원칙 1: 소스가 아니라 사용자에게 도달하는 것을 검사한다) ──
// 실제로 터진 결함: liveDeps 가 channels 는 실제 자격에서 파생해 넘기면서 **connectors 는 안 넘겨**
// 서버가 demo fixture(텔레그램 connected:true 하드코딩)로 폴백했다. 토큰이 없는데도 라이브에서
// 텔레그램이 "연결됨"으로 보이고 수신까지 열렸다. demo fixture 주석이 "라이브에 쓰지 말라"고
// 경고한 바로 그 일이 라이브에서 일어나고 있었다.
test('라이브: 토큰 없는 채널은 수신이 열리지 않는다(demo fixture 로 폴백하지 않는다)', async () => {
  const { liveDeps } = await import('../src/surface/live-context.js');
  const live = liveDeps({}); // 채널 토큰 없음
  await withServer(async ({ inbound, transcript }) => {
    const r = await inbound({ text: '이거 봐줘', isMention: true });
    assert.equal(r.kind, 'blocked', `자격 없는 채널이 열렸다: ${JSON.stringify(r).slice(0, 120)}`);
    assert.equal(r.reason, 'channel_not_ready');
    assert.equal((await transcript()).length, 0);
  }, { env: live.env, tools: live.tools, channels: live.channels, connectors: live.connectors });
});

test('라이브: 도구함도 같은 진실을 본다 — 토큰 없는 채널을 연결됨으로 보이지 않는다', async () => {
  const { liveDeps } = await import('../src/surface/live-context.js');
  const live = liveDeps({});
  await withServer(async ({ base }) => {
    const { connectors } = await (await fetch(`${base}/connectors`)).json();
    const tg = connectors.find((c) => c.id === 'telegram');
    assert.ok(tg, '텔레그램은 목록에 보여야 한다(숨기는 게 아니라 상태를 정직하게)');
    assert.notEqual(tg.readiness, 'ok', '자격이 없는데 초록으로 보이면 안 된다');
  }, { env: live.env, tools: live.tools, channels: live.channels, connectors: live.connectors });
});
