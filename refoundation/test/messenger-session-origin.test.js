import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConsoleSessionStore } from '../src/console-session-store.js';
import { makeConsoleServer } from '../src/console-server.js';

test('메신저에서 시작한 세션은 재시작·목록 projection까지 provider/chat origin을 보존한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-session-origin-'));
  const store = new ConsoleSessionStore(room);
  const created = await store.create({ origin: { channel: 'telegram', chatId: '555' } });
  await store.append(created.id, {
    role: 'user', text: '텔레그램에서 보낸 말', channel: 'telegram',
  });

  const reopened = new ConsoleSessionStore(room);
  assert.deepEqual((await reopened.load(created.id)).origin, { channel: 'telegram', chatId: '555' });
  assert.deepEqual((await reopened.list())[0].origin, { channel: 'telegram', chatId: '555' });
});

test('현재 재사용 UI는 session origin만 받으면 기존 Telegram 아이콘을 표시한다', async () => {
  const html = await readFile(new URL('../../src/surface/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /CHANNEL_ICON\s*=\s*\{[^}]*telegram:\s*'✈️'/u);
  assert.match(html, /s\.origin\?\.channel/u);
  assert.match(html, /CHANNEL_ICON\[s\.origin\.channel\]/u);
});

test('기존 Telegram binding에 묶인 예전 세션은 origin을 한 번 복구한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-session-backfill-'));
  const store = new ConsoleSessionStore(room);
  const created = await store.create();
  assert.equal((await store.load(created.id)).origin, null);
  await store.setOrigin(created.id, { channel: 'telegram', chatId: '777' });
  assert.deepEqual((await store.list())[0].origin, { channel: 'telegram', chatId: '777' });
  await store.setOrigin(created.id, { channel: 'telegram', chatId: 'other' });
  assert.deepEqual((await store.list())[0].origin, { channel: 'telegram', chatId: '777' });
});

test('Telegram에서 생긴 대화에 콘솔로 이어 말하면 같은 Telegram chat에도 답을 보낸다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-console-reply-'));
  const deliveries = [];
  let first = true;
  const provider = {
    id: 'telegram', inboundMode: 'long_polling',
    async validate() { return { id: '77', username: 't5_fixture_bot' }; },
    async poll({ signal }) {
      if (first) {
        first = false;
        return [{ updateId: 1, message: {
          provider: 'telegram', updateId: 1, messageId: '1', chatId: '555', threadId: null,
          userId: '42', username: 'owner', text: '텔레그램에서 시작', isDirectMessage: true,
        } }];
      }
      await new Promise((resolve) => signal?.addEventListener('abort', resolve, { once: true }));
      return [];
    },
    startTyping() { return { stop() {} }; },
    async sendReply(input) { deliveries.push(structuredClone(input)); return {
      sent: true, provider: 'telegram', chatId: input.chatId,
      messageId: String(deliveries.length), messageIds: [String(deliveries.length)], chunks: 1,
    }; },
  };
  const server = makeConsoleServer({
    stateDir: room, workspace: room, messengerProviderFactory: () => provider,
    modelFactory: () => ({ respond: async () => ({ text: '같은 대화로 답했어요.', toolCalls: [] }) }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const connected = await fetch(`${base}/channels/connect`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'telegram', token: 'fixture-token' }),
    });
    assert.equal(connected.status, 200);
    let session = null;
    for (let attempt = 0; attempt < 30 && !session; attempt += 1) {
      const listed = await fetch(`${base}/sessions`).then((response) => response.json());
      session = listed.sessions?.find((item) => item.origin?.channel === 'telegram') ?? null;
      if (!session) await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    assert.ok(session, 'Telegram 대화가 콘솔 목록에 보여야 한다');
    for (let attempt = 0; attempt < 30 && deliveries.length < 1; attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    assert.equal(deliveries.length, 1, '첫 inbound 답이 Telegram으로 돌아간다');
    const turn = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '콘솔에서 이어서 답해줘' }),
    });
    assert.equal(turn.status, 200);
    const result = await turn.json();
    assert.equal(result.channelDelivery?.sent, true);
    assert.equal(deliveries.length, 2);
    assert.equal(deliveries[1].chatId, '555');
  } finally {
    await server.closeMessengers();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});
