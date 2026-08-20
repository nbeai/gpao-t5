import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('Telegram 턴의 안전한 진행 문구는 콘솔 SSE와 같은 Telegram 말풍선에 동시 전달된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-progress-live-'));
  const updates = [];
  const telegramProgress = [];
  const provider = {
    id: 'telegram', inboundMode: 'long_polling',
    async validate() { return { id: 'bot-1', username: 'fixture_bot' }; },
    async poll() { return updates.splice(0); },
    startTyping() { return { stop() {} }; },
    createProgress() {
      return {
        async update(text) { telegramProgress.push(text); },
        async finalize(text) { telegramProgress.push(`final:${text}`); return { sent: true }; },
        async fail() { telegramProgress.push('failed'); },
      };
    },
    async sendReply() { throw new Error('progress finalization should deliver'); },
  };
  const server = makeConsoleServer({
    stateDir: room, workspace: room,
    modelFactory: async () => ({
      async respond() {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { text: '완료했어요.', toolCalls: [] };
      },
    }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    messengerProviderFactory: () => provider,
  });
  const base = await listen(server);
  const streamAbort = new AbortController();
  try {
    await server.messengerCredentialStore.setVerified('telegram', {
      token: 'fixture-token', bot: { id: 'bot-1', username: 'fixture_bot' },
    });
    await server.messengerStateStore.allow('telegram', { userId: '42' });
    const stream = await fetch(`${base}/events/stream`, { signal: streamAbort.signal });
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let eventText = '';
    const readEvents = (async () => {
      while (!eventText.includes('"done":true')) {
        const part = await reader.read();
        if (part.done) break;
        eventText += decoder.decode(part.value, { stream: true });
      }
    })();
    updates.push({
      updateId: 1,
      message: {
        provider: 'telegram', chatId: '555', threadId: null,
        userId: '42', username: null, text: '긴 일 해줘', isDirectMessage: true,
      },
    });
    assert.equal((await server.messengerGateway.pollOnce()).replied, 1);
    await readEvents;
    assert.match(eventText, /event: messenger_progress/u);
    assert.match(eventText, /판단하고 있어요/u);
    assert.match(eventText, /"done":true/u);
    assert.ok(telegramProgress.includes('판단하고 있어요'));
    assert.ok(telegramProgress.includes('final:완료했어요.'));
    const sessions = await fetch(`${base}/sessions`).then((response) => response.json());
    assert.deepEqual(sessions.sessions[0].origin, { channel: 'telegram', chatId: '555' });
  } finally {
    streamAbort.abort();
    await server.closeMessengers();
    await new Promise((resolve) => server.close(resolve));
  }
});
