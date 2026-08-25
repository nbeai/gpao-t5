import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MessengerCredentialStore } from '../src/messenger-credential-store.js';
import { makeMessengerGateway, MessengerStateStore } from '../src/messenger-gateway.js';
import { makeTelegramMessengerProvider } from '../src/telegram-messenger-provider.js';
import { AttachmentStore } from '../src/attachment-store.js';

const TOKEN = '123456:super-secret-bot-token';

async function telegramFixture() {
  const updates = [];
  const calls = [];
  const files = new Map();
  let holdPoll = false;
  let loseDocumentAck = false;
  let afterPoll = null;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks);
    const body = chunks.length && String(request.headers['content-type'] ?? '').includes('application/json')
      ? JSON.parse(rawBody.toString('utf8')) : { raw: rawBody.toString('latin1') };
    const method = request.url?.split('/').at(-1);
    calls.push({ method, body });
    const filePrefix = `/file/bot${TOKEN}/`;
    if (request.url?.startsWith(filePrefix)) {
      const name = decodeURIComponent(request.url.slice(filePrefix.length));
      const content = files.get(name);
      if (!content) { response.statusCode = 404; response.end('missing'); return; }
      response.setHeader('content-type', 'application/octet-stream');
      response.setHeader('content-length', String(content.length));
      response.end(content); return;
    }
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
      const hook = afterPoll; afterPoll = null; hook?.();
      response.end(JSON.stringify({ ok: true, result }));
      return;
    }
    if (method === 'getFile') {
      const name = `files/${body.file_id}.bin`;
      if (!files.has(name)) { response.statusCode = 404; response.end(JSON.stringify({ ok: false })); return; }
      response.end(JSON.stringify({ ok: true, result: { file_id: body.file_id, file_path: name } }));
      return;
    }
    if (method === 'sendMessage') {
      response.end(JSON.stringify({ ok: true, result: { message_id: 900, chat: { id: body.chat_id }, text: body.text } }));
      return;
    }
    if (method === 'sendDocument') {
      if (loseDocumentAck) { response.destroy(); return; }
      response.end(JSON.stringify({ ok: true, result: {
        message_id: 901, chat: { id: 555 }, document: {
          file_id: 'sent-file-id', file_unique_id: 'sent-unique-id',
          file_name: 'result.txt', mime_type: 'text/plain', file_size: 11,
        },
      } }));
      return;
    }
    if (method === 'editMessageText') {
      response.end(JSON.stringify({ ok: true, result: {
        message_id: body.message_id, chat: { id: body.chat_id }, text: body.text,
      } }));
      return;
    }
    if (method === 'deleteMessage') {
      response.end(JSON.stringify({ ok: true, result: true }));
      return;
    }
    if (method === 'sendChatAction') {
      response.end(JSON.stringify({ ok: true, result: true }));
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
    updates, calls, files,
    hold(value) { holdPoll = value; },
    loseDocumentAck(value) { loseDocumentAck = value; },
    afterNextPoll(callback) { afterPoll = callback; },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function mediaUpdate(id, {
  chatId = 555, userId = 42, caption = '', mediaGroupId = null,
  fileId = `file-${id}`, uniqueId = `unique-${id}`, fileName = `file-${id}.txt`,
  fileSize = 4, replyTo = null,
} = {}) {
  return {
    update_id: id,
    message: {
      message_id: id, caption,
      ...(mediaGroupId == null ? {} : { media_group_id: mediaGroupId }),
      ...(replyTo == null ? {} : { reply_to_message: { message_id: replyTo } }),
      document: {
        file_id: fileId, file_unique_id: uniqueId, file_name: fileName,
        mime_type: 'text/plain', file_size: fileSize,
      },
      chat: { id: chatId, type: 'private' }, from: { id: userId, username: 'owner' },
    },
  };
}

function update(id, { chatId = 555, userId = 42, text = '안녕', threadId = null } = {}) {
  return {
    update_id: id,
    message: {
      message_id: id, text,
      ...(threadId == null ? {} : { message_thread_id: threadId }),
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

test('개인용 Telegram은 첫 private sender를 자동 소유자로 결속하고 첫 메시지부터 처리한다', async () => {
  const fixture = await telegramFixture();
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-first-owner-'));
  const credentials = new MessengerCredentialStore(room);
  const state = new MessengerStateStore(room);
  const sessions = [];
  const gateway = makeMessengerGateway({
    credentialStore: credentials, stateStore: state,
    providerFactory: ({ token }) => makeTelegramMessengerProvider({
      token, apiBase: fixture.base, pollTimeoutSeconds: 0,
    }),
    createSession: async () => { sessions.push('telegram-owner-session'); return sessions[0]; },
    authorizeInbound: async (message) => (await state.claimFirstOwner(message.provider, message)).allowed,
    onInbound: async (message) => `반가워요: ${message.text}`,
  });
  try {
    await gateway.connect({ provider: 'telegram', token: TOKEN });
    fixture.updates.push(update(5, { userId: 4242, text: '연결 확인' }));
    assert.deepEqual(await gateway.pollOnce(), { received: 1, accepted: 1, replied: 1, offset: 6 });
    assert.equal(sessions.length, 1, '첫 메시지를 버리고 재전송시키지 않는다');
    assert.deepEqual(await state.listAllowed('telegram'), [{
      userId: '4242', username: 'owner', label: '내 계정',
      allowedAt: (await state.listAllowed('telegram'))[0].allowedAt,
      source: 'first_private_message',
    }]);
    assert.deepEqual(await gateway.resolveOwnerDelivery('telegram'), {
      ready: true, provider: 'telegram', sessionId: 'telegram-owner-session',
    });
    assert.match(fixture.calls.find((call) => call.method === 'sendMessage').body.text, /반가워요/u);

    fixture.updates.push(update(6, { userId: 9999, chatId: 9999, text: '다른 사람' }));
    assert.deepEqual(await gateway.pollOnce(), { received: 1, accepted: 0, replied: 0, offset: 7 });
    assert.deepEqual((await state.listAllowed('telegram')).map((item) => item.userId), ['4242']);
    await gateway.disconnect('telegram');
    assert.deepEqual(await state.listAllowed('telegram'), []);
    assert.deepEqual(await state.listBindings(), []);
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
    assert.deepEqual(sent.body, { chat_id: '555', text: '답: 안녕', parse_mode: 'HTML' });
    assert.ok(fixture.calls.findIndex((call) => call.method === 'sendChatAction')
      < fixture.calls.findIndex((call) => call.method === 'sendMessage'));

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

test('Telegram 첫 메시지는 Session 채택 전 실패하면 offset을 넘기지 않고 다음 poll에서 다시 처리한다', async () => {
  const fixture = await telegramFixture();
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-pre-adoption-'));
  const credentials = new MessengerCredentialStore(room);
  const state = new MessengerStateStore(room);
  let creates = 0;
  const gateway = makeMessengerGateway({
    credentialStore: credentials, stateStore: state,
    providerFactory: ({ token }) => makeTelegramMessengerProvider({
      token, apiBase: fixture.base, pollTimeoutSeconds: 0,
    }),
    createSession: async () => {
      creates += 1;
      if (creates === 1) throw Object.assign(new Error('temporary session failure'), { code: 'temporary_session_failure' });
      return 'recovered-session';
    },
    authorizeInbound: async () => true,
    onInbound: async () => '첫 메시지를 이어받았어요.',
  });
  try {
    await gateway.connect({ provider: 'telegram', token: TOKEN });
    fixture.updates.push(update(50, { text: '첫 메시지' }));
    await assert.rejects(() => gateway.pollOnce(), (error) => error.code === 'messenger_inbound_pre_adoption_failed');
    assert.equal(await state.offset('telegram'), 0, '채택 전 실패한 update를 ACK하면 안 된다');
    assert.equal((await state.ingress('telegram', 50)).state, 'received');

    assert.deepEqual(await gateway.pollOnce(), { received: 1, accepted: 1, replied: 1, offset: 51 });
    assert.equal(creates, 2);
    assert.equal((await state.ingress('telegram', 50)).state, 'completed');
    assert.equal(fixture.calls.filter((call) => call.method === 'sendMessage').length, 1);
  } finally { await fixture.close(); }
});

test('Telegram 작업 채택 뒤 실패는 불명확 효과를 다시 실행하지 않고 durable 상태로 닫는다', async () => {
  const fixture = await telegramFixture();
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-post-adoption-'));
  const credentials = new MessengerCredentialStore(room);
  const state = new MessengerStateStore(room);
  let executions = 0;
  const gateway = () => makeMessengerGateway({
    credentialStore: credentials, stateStore: state,
    providerFactory: ({ token }) => makeTelegramMessengerProvider({
      token, apiBase: fixture.base, pollTimeoutSeconds: 0,
    }),
    createSession: async () => 'adopted-session', authorizeInbound: async () => true,
    onInbound: async () => {
      executions += 1;
      throw Object.assign(new Error('model result uncertain'), { code: 'model_result_uncertain' });
    },
  });
  try {
    await gateway().connect({ provider: 'telegram', token: TOKEN });
    fixture.updates.push(update(60, { text: '외부 효과가 있을 수 있는 요청' }));
    assert.deepEqual(await gateway().pollOnce(), { received: 1, accepted: 1, replied: 0, offset: 61 });
    const adopted = await state.ingress('telegram', 60);
    assert.equal(adopted.state, 'adopted_unknown');
    assert.equal(adopted.sessionId, 'adopted-session');
    assert.equal(adopted.text, undefined, 'terminal ingress record에 사용자 원문을 중복 보존하지 않는다');

    assert.deepEqual(await gateway().pollOnce(), { received: 0, accepted: 0, replied: 0, offset: 61 });
    assert.equal(executions, 1, '채택된 작업을 restart 뒤 자동 재실행하면 안 된다');
  } finally { await fixture.close(); }
});

test('Telegram 작업 실패는 진행 말풍선을 정형 오류문으로 바꾸지 않고 제거한다', async () => {
  const fixture = await telegramFixture();
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-failure-discard-'));
  const gateway = makeMessengerGateway({
    credentialStore: new MessengerCredentialStore(room),
    stateStore: new MessengerStateStore(room),
    providerFactory: ({ token }) => makeTelegramMessengerProvider({
      token, apiBase: fixture.base, pollTimeoutSeconds: 0,
    }),
    createSession: async () => 'failure-session', authorizeInbound: async () => true,
    onInbound: async (_message, { progress }) => {
      await progress('파일을 찾고 있어요');
      throw new Error('fixture failure');
    },
  });
  try {
    await gateway.connect({ provider: 'telegram', token: TOKEN });
    fixture.updates.push(update(61, { text: '파일 보내줘' }));
    await gateway.pollOnce();
    assert.equal(fixture.calls.filter((call) => call.method === 'deleteMessage').length, 1);
    assert.equal(fixture.calls.filter((call) => call.method === 'editMessageText').length, 0);
  } finally { await fixture.close(); }
});

test('Telegram 채택 전 같은 실패가 세 번 반복되면 polling을 멈추고 확인 필요 상태를 남긴다', async () => {
  const fixture = await telegramFixture();
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-bounded-stop-'));
  const state = new MessengerStateStore(room);
  const gateway = makeMessengerGateway({
    credentialStore: new MessengerCredentialStore(room), stateStore: state,
    providerFactory: ({ token }) => makeTelegramMessengerProvider({
      token, apiBase: fixture.base, pollTimeoutSeconds: 0,
    }),
    createSession: async () => { throw Object.assign(new Error('session unavailable'), { code: 'session_unavailable' }); },
    authorizeInbound: async () => true, onInbound: async () => 'never', retryDelayMs: 1,
  });
  try {
    await gateway.connect({ provider: 'telegram', token: TOKEN });
    fixture.updates.push(update(70, { text: '처리할 수 없는 첫 메시지' }));
    await gateway.start();
    for (let count = 0; count < 100 && (await gateway.status()).running; count += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const status = await gateway.status();
    assert.equal(status.running, false);
    assert.deepEqual(status.lastError && {
      code: status.lastError.code, needsAttention: status.lastError.needsAttention,
    }, { code: 'messenger_inbound_needs_attention', needsAttention: true });
    assert.equal((await state.ingress('telegram', 70)).attempts, 3);
    assert.equal(await state.offset('telegram'), 0);
  } finally { await gateway.stop(); await fixture.close(); }
});

test('Telegram 진행 말풍선 하나를 상태로 수정하고 최종 Markdown을 HTML 답변으로 바꾸어 남긴다', async () => {
  const fixture = await telegramFixture();
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-progress-'));
  const gateway = makeMessengerGateway({
    credentialStore: new MessengerCredentialStore(room),
    stateStore: new MessengerStateStore(room),
    providerFactory: ({ token }) => makeTelegramMessengerProvider({
      token, apiBase: fixture.base, pollTimeoutSeconds: 0, typingIntervalMs: 10,
    }),
    createSession: async () => 'progress-session', authorizeInbound: async () => true,
    onInbound: async (_message, { progress }) => {
      await progress('요청을 이해하고 있어요');
      await progress('웹에서 관련 자료를 찾고 있어요');
      return '서울은 **흐림**이고 `24°C`예요.';
    },
  });
  try {
    await gateway.connect({ provider: 'telegram', token: TOKEN });
    fixture.updates.push(update(35, { text: '날씨' }));
    assert.equal((await gateway.pollOnce()).replied, 1);
    const sent = fixture.calls.filter((call) => call.method === 'sendMessage');
    const edits = fixture.calls.filter((call) => call.method === 'editMessageText');
    assert.equal(sent.length, 1, '진행 말풍선은 하나만 생성한다');
    assert.equal(sent[0].body.text, '요청을 이해하고 있어요…');
    assert.equal(edits[0].body.text, '웹에서 관련 자료를 찾고 있어요…');
    assert.match(edits.at(-1).body.text, /<b>흐림<\/b>/u);
    assert.match(edits.at(-1).body.text, /<code>24°C<\/code>/u);
    assert.doesNotMatch(edits.at(-1).body.text, /\*\*/u);
    assert.equal(edits.at(-1).body.parse_mode, 'HTML');
  } finally {
    await fixture.close();
  }
});

test('모델·도구 작업 동안 Telegram typing을 즉시·주기 갱신하고 답장 후 멈춘다', async () => {
  const fixture = await telegramFixture();
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-typing-'));
  const gateway = makeMessengerGateway({
    credentialStore: new MessengerCredentialStore(room),
    stateStore: new MessengerStateStore(room),
    providerFactory: ({ token }) => makeTelegramMessengerProvider({
      token, apiBase: fixture.base, pollTimeoutSeconds: 0,
      typingIntervalMs: 10, typingTtlMs: 500,
    }),
    createSession: async () => 'session-topic',
    authorizeInbound: async () => true,
    onInbound: async () => {
      await new Promise((resolve) => setTimeout(resolve, 45));
      return '긴 작업 답장';
    },
  });
  try {
    await gateway.connect({ provider: 'telegram', token: TOKEN });
    fixture.updates.push(update(30, { chatId: -1001, threadId: 42, text: '긴 일' }));
    assert.deepEqual(await gateway.pollOnce(), { received: 1, accepted: 1, replied: 1, offset: 31 });
    const actionsAtReply = fixture.calls.filter((call) => call.method === 'sendChatAction');
    assert.ok(actionsAtReply.length >= 2, `typing calls: ${actionsAtReply.length}`);
    assert.ok(actionsAtReply.every((call) => call.body.message_thread_id === 42));
    const reply = fixture.calls.find((call) => call.method === 'sendMessage');
    assert.equal(reply.body.message_thread_id, 42);
    const count = actionsAtReply.length;
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(fixture.calls.filter((call) => call.method === 'sendChatAction').length, count);
    assert.equal((await new MessengerStateStore(room).session('telegram', '-1001:topic:42')), 'session-topic');
  } finally {
    await fixture.close();
  }
});

test('긴 Telegram 답은 surrogate를 깨뜨리지 않고 4000자 이하 조각으로 같은 topic에 전송한다', async () => {
  const fixture = await telegramFixture();
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-chunks-'));
  const longReply = `${'가'.repeat(3999)}😊${'나'.repeat(4100)}`;
  const gateway = makeMessengerGateway({
    credentialStore: new MessengerCredentialStore(room),
    stateStore: new MessengerStateStore(room),
    providerFactory: ({ token }) => makeTelegramMessengerProvider({
      token, apiBase: fixture.base, pollTimeoutSeconds: 0,
    }),
    createSession: async () => 'chunk-session', authorizeInbound: async () => true,
    onInbound: async () => longReply,
  });
  try {
    await gateway.connect({ provider: 'telegram', token: TOKEN });
    fixture.updates.push(update(40, { chatId: -2002, threadId: 7, text: '긴 답' }));
    assert.equal((await gateway.pollOnce()).replied, 1);
    const sent = fixture.calls.filter((call) => call.method === 'sendMessage');
    assert.equal(sent.length, 3);
    assert.ok(sent.every((call) => call.body.text.length <= 4000));
    assert.ok(sent.every((call) => call.body.message_thread_id === 7));
    assert.equal(sent.map((call) => call.body.text).join(''), longReply);
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
  assert.equal(await state.isAllowed('telegram', { provider: 'telegram', username: '@owner' }), false);
  assert.equal((await new MessengerStateStore(room).listAllowed('telegram'))[0].label, '오너');
  await state.revoke('telegram', '42');
  assert.equal(await state.isAllowed('telegram', stranger), false);
});

test('Telegram document와 caption·reply identity를 한 envelope로 AttachmentStore에 결속한다', async () => {
  const fixture = await telegramFixture();
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-attachment-'));
  const sessionId = randomUUID();
  const attachmentStore = new AttachmentStore(join(room, 'attachments'));
  const received = [];
  const gateway = makeMessengerGateway({
    credentialStore: new MessengerCredentialStore(room),
    stateStore: new MessengerStateStore(room), attachmentStore,
    providerFactory: ({ token }) => makeTelegramMessengerProvider({
      token, apiBase: fixture.base, pollTimeoutSeconds: 0,
    }),
    createSession: async () => sessionId, authorizeInbound: async () => true,
    onInbound: async (message) => { received.push(message); return '확인했어요.'; },
  });
  try {
    await gateway.connect({ provider: 'telegram', token: TOKEN });
    fixture.files.set('files/contract.bin', Buffer.from('contract body'));
    fixture.updates.push(mediaUpdate(70, {
      caption: '이 계약서 위험을 봐줘', fileId: 'contract', uniqueId: 'stable-contract',
      fileName: 'contract.txt', fileSize: 13, replyTo: 69,
    }));
    assert.deepEqual(await gateway.pollOnce(), { received: 1, accepted: 1, replied: 1, offset: 71 });
    assert.equal(received[0].text, '이 계약서 위험을 봐줘');
    assert.deepEqual(received[0].replyIdentity, { provider: 'telegram', messageId: '69' });
    assert.equal(received[0].attachmentIds.length, 1);
    const stored = await attachmentStore.readContent({
      sessionId, attachmentId: received[0].attachmentIds[0],
    });
    assert.equal(stored.record.originalName, 'contract.txt');
    assert.deepEqual(stored.record.providerIdentity, {
      provider: 'telegram', fileId: 'contract', fileUniqueId: 'stable-contract', mediaGroupId: null,
    });
    assert.equal(stored.bytes.toString(), 'contract body');
  } finally { await fixture.close(); }
});

test('Telegram media group은 caption과 여러 file을 순서대로 한 사용자 Turn에 공급한다', async () => {
  const fixture = await telegramFixture();
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-album-'));
  const sessionId = randomUUID();
  const received = [];
  const gateway = makeMessengerGateway({
    credentialStore: new MessengerCredentialStore(room), stateStore: new MessengerStateStore(room),
    attachmentStore: new AttachmentStore(join(room, 'attachments')),
    providerFactory: ({ token }) => makeTelegramMessengerProvider({ token, apiBase: fixture.base, pollTimeoutSeconds: 0 }),
    createSession: async () => sessionId, authorizeInbound: async () => true,
    onInbound: async (message) => { received.push(message); return null; },
  });
  try {
    await gateway.connect({ provider: 'telegram', token: TOKEN });
    fixture.files.set('files/a.bin', Buffer.from('A'));
    fixture.files.set('files/b.bin', Buffer.from('B'));
    fixture.updates.push(
      mediaUpdate(80, { caption: '두 파일을', mediaGroupId: 'group-1', fileId: 'a', fileName: 'a.txt', fileSize: 1 }),
      mediaUpdate(81, { caption: '함께 비교해줘', mediaGroupId: 'group-1', fileId: 'b', fileName: 'b.txt', fileSize: 1 }),
    );
    assert.deepEqual(await gateway.pollOnce(), { received: 1, accepted: 1, replied: 0, offset: 82 });
    assert.equal(received.length, 1);
    assert.equal(received[0].text, '두 파일을\n함께 비교해줘');
    assert.equal(received[0].attachmentIds.length, 2);
  } finally { await fixture.close(); }
});

test('Telegram album update가 다음 짧은 poll에 나뉘어도 quiet boundary에서 한 Turn으로 합친다', async () => {
  const fixture = await telegramFixture();
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-album-split-'));
  const received = []; const sessionId = randomUUID();
  const gateway = makeMessengerGateway({
    credentialStore: new MessengerCredentialStore(room), stateStore: new MessengerStateStore(room),
    attachmentStore: new AttachmentStore(join(room, 'attachments')),
    providerFactory: ({ token }) => makeTelegramMessengerProvider({
      token, apiBase: fixture.base, pollTimeoutSeconds: 0, mediaGroupQuietMs: 5, mediaGroupMaxWaitMs: 50,
    }),
    createSession: async () => sessionId, authorizeInbound: async () => true,
    onInbound: async (message) => { received.push(message); return null; },
  });
  try {
    await gateway.connect({ provider: 'telegram', token: TOKEN });
    fixture.files.set('files/split-a.bin', Buffer.from('A'));
    fixture.files.set('files/split-b.bin', Buffer.from('B'));
    fixture.updates.push(mediaUpdate(85, { caption: '앞 파일', mediaGroupId: 'split', fileId: 'split-a', fileSize: 1 }));
    fixture.afterNextPoll(() => fixture.updates.push(mediaUpdate(86, {
      caption: '뒤 파일', mediaGroupId: 'split', fileId: 'split-b', fileSize: 1,
    })));
    assert.deepEqual(await gateway.pollOnce(), { received: 1, accepted: 1, replied: 0, offset: 87 });
    assert.equal(received.length, 1);
    assert.equal(received[0].attachmentIds.length, 2);
    assert.equal(received[0].text, '앞 파일\n뒤 파일');
  } finally { await fixture.close(); }
});

test('Telegram oversized attachment는 caption을 잃지 않고 구조화된 issue로 같은 Turn에 남긴다', async () => {
  const fixture = await telegramFixture();
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-oversized-'));
  const received = [];
  const gateway = makeMessengerGateway({
    credentialStore: new MessengerCredentialStore(room), stateStore: new MessengerStateStore(room),
    attachmentStore: new AttachmentStore(join(room, 'attachments')),
    providerFactory: ({ token }) => makeTelegramMessengerProvider({ token, apiBase: fixture.base, pollTimeoutSeconds: 0 }),
    createSession: async () => randomUUID(), authorizeInbound: async () => true,
    onInbound: async (message) => { received.push(message); return null; },
  });
  try {
    await gateway.connect({ provider: 'telegram', token: TOKEN });
    fixture.updates.push(mediaUpdate(90, {
      caption: '파일이 안 되면 이유라도 알려줘', fileId: 'huge', fileName: 'huge.bin',
      fileSize: 21 * 1024 * 1024,
    }));
    await gateway.pollOnce();
    assert.equal(received[0].text, '파일이 안 되면 이유라도 알려줘');
    assert.deepEqual(received[0].attachmentIds, []);
    assert.equal(received[0].attachmentIssues[0].state, 'too_large');
  } finally { await fixture.close(); }
});

test('Telegram provider가 exact output artifact를 sendDocument로 보내고 message/file receipt를 남긴다', async () => {
  const fixture = await telegramFixture();
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-send-document-'));
  const sessionId = randomUUID();
  const attachmentStore = new AttachmentStore(join(room, 'attachments'));
  const resultPath = join(room, 'result.txt');
  await writeFile(resultPath, 'hello world');
  const artifact = await attachmentStore.registerOutput({ sessionId, workspace: room, filePath: resultPath });
  let delivery;
  const gateway = makeMessengerGateway({
    credentialStore: new MessengerCredentialStore(room), stateStore: new MessengerStateStore(room),
    attachmentStore,
    providerFactory: ({ token }) => makeTelegramMessengerProvider({ token, apiBase: fixture.base, pollTimeoutSeconds: 0 }),
    createSession: async () => sessionId, authorizeInbound: async () => true,
    onInbound: async (_message, controls) => {
      delivery = await controls.deliver({ text: '결과 파일이에요.', artifactIds: [artifact.attachmentId] });
      return { text: null, delivery };
    },
  });
  try {
    await gateway.connect({ provider: 'telegram', token: TOKEN });
    fixture.updates.push(update(100, { text: '결과 파일 보내줘' }));
    assert.deepEqual(await gateway.pollOnce(), { received: 1, accepted: 1, replied: 1, offset: 101 });
    assert.equal(fixture.calls.filter((call) => call.method === 'sendDocument').length, 1);
    assert.equal(delivery.files[0].file.fileId, 'sent-file-id');
    assert.equal(delivery.files[0].artifact.attachmentId, artifact.attachmentId);
    assert.equal(delivery.files[0].artifact.sha256, artifact.sha256);
    assert.deepEqual(delivery.messageIds, ['900', '901']);
    assert.equal((await new MessengerStateStore(room).ingress('telegram', 100)).files[0].file.fileUniqueId, 'sent-unique-id');
  } finally { await fixture.close(); }
});

test('Telegram binding에 대한 일반 session delivery도 text와 exact artifact를 함께 보낸다', async () => {
  const fixture = await telegramFixture();
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-session-document-'));
  const sessionId = randomUUID(); const stateStore = new MessengerStateStore(room);
  const attachmentStore = new AttachmentStore(join(room, 'attachments'));
  const resultPath = join(room, 'phone-download.bin');
  const bytes = Buffer.from('intact-file-bytes'); await writeFile(resultPath, bytes);
  const artifact = await attachmentStore.registerOutput({ sessionId, workspace: room, filePath: resultPath });
  const gateway = makeMessengerGateway({
    credentialStore: new MessengerCredentialStore(room), stateStore, attachmentStore,
    providerFactory: ({ token }) => makeTelegramMessengerProvider({ token, apiBase: fixture.base, pollTimeoutSeconds: 0 }),
    createSession: async () => sessionId, authorizeInbound: async () => true,
    onInbound: async () => null,
  });
  try {
    await gateway.connect({ provider: 'telegram', token: TOKEN });
    await stateStore.bind('telegram', '555', sessionId);
    const delivery = await gateway.sendToSession({
      sessionId, text: '휴대폰에서 받을 파일이에요.', artifactIds: [artifact.attachmentId],
    });
    assert.equal(fixture.calls.filter((call) => call.method === 'sendDocument').length, 1);
    assert.deepEqual(delivery.messageIds, ['900', '901']);
    assert.equal(delivery.files.length, 1);
    assert.equal(delivery.files[0].artifact.attachmentId, artifact.attachmentId);
    assert.equal(delivery.files[0].artifact.sha256, artifact.sha256);
    assert.equal(delivery.files[0].artifact.bytes, bytes.length);
  } finally { await fixture.close(); }
});

test('sendDocument ACK가 사라지면 unknown으로 보존하고 같은 artifact를 blind retry하지 않는다', async () => {
  const fixture = await telegramFixture();
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-send-unknown-'));
  const sessionId = randomUUID();
  const attachmentStore = new AttachmentStore(join(room, 'attachments'));
  const resultPath = join(room, 'unknown.txt');
  await writeFile(resultPath, 'unknown');
  const artifact = await attachmentStore.registerOutput({ sessionId, workspace: room, filePath: resultPath });
  const gateway = makeMessengerGateway({
    credentialStore: new MessengerCredentialStore(room), stateStore: new MessengerStateStore(room), attachmentStore,
    providerFactory: ({ token }) => makeTelegramMessengerProvider({ token, apiBase: fixture.base, pollTimeoutSeconds: 0 }),
    createSession: async () => sessionId, authorizeInbound: async () => true,
    onInbound: async (_message, controls) => {
      await controls.deliver({ artifactIds: [artifact.attachmentId] });
      return null;
    },
  });
  try {
    await gateway.connect({ provider: 'telegram', token: TOKEN });
    fixture.loseDocumentAck(true);
    fixture.updates.push(update(110, { text: '파일 보내줘' }));
    assert.deepEqual(await gateway.pollOnce(), { received: 1, accepted: 1, replied: 0, offset: 111 });
    assert.equal((await new MessengerStateStore(room).ingress('telegram', 110)).state, 'adopted_unknown');
    assert.equal(fixture.calls.filter((call) => call.method === 'sendDocument').length, 1);
    await gateway.pollOnce();
    assert.equal(fixture.calls.filter((call) => call.method === 'sendDocument').length, 1);
  } finally { await fixture.close(); }
});
