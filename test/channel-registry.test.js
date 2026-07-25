import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineChannel, channelStatus, projectChannels, INBOUND_POLICIES } from '../src/kernel/l2-plan/channel-registry.js';
import { defineConnector } from '../src/kernel/l2-plan/connector-profile.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { liveDeps, liveChannels } from '../src/surface/live-context.js';

// P6-16 Slice-1 ChannelRegistry — 새 기능이 아니라 정리. connector 자격·readiness·전송 승인을 한 곳으로 묶고
// 사용자 언어 status + doctor 진단을 낸다. 실제 외부 전송·설정 변경은 없다. 경계: connected ≠ approved.

const ch = (p) => defineChannel({ id: p.id, connector: defineConnector(p.connector), inboundPolicy: p.inboundPolicy, outboundTool: p.outboundTool });

// ── 미연결·미자격은 절대 "준비됨(초록)"으로 보이지 않는다 ──
test('미연결 채널은 ready(초록)로 보이지 않고 연결 안내를 준다', () => {
  const s = channelStatus(ch({ id: 'slack.channel', connector: { id: 'slack.channel', label: '슬랙 채널', authState: 'oauth', connected: false } }));
  assert.equal(s.ready, false, '미연결은 초록 아님');
  assert.equal(s.status, 'needs_connection');
  assert.equal(s.diagnosis.ok, false);
  assert.equal(s.diagnosis.nextAction, 'connect');
  assert.match(s.userSafe, /연결/);
});

test('자격 미확립 채널은 needs_auth — 로그인 안내', () => {
  const s = channelStatus(ch({ id: 'x', connector: { id: 'x', label: 'X', authState: 'pending', connected: true } }));
  assert.equal(s.ready, false);
  assert.equal(s.status, 'needs_auth');
  assert.equal(s.diagnosis.nextAction, 'authenticate');
  assert.match(s.userSafe, /로그인|토큰/);
});

test('연결·자격 갖춘 채널만 ready(초록)', () => {
  const s = channelStatus(ch({ id: 'telegram', connector: { id: 'telegram', label: '텔레그램', authState: 'oauth', connected: true } }));
  assert.equal(s.ready, true);
  assert.equal(s.status, 'ready');
  assert.equal(s.diagnosis.ok, true);
  assert.equal(s.diagnosis.nextAction, null);
});

// ── connected ≠ approved: 준비됐어도 전송은 항상 승인 ──
test('연결됨과 승인됨은 분리 — ready여도 전송은 항상 승인(A2)', () => {
  const ready = channelStatus(ch({ id: 'telegram', connector: { id: 'telegram', label: '텔레그램', authState: 'oauth', connected: true } }));
  assert.equal(ready.ready, true);
  assert.equal(ready.sendNeedsApproval, true, '연결됐다고 자유 전송 아님');
  const off = channelStatus(ch({ id: 'slack.channel', connector: { id: 'slack.channel', label: '슬랙 채널', authState: 'oauth', connected: false } }));
  assert.equal(off.sendNeedsApproval, true, '미연결도 당연히 승인');
});

// ── 사용자 언어: 내부 코드가 userSafe/진단에 새지 않는다 ──
test('userSafe·진단 문구에 내부 코드(readiness enum)가 노출되지 않는다', () => {
  for (const conn of [
    { authState: 'oauth', connected: true },
    { authState: 'oauth', connected: false },
    { authState: 'pending', connected: true },
  ]) {
    const s = channelStatus(ch({ id: 'c', connector: { id: 'c', label: '채널', ...conn } }));
    const devTerms = /readiness|disconnected|needs_auth|degraded|\bok\b|authState/i;
    assert.doesNotMatch(s.userSafe, devTerms, 'status 문구는 사용자 언어');
    assert.doesNotMatch(s.diagnosis.detail, devTerms, 'doctor 문구는 사용자 언어');
  }
});

