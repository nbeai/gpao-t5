// P5-1 · 텔레그램 수신 실경로 — **`/channel/inbound` 를 부를 주체**가 생긴다.
//
// Phase 0-5 까지 T5 는 "받는 문"만 있고 문 앞에 서 있는 사람이 없었다. 채널이 "받을 준비가
// 됐어요"라고 말해도 메시지는 한 통도 들어오지 않았다.
//
// 이 파일이 지키는 것:
//   · 같은 메시지를 두 번 처리하지 않는다(재시작해도)
//   · 못 다루는 메시지에 걸려 수신이 통째로 막히지 않는다
//   · 자격이 없으면 도는 척하지 않는다
//   · **허용목록이 비어 있으면 아무도 못 들어온다**(봇 주소는 누구나 알 수 있다)
//   · 한 방의 대화가 같은 세션에 쌓인다(매번 새 대화면 기억이 없는 것과 같다)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTelegramReceiver, toInboundMessage } from '../src/runtime/telegram-receiver.js';
import { AllowlistStore } from '../src/surface/allowlist-store.js';
import { ChannelBindingStore } from '../src/surface/channel-binding-store.js';
import { SessionStore } from '../src/surface/session-store.js';
import { makeServer } from '../src/surface/server.js';
import { defineChannel } from '../src/kernel/l2-plan/channel-registry.js';
import { defineConnector } from '../src/kernel/l2-plan/connector-profile.js';

const update = (id, over = {}) => ({
  update_id: id,
  message: {
    message_id: id, text: '안녕',
    chat: { id: 555, type: 'private' },
    from: { id: 42, username: 'owner' },
    ...over,
  },
});
const okUpdates = (result) => ({ status: 200, json: async () => ({ ok: true, result }) });

// ── 텔레그램 update → T5 메시지 ───────────────────────────────────────────
test('메시지에서 사실만 옮긴다(판정하지 않는다)', () => {
  const m = toInboundMessage(update(1), 'gpaot5bot');
  assert.deepEqual(m, {
    channel: 'telegram', chatId: '555', userId: '42', username: 'owner',
    text: '안녕', isDirectMessage: true, isMention: false,
  });
});

test('그룹에서 봇을 부르면 mention 으로 본다', () => {
  const m = toInboundMessage(update(2, { text: '@gpaot5bot 이거 봐줘', chat: { id: -100, type: 'group' } }), 'gpaot5bot');
  assert.equal(m.isMention, true);
  assert.equal(m.isDirectMessage, false);
});

test('다룰 수 없는 메시지(사진·스티커)는 없는 것으로 둔다 — 있는 척하지 않는다', () => {
  assert.equal(toInboundMessage({ update_id: 3, message: { photo: [{}], chat: { id: 1 } } }), null);
  assert.equal(toInboundMessage({}), null);
});

// ── 수신 루프 ─────────────────────────────────────────────────────────────
test('받은 메시지를 넘기고, 같은 것을 두 번 처리하지 않는다', async () => {
  const seen = [];
  let call = 0;
  const rx = makeTelegramReceiver({
    token: 't', onMessage: async (m) => seen.push(m.text),
    fetchImpl: async (url, init) => {
      call += 1;
      const body = JSON.parse(init.body);
      if (call === 1) {
        assert.equal(body.offset, 0);
        return okUpdates([update(10), update(11, { text: '두 번째' })]);
      }
      assert.equal(body.offset, 12, '다음 요청은 처리한 다음 번호부터');
      return okUpdates([]);
    },
  });
  assert.equal(await rx.pollOnce(), 2);
  assert.deepEqual(seen, ['안녕', '두 번째']);
  assert.equal(await rx.pollOnce(), 0);
});

test('못 다루는 메시지에 걸려 수신이 막히지 않는다(offset 은 전진한다)', async () => {
  const rx = makeTelegramReceiver({
    token: 't', onMessage: async () => {},
    fetchImpl: async () => okUpdates([{ update_id: 7, message: { sticker: {}, chat: { id: 1 } } }]),
  });
  assert.equal(await rx.pollOnce(), 0);
  assert.equal(rx.offset, 8, '못 다룬 메시지도 지나가야 한다 — 아니면 영원히 같은 것을 다시 받는다');
});

test('처리 중 오류가 나도 다음 메시지를 계속 받는다', async () => {
  const seen = [];
  const rx = makeTelegramReceiver({
    token: 't',
    onMessage: async (m) => { if (m.text === '폭탄') throw new Error('boom'); seen.push(m.text); },
    fetchImpl: async () => okUpdates([update(1, { text: '폭탄' }), update(2, { text: '괜찮아' })]),
  });
  await rx.pollOnce();
  assert.deepEqual(seen, ['괜찮아']);
});

test('재시작해도 이어서 받는다(offset 을 남긴다)', async () => {
  let saved = null;
  const offsetStore = { load: async () => saved, save: async (v) => { saved = v; } };
  const mk = () => makeTelegramReceiver({
    token: 't', offsetStore, onMessage: async () => {},
    fetchImpl: async () => okUpdates([update(100)]),
  });
  await mk().pollOnce();
  assert.equal(saved, 101);

  const restarted = mk();
  await restarted.start();
  restarted.stop();
  assert.equal(restarted.offset >= 101, true, '재시작 후 예전 메시지를 다시 받으면 안 된다');
});

test('자격이 없으면 시작하지 않고 그 사실을 말한다(도는 척 금지)', async () => {
  const rx = makeTelegramReceiver({ onMessage: async () => {} });
  assert.deepEqual(await rx.start(), { started: false, reason: 'no_token' });
  assert.equal(rx.running, false);
});

