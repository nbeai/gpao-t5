import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MessengerCredentialStore } from '../src/messenger-credential-store.js';
import { makeMessengerGateway, MessengerStateStore } from '../src/messenger-gateway.js';
import { makeTelegramMessengerProvider } from '../src/telegram-messenger-provider.js';

const TOKEN = '123456:super-secret-bot-token';

async function telegramFixture() {
  const updates = [];
  const calls = [];
  let holdPoll = false;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    const method = request.url?.split('/').at(-1);
    calls.push({ method, body });
    response.setHeader('content-type', 'application/json');
    if (!request.url?.startsWith(`/bot${TOKEN}/`)) {
      response.statusCode = 401;
      response.end(JSON.stringify({ ok: false, error_code: 401 }));
      return;
    }
    if (method === 'getMe') {
      response.end(JSON.stringify({ ok: true, result: { id: 77, username: 't5_fixture_bot' } }));
      return;
    }
    if (method === 'getUpdates' && holdPoll) {
      request.on('close', () => { if (!response.writableEnded) response.destroy(); });
      return;
    }
    if (method === 'getUpdates') {
      const result = updates.filter((update) => update.update_id >= Number(body.offset ?? 0));
      response.end(JSON.stringify({ ok: true, result }));
      return;
    }
    if (method === 'sendMessage') {
      response.end(JSON.stringify({ ok: true, result: { message_id: 900, chat: { id: body.chat_id }, text: body.text } }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ ok: false }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    updates, calls,
    hold(value) { holdPoll = value; },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function update(id, { chatId = 555, userId = 42, text = '안녕' } = {}) {
  return {
    update_id: id,
    message: {
      message_id: id, text,
      chat: { id: chatId, type: 'private' },
      from: { id: userId, username: 'owner' },
    },
  };
}

test('검증되지 않은 봇 토큰은 저장하지 않고 공개 상태·오류에 비밀을 내보내지 않는다', async () => {
  const fixture = await telegramFixture();
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-auth-'));
  const credentials = new MessengerCredentialStore(room);
  const invalid = '999999:another-secret-invalid-token';
  const gateway = makeMessengerGateway({
    credentialStore: credentials,
    stateStore: new MessengerStateStore(room),
    providerFactory: ({ token }) => makeTelegramMessengerProvider({
      token, apiBase: fixture.base,
    }),
    createSession: async () => 'unused', authorizeInbound: async () => true,
    onInbound: async () => null,
  });
  try {
    await assert.rejects(
      () => gateway.connect({ provider: 'telegram', token: invalid }),
      (error) => error.code === 'telegram_auth_failed' && !error.message.includes(invalid),
    );
    assert.equal(await credentials.get('telegram'), null);
    assert.doesNotMatch(JSON.stringify(await gateway.status()), new RegExp(invalid));
  } finally {
    await fixture.close();
  }
});

test('텔레그램 long polling은 inbound→같은 chat session→outbound reply를 잇고 재시작 offset을 보존한다', async () => {
  const fixture = await telegramFixture();
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-e2e-'));
  const credentials = new MessengerCredentialStore(room);
  const state = new MessengerStateStore(room);
  const sessions = [];
  const inbound = [];
  const factory = ({ token }) => makeTelegramMessengerProvider({
    token, apiBase: fixture.base, pollTimeoutSeconds: 0,
  });
  const gateway = () => makeMessengerGateway({
    credentialStore: credentials, stateStore: state, providerFactory: factory,
    createSession: async () => { const id = `session-${sessions.length + 1}`; sessions.push(id); return id; },
    authorizeInbound: async (message) => message.userId === '42',
    onInbound: async (message) => { inbound.push(message); return `답: ${message.text}`; },
  });
  try {
    const connected = await gateway().connect({ provider: 'telegram', token: TOKEN });
    assert.deepEqual(connected, {
      provider: 'telegram', connected: true,
      bot: { id: '77', username: 't5_fixture_bot' }, inboundMode: 'long_polling',
      webhook: { active: false, reason: 'local_runtime_uses_long_polling' },
    });
    assert.doesNotMatch(JSON.stringify(connected), new RegExp(TOKEN));
    assert.equal((await stat(credentials.file)).mode & 0o777, 0o600);

    fixture.updates.push(update(10));
    const first = gateway();
    assert.deepEqual(await first.pollOnce(), { received: 1, accepted: 1, replied: 1, offset: 11 });
    assert.equal(inbound[0].sessionId, 'session-1');
    const sent = fixture.calls.find((call) => call.method === 'sendMessage');
    assert.deepEqual(sent.body, { chat_id: '555', text: '답: 안녕' });

    fixture.updates.push(update(11, { text: '두 번째' }));
    const restarted = gateway();
    assert.deepEqual(await restarted.pollOnce(), { received: 1, accepted: 1, replied: 1, offset: 12 });
    assert.equal(inbound[1].sessionId, 'session-1');
    assert.deepEqual(sessions, ['session-1']);

    fixture.updates.push(update(12, { userId: 99, text: '모르는 사람' }));
    assert.deepEqual(await restarted.pollOnce(), { received: 1, accepted: 0, replied: 0, offset: 13 });
    assert.deepEqual(sessions, ['session-1'], '미허용 발신자는 세션을 만들지 않는다');
    assert.equal(fixture.calls.filter((call) => call.method === 'sendMessage').length, 2);

    fixture.updates.push({ update_id: 13, message: { sticker: {}, chat: { id: 555, type: 'private' } } });
    assert.deepEqual(await restarted.pollOnce(), { received: 0, accepted: 0, replied: 0, offset: 14 });
    assert.equal((await stat(state.file)).mode & 0o777, 0o600);
  } finally {
    await fixture.close();
  }
});

test('실행 중 long poll은 stop에서 즉시 취소되고 토큰은 상태·로그에 남지 않는다', async () => {
  const fixture = await telegramFixture();
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-stop-'));
  const logs = [];
  const credentials = new MessengerCredentialStore(room);
  const state = new MessengerStateStore(room);
  const gateway = makeMessengerGateway({
    credentialStore: credentials, stateStore: state,
    providerFactory: ({ token }) => makeTelegramMessengerProvider({
      token, apiBase: fixture.base, pollTimeoutSeconds: 25, requestTimeoutMs: 35_000,
    }),
    createSession: async () => 'session', authorizeInbound: async () => true,
    onInbound: async () => null,
    log: (...values) => logs.push(values), retryDelayMs: 5,
  });
  try {
    await gateway.connect({ provider: 'telegram', token: TOKEN });
    fixture.hold(true);
    assert.equal((await gateway.start()).started, true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await gateway.stop();
    assert.equal((await gateway.status()).running, false);
    assert.doesNotMatch(JSON.stringify(logs), new RegExp(TOKEN));
  } finally {
    await fixture.close();
  }
});

test('P0 설정 후보는 legacy에서 실제 양방향 검증된 텔레그램 하나뿐이다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-provider-'));
  const gateway = makeMessengerGateway({
    credentialStore: new MessengerCredentialStore(room),
    stateStore: new MessengerStateStore(room),
    createSession: async () => 'session', authorizeInbound: async () => true,
    onInbound: async () => null,
  });
  const status = await gateway.status();
  assert.deepEqual(status.availableProviders, ['telegram']);
  assert.deepEqual(status.inboundReality.telegram, {
    mode: 'long_polling', webhook: { active: false, reason: 'local_runtime_uses_long_polling' },
  });
  await assert.rejects(() => gateway.connect({ provider: 'slack', token: 'x' }), /unsupported messenger provider/);
  await assert.rejects(() => gateway.connect({ provider: 'discord', token: 'x' }), /unsupported messenger provider/);
});

test('허용목록은 메시지 내용 없이 대기 발신자를 남기고 승인·해제를 재시작 뒤에도 보존한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-allowlist-'));
  const state = new MessengerStateStore(room);
  const stranger = { provider: 'telegram', userId: '42', username: 'Owner', text: 'secret message' };
  assert.equal(await state.isAllowed('telegram', stranger), false);
  await state.notePending('telegram', stranger);
  const pending = await state.listPending('telegram');
  assert.deepEqual(pending.map(({ userId, username, count }) => ({ userId, username, count })), [
    { userId: '42', username: 'Owner', count: 1 },
  ]);
  assert.doesNotMatch(JSON.stringify(pending), /secret message/u);
  await state.allow('telegram', { userId: '42', username: 'Owner', label: '오너' });
  assert.equal(await state.isAllowed('telegram', { provider: 'telegram', userId: '42' }), true);
  assert.equal(await state.isAllowed('telegram', { provider: 'telegram', username: '@owner' }), true);
  assert.equal((await new MessengerStateStore(room).listAllowed('telegram'))[0].label, '오너');
  await state.revoke('telegram', '42');
  assert.equal(await state.isAllowed('telegram', stranger), false);
});
