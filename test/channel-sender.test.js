import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeChannelSender } from '../src/runtime/channel-sender.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { classifyRetry } from '../src/kernel/l2-plan/tool-descriptor.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoTools, demoEnv } from '../src/surface/demo-context.js';

// 주입 fetch — 실 API(slack.com/telegram) 대신 응답을 통제한다.
function fakeFetch(status, json) {
  return async () => ({ status, json: async () => json });
}

test('슬랙 전송 성공: ok:true → sent', async () => {
  const s = makeChannelSender({ channel: 'slack', token: 'x', defaultTarget: '#general', fetchImpl: fakeFetch(200, { ok: true }) });
  const out = await s.handler({ text: '안녕' });
  assert.ok(out.result?.sent);
  assert.equal(out.result.channel, 'slack');
  assert.match(out.userSafeSummary, /슬랙/);
});

test('텔레그램 전송 성공: ok:true → sent', async () => {
  const s = makeChannelSender({ channel: 'telegram', token: 'x', defaultTarget: '123', fetchImpl: fakeFetch(200, { ok: true, result: {} }) });
  const out = await s.handler({ text: '안녕' });
  assert.ok(out.result?.sent);
  assert.match(out.userSafeSummary, /텔레그램/);
});

// 자격 없음 → 몰래 안 보낸다. fetch도 안 친다.
test('자격 없음: 토큰 없으면 needs_auth(blocked), 전송 시도 안 함', async () => {
  let fetched = false;
  const s = makeChannelSender({ channel: 'slack', defaultTarget: '#g', fetchImpl: async () => { fetched = true; return fakeFetch(200, { ok: true })(); } });
  const out = await s.handler({ text: '안녕' });
  assert.equal(out.blocked, true);
  assert.equal(out.sendState, 'needs_auth');
  assert.equal(fetched, false, '자격 없으면 전송 자체를 안 한다');
});

test('대상 없음: target 없으면 blocked(보낸 척 안 함)', async () => {
  const s = makeChannelSender({ channel: 'slack', token: 'x', fetchImpl: fakeFetch(200, { ok: true }) });
  const out = await s.handler({ text: '안녕' });
  assert.equal(out.blocked, true);
  assert.match(out.userSafeSummary, /대상/);
});

// auth_failed는 permanent(재시도로 안 풀림) → blocked → classifyRetry permanent.
test('인증 실패: invalid_auth → blocked(permanent), 자동화면 즉시 포기', async () => {
  const s = makeChannelSender({ channel: 'slack', token: 'bad', defaultTarget: '#g', fetchImpl: fakeFetch(200, { ok: false, error: 'invalid_auth' }) });
  const out = await s.handler({ text: '안녕' });
  assert.equal(out.blocked, true);
  assert.equal(out.sendState, 'auth_failed');
  assert.equal(classifyRetry('blocked'), 'permanent');
});

// rate_limited는 transient → failed → classifyRetry transient(백오프 재시도, P6-4 연결).
test('레이트리밋: 429 → failed(transient), 자동화면 백오프', async () => {
  const s = makeChannelSender({ channel: 'slack', token: 'x', defaultTarget: '#g', fetchImpl: fakeFetch(429, { ok: false, error: 'ratelimited' }) });
  const out = await s.handler({ text: '안녕' });
  assert.equal(out.failed, true);
  assert.equal(out.sendState, 'rate_limited');
  assert.equal(classifyRetry('failed'), 'transient');
});

test('timeout: 끝나지 않는 전송은 timeout(failed), 보낸 척 안 함', async () => {
  const s = makeChannelSender({ channel: 'slack', token: 'x', defaultTarget: '#g', fetchImpl: () => new Promise(() => {}), timeoutMs: 30 });
  const out = await s.handler({ text: '안녕' });
  assert.equal(out.failed, true);
  assert.equal(out.sendState, 'timeout');
  assert.equal(out.result, undefined);
});

// ToolRunner 통합: sent→delivered / auth_failed→blocked(permanent) / rate_limited→failed(transient).
test('ToolRunner: 전송 성공은 delivered, 인증실패는 blocked, 레이트리밋은 failed', async () => {
  const env = { model: { authSignal: 'ok' }, connections: [{ id: 'slack.post', status: 'usable', connected: true, toolKind: 'send', needsApproval: true }], grantedAuthorities: [] };
  const self = buildSelfState(env);
  const okRun = new ToolRunner({ 'slack.post': makeChannelSender({ channel: 'slack', token: 'x', defaultTarget: '#g', fetchImpl: fakeFetch(200, { ok: true }) }) });
  const sent = await okRun.run('slack.post', { text: '안녕' }, self);
  assert.equal(sent.failureState, 'none');
  assert.equal(sent.lifecycle, 'delivered');

  const authRun = new ToolRunner({ 'slack.post': makeChannelSender({ channel: 'slack', token: 'bad', defaultTarget: '#g', fetchImpl: fakeFetch(200, { ok: false, error: 'invalid_auth' }) }) });
  const authRec = await authRun.run('slack.post', { text: '안녕' }, self);
  assert.equal(authRec.failureState, 'blocked');

  const rlRun = new ToolRunner({ 'slack.post': makeChannelSender({ channel: 'slack', token: 'x', defaultTarget: '#g', fetchImpl: fakeFetch(429, { ok: false, error: 'ratelimited' }) }) });
  const rlRec = await rlRun.run('slack.post', { text: '안녕' }, self);
  assert.equal(rlRec.failureState, 'failed', 'transient — 자동화 백오프 대상');
});

// ── 핵심 A2 경계: 실제 sender를 붙여도 전송 전에 승인을 거친다(몰래 안 보낸다) ──
const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

test('A2 경계: 슬랙 전송 요청은 실행 전 승인(approval)을 거친다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-ch-'));
  let sent = false;
  // 실제 sender를 붙이되, 승인 없이 실행되면 fetch가 호출되어 sent=true가 될 것 — 그러면 안 된다.
  const sender = makeChannelSender({ channel: 'slack', token: 'x', defaultTarget: '#g', fetchImpl: async () => { sent = true; return fakeFetch(200, { ok: true })(); } });
  const server = makeServer({ store: new SessionStore(dir), tools: demoTools({ senders: { 'slack.post': sender } }), env: demoEnv() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const s = await (await post(base, '/sessions')).json();
    const r = await (await post(base, '/turn', { sessionId: s.id, text: '슬랙 #general에 안녕이라고 올려줘' })).json();
    assert.equal(r.kind, 'approval', '전송은 A2 — 실행 전 승인');
    assert.equal(sent, false, '승인 전엔 실제 전송이 일어나지 않는다(몰래 안 보냄)');
    assert.ok(r.pending?.some((p) => /슬랙|slack/i.test(p.label)), '승인 대상에 슬랙 전송');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
