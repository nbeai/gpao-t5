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
    modelFactory: async () => {
      let turn = 0;
      return {
        async respond() {
          turn += 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
          if (turn === 1) return {
            text: '', toolCalls: [{ id: 'progress-exec', name: 'exec', args: {
              command: "printf 'progress-ok'", cwd: null,
              effect: {
                kind: 'observe', summary: '진행 상태 시험', targets: [], reversible: true,
                backupAvailable: true, recipientNew: false, approvalToken: null,
              },
            } }],
          };
          return { text: '완료했어요.', toolCalls: [] };
        },
      };
    },
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
    assert.match(eventText, /요청을 이해하고 있어요/u);
    assert.match(eventText, /컴퓨터에서 필요한 정보를 확인하고 있어요/u);
    assert.match(eventText, /컴퓨터 작업 결과를 다시 확인하고 있어요/u);
    assert.match(eventText, /확인한 내용을 바탕으로 다음 단계를 생각하고 있어요/u);
    assert.match(eventText, /"done":true/u);
    const expectedProgress = [
      '요청을 이해하고 있어요',
      '컴퓨터에서 필요한 정보를 확인하고 있어요',
      '컴퓨터 작업 결과를 다시 확인하고 있어요',
      '확인한 내용을 바탕으로 다음 단계를 생각하고 있어요',
    ];
    assert.deepEqual(telegramProgress.slice(0, expectedProgress.length), expectedProgress);
    assert.doesNotMatch(eventText, /판단/u);
    assert.doesNotMatch(telegramProgress.join('\n'), /판단/u);
    assert.ok(telegramProgress.includes('final:완료했어요.'));
    const sessions = await fetch(`${base}/sessions`).then((response) => response.json());
    assert.deepEqual(sessions.sessions[0].origin, { channel: 'telegram', chatId: '555' });
  } finally {
    streamAbort.abort();
    await server.closeMessengers();
    await new Promise((resolve) => server.close(resolve));
  }
});