// inbound 정책은 선언값(게이팅 자체는 inbound-gate가 결정적으로 수행 — 중복 아님).
test('채널은 inbound 정책·outbound 도구 바인딩을 선언으로 싣는다', () => {
  const s = channelStatus(ch({ id: 'telegram', connector: { id: 'telegram', label: '텔레그램', authState: 'oauth', connected: true }, inboundPolicy: 'mention_required', outboundTool: 'telegram.send' }));
  assert.ok(INBOUND_POLICIES.includes(s.inboundPolicy));
  assert.equal(s.inboundPolicy, 'mention_required');
  assert.equal(s.outboundTool, 'telegram.send');
});

// ── 서버 /channels: 사용자 안전 뷰(원시 readiness 코드 미노출) ──
async function withServer(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-ch-'));
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools() });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try { return await fn(`http://127.0.0.1:${port}`); }
  finally { await new Promise((r) => server.close(r)); }
}

test('GET /channels(demo fixture): 준비/미연결을 사용자 언어로, 전송은 모두 승인 필요', async () => {
  await withServer(async (base) => {
    const { channels } = await (await fetch(`${base}/channels`)).json();
    const tg = channels.find((c) => c.id === 'telegram');
    const sl = channels.find((c) => c.id === 'slack.channel');
    assert.equal(tg.ready, true, '데모 fixture 텔레그램은 준비됨');
    assert.equal(sl.ready, false, '미연결 슬랙 채널은 준비 안 됨(초록 아님)');
    assert.match(sl.userSafe, /연결/);
    assert.ok(channels.every((c) => c.sendNeedsApproval === true), '모든 채널 전송은 A2');
    assert.ok(channels.every((c) => c.readiness === undefined), '원시 readiness 코드 미노출');
    assert.ok(channels.every((c) => typeof c.userSafe === 'string' && c.diagnosis), '사용자 상태+doctor 포함');
  });
});

// ── 라이브 표면은 실제 자격에서 파생(P6-16 blocker) ── "보이는 것 = 실제 가능한 것".
//   demoChannels(고정 fixture)로 라이브가 telegram을 초록으로 오표시하면 안 된다(2.0-A slack 계열).
test('liveDeps: 자격 없으면 telegram/slack.channel 모두 ready 아님(fixture 오표시 금지)', () => {
  const { channels } = liveDeps({}); // 토큰 없음
  const view = projectChannels(channels);
  const tg = view.find((c) => c.id === 'telegram');
  const sl = view.find((c) => c.id === 'slack.channel');
  assert.equal(tg.ready, false, '토큰 없으면 텔레그램은 준비됨 아님');
  assert.equal(sl.ready, false, '토큰 없으면 슬랙 채널도 준비됨 아님');
  assert.match(tg.userSafe, /연결/, '연결 안내를 준다');
});

test('liveChannels: 실제 토큰이 있을 때만 ready', () => {
  const off = projectChannels(liveChannels({}));
  assert.equal(off.find((c) => c.id === 'telegram').ready, false);
  const on = projectChannels(liveChannels({ TELEGRAM_BOT_TOKEN: 'bot-xxx' }));
  assert.equal(on.find((c) => c.id === 'telegram').ready, true, '토큰 있으면 준비됨');
  // 슬랙 채널은 슬랙 토큰이 있어야 준비됨.
  assert.equal(off.find((c) => c.id === 'slack.channel').ready, false);
  assert.equal(projectChannels(liveChannels({ SLACK_BOT_TOKEN: 'xoxb' })).find((c) => c.id === 'slack.channel').ready, true);
});

// 라이브 자격을 넘긴 서버의 /channels는 토큰 없이 telegram을 준비됨으로 말하지 않는다.
test('GET /channels(라이브 자격 주입): 토큰 없으면 telegram ready 아님', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-chlive-'));
  const { env, tools, channels } = liveDeps({}); // 토큰 없음 → 라이브 채널
  const server = makeServer({ store: new SessionStore(dir), env, tools, channels });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try {
    const { channels: view } = await (await fetch(`http://127.0.0.1:${port}/channels`)).json();
    const tg = view.find((c) => c.id === 'telegram');
    assert.equal(tg.ready, false, '라이브 자격 없이 telegram을 "받을 준비됨"으로 말하지 않는다');
    assert.match(tg.userSafe, /연결/);
  } finally { await new Promise((r) => server.close(r)); }
});
