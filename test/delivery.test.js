import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeDelivery, applyDeliveryResult, isRetriable, isDelivered } from '../src/kernel/l5-growth/delivery.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

// ── 계약: 생성≠전달. 완료는 delivered 이후에만. ──
test('Delivery 계약: attempting → delivered / failed(재전달 가능)', () => {
  const d0 = makeDelivery({ id: 'd1', tool: 'slack.post', target: '#g', artifact: { text: '회의 시작' } });
  assert.equal(d0.state, 'attempting');
  assert.equal(isDelivered(d0), false, 'attempting은 완료 아님');
  // 성공 → delivered
  const ok = applyDeliveryResult(d0, 'none', '보냈어요', 5);
  assert.equal(ok.state, 'delivered');
  assert.equal(isDelivered(ok), true);
  assert.equal(isRetriable(ok), false);
  // transient 실패 → 재전달 가능, 산출물 보존
  const fail = applyDeliveryResult(d0, 'timeout', '연결 실패');
  assert.equal(fail.state, 'failed');
  assert.equal(isRetriable(fail), true);
  assert.equal(fail.artifact.text, '회의 시작', '산출물 보존(재생성 없음)');
  assert.equal(fail.needsFix, false);
  // blocked(연결/권한) → needsFix
  const blocked = applyDeliveryResult(d0, 'blocked', '자격 없음');
  assert.equal(blocked.needsFix, true, '원인 해소 후 재전달');
  assert.equal(isRetriable(blocked), true);
});

// ── 서버 흐름: 전달 실패 → 원장 기록 + 복구 표면화 → 재전달(같은 산출물) → 전달됨. ──
const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const getj = async (base, path) => (await fetch(`${base}${path}`)).json();

async function withServer(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-dl-'));
  const calls = [];
  const ctl = { mode: 'fail' }; // 전달 결과를 제어(먼저 실패, 재전달 시 성공)
  const sender = {
    toolKind: 'send',
    async handler(args) {
      calls.push(args);
      if (ctl.mode === 'fail') return { failed: true, sendState: 'timeout', userSafeSummary: '채널에 연결하지 못했어요.' };
      return { result: { sent: true }, userSafeSummary: '보냈어요.' };
    },
  };
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools({ senders: { 'slack.post': sender } }) });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try { return await fn(`http://127.0.0.1:${port}`, calls, ctl); }
  finally { await new Promise((r) => server.close(r)); }
}
async function send(base, sid, text) {
  const r1 = await (await post(base, '/turn', { sessionId: sid, text })).json();
  if (r1.kind !== 'approval') return r1;
  return (await post(base, '/turn', { sessionId: sid, approve: r1.pendingId })).json();
}

test('전달 실패 → 원장 기록 + deliveryFailed 표면화(완료 아님)', async () => {
  await withServer(async (base, calls) => {
    const s = await (await post(base, '/sessions')).json();
    const done = await send(base, s.id, '슬랙 #general에 회의 시작이라고 올려줘');
    assert.equal(done.kind, 'reply');
    assert.ok(done.deliveryFailed?.deliveryId, '전달 실패를 표면화(처음부터 다시 아님)');
    assert.equal(done.deliveryFailed.target, '#general');
    const view = await getj(base, '/deliveries');
    assert.equal(view.deliveries.length, 1);
    assert.equal(view.deliveries[0].state, 'failed');
    assert.equal(view.deliveries[0].retriable, true);
    assert.deepEqual(calls[0], { target: '#general', text: '회의 시작' }, '분리된 산출물로 전달 시도');
  });
});

test('재전달: 기존 산출물을 그대로 다시 보낸다(재생성 없음) → 전달됨', async () => {
  await withServer(async (base, calls, ctl) => {
    const s = await (await post(base, '/sessions')).json();
    const done = await send(base, s.id, '슬랙 #general에 회의 시작이라고 올려줘');
    const id = done.deliveryFailed.deliveryId;
    ctl.mode = 'ok'; // 이번엔 성공
    const retry = await (await post(base, `/deliveries/${id}/retry`)).json();
    assert.equal(retry.ok, true);
    assert.equal(retry.state, 'delivered');
    // 재전달은 저장된 산출물을 그대로 — 새 턴/재생성 없이 같은 {text, target}
    assert.deepEqual(calls[1], { text: '회의 시작', target: '#general' }, '같은 산출물 재전달');
    const view = await getj(base, '/deliveries');
    assert.equal(view.deliveries[0].state, 'delivered');
    assert.equal(view.deliveries[0].attempts, 2);
  });
});

test('전달 성공은 deliveryFailed 없음 + delivered', async () => {
  await withServer(async (base, calls, ctl) => {
    ctl.mode = 'ok';
    const s = await (await post(base, '/sessions')).json();
    const done = await send(base, s.id, '슬랙 #general에 회의 시작이라고 올려줘');
    assert.equal(done.deliveryFailed, undefined);
    const view = await getj(base, '/deliveries');
    assert.equal(view.deliveries[0].state, 'delivered');
  });
});

test('이미 전달된 건 재전달해도 중복 전송 안 함', async () => {
  await withServer(async (base, calls, ctl) => {
    ctl.mode = 'ok';
    const s = await (await post(base, '/sessions')).json();
    await send(base, s.id, '슬랙 #general에 회의 시작이라고 올려줘');
    const view = await getj(base, '/deliveries');
    const before = calls.length;
    const retry = await (await post(base, `/deliveries/${view.deliveries[0].id}/retry`)).json();
    assert.equal(retry.alreadyDelivered, true);
    assert.equal(calls.length, before, '이미 전달됐으면 다시 안 보냄');
  });
});