test('토큰이 틀리면 계속 두드리지 않는다', async () => {
  let calls = 0;
  const rx = makeTelegramReceiver({
    token: 'bad', onMessage: async () => {},
    fetchImpl: async () => { calls += 1; return { status: 401, json: async () => ({ ok: false, error_code: 401 }) }; },
  });
  await assert.rejects(() => rx.pollOnce(), (e) => e.authFailed === true);
  assert.equal(calls, 1);
});

// ── 허용목록: 봇 주소는 누구나 알 수 있다 ────────────────────────────────
test('허용목록이 비어 있으면 아무도 허용되지 않는다("비었으니 전부 통과" 금지)', async () => {
  const store = new AllowlistStore(await mkdtemp(join(tmpdir(), 'gpao-t5-allow-')));
  assert.equal(await store.isAllowed('telegram', { userId: '42' }), false);
});

test('id 로도 username 으로도 알아본다(@ 표기·대소문자 무관)', async () => {
  const store = new AllowlistStore(await mkdtemp(join(tmpdir(), 'gpao-t5-allow2-')));
  await store.allow('telegram', { userId: '42', username: '@Owner', label: '윤' });
  assert.equal(await store.isAllowed('telegram', { userId: '42' }), true);
  assert.equal(await store.isAllowed('telegram', { username: 'owner' }), true);
  assert.equal(await store.isAllowed('telegram', { userId: '99' }), false);
  assert.equal(await store.isAllowed('slack', { userId: '42' }), false, '채널을 넘어 허용되면 안 된다');
});

test('같은 사람을 두 번 넣어도 한 번만, 빼면 사라진다', async () => {
  const store = new AllowlistStore(await mkdtemp(join(tmpdir(), 'gpao-t5-allow3-')));
  await store.allow('telegram', { userId: '42' });
  await store.allow('telegram', { userId: '42' });
  assert.equal((await store.list('telegram')).length, 1);
  await store.revoke('telegram', '42');
  assert.equal(await store.isAllowed('telegram', { userId: '42' }), false);
});

// ── 수신기 → 서버 → 커널 관통 ────────────────────────────────────────────
async function liveish() {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-rx-'));
  const store = new SessionStore(dir);
  const allowlistStore = new AllowlistStore(dir);
  const bindingStore = new ChannelBindingStore(dir);
  const connector = defineConnector({ id: 'telegram', label: '텔레그램', kind: 'channel', authState: 'oauth', connected: true });
  const server = makeServer({
    store, allowlistStore, bindingStore,
    model: { respond: async () => '네, 봤어요' },
    connectors: [connector],
    channels: [defineChannel({ id: 'telegram', connector, inboundPolicy: 'allowlist_only', outboundTool: 'telegram.send', hasReceiver: true })],
  });
  return { server, store, allowlistStore, bindingStore };
}

test('관통: 목록 밖 사람의 메시지는 대화가 되지 않되, 누가 말을 걸었는지는 남는다', async () => {
  const { server, store, allowlistStore } = await liveish();
  const out = await server.handleChannelMessage({
    channel: 'telegram', chatId: '555', userId: '99', username: 'stranger', text: '나 좀 도와줘',
  });
  assert.equal(out.kind, 'gated');
  const sessions = await store.list();
  assert.equal(sessions.every((s) => (s.turns ?? 0) === 0), true, '모르는 사람의 말이 대화로 남으면 안 된다');

  // 사용자가 화면에서 허용할 수 있으려면 **누가 말을 걸었는지**는 알아야 한다(닭과 달걀).
  const pending = await allowlistStore.listPending('telegram');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].userId, '99');
  assert.ok(!JSON.stringify(pending).includes('나 좀 도와줘'), '내용은 남기지 않는다');

  // 두 번째 시도는 새 줄을 만들지 않고 횟수만 올린다(목록이 지저분해지지 않게).
  await server.handleChannelMessage({ channel: 'telegram', chatId: '555', userId: '99', text: '한 번 더' });
  const again = await allowlistStore.listPending('telegram');
  assert.equal(again.length, 1);
  assert.equal(again[0].count, 2);
});

test('관통: 허용된 사람의 메시지는 대화가 되고, 같은 방은 같은 대화에 쌓인다', async () => {
  const { server, store, allowlistStore, bindingStore } = await liveish();
  await allowlistStore.allow('telegram', { userId: '42', label: '오너' });

  const first = await server.handleChannelMessage({ channel: 'telegram', chatId: '555', userId: '42', text: '첫 마디' });
  assert.ok(['reply', 'clarify', 'approval'].includes(first.kind), `실제: ${first.kind}`);
  const bound = await bindingStore.get('telegram', '555');
  assert.ok(bound, '방과 대화가 묶여야 다음 말이 이어진다');

  await server.handleChannelMessage({ channel: 'telegram', chatId: '555', userId: '42', text: '두 번째 마디' });
  const session = await store.load(bound);
  const said = session.transcript.filter((e) => e.role === 'user').map((e) => e.text);
  assert.deepEqual(said, ['첫 마디', '두 번째 마디'], '매번 새 대화면 기억이 없는 것과 같다');
});

test('관통: 다른 방은 다른 대화로 간다(대화가 섞이면 안 된다)', async () => {
  const { server, allowlistStore, bindingStore } = await liveish();
  await allowlistStore.allow('telegram', { userId: '42' });
  await server.handleChannelMessage({ channel: 'telegram', chatId: 'A', userId: '42', text: '가' });
  await server.handleChannelMessage({ channel: 'telegram', chatId: 'B', userId: '42', text: '나' });
  assert.notEqual(await bindingStore.get('telegram', 'A'), await bindingStore.get('telegram', 'B'));
});
