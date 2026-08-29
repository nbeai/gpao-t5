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

async function until(check, attempts = 200) {
  for (let index = 0; index < attempts; index += 1) {
    const value = await check(); if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition not reached');
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
    for (const text of expectedProgress) assert.ok(telegramProgress.includes(text), text);
    assert.ok(!telegramProgress.includes('이제 거의 다 됐어요'));
    assert.ok(telegramProgress.includes('컴퓨터에서 확인 작업 한 단계를 마쳤어요.'));
    assert.match(eventText, /컴퓨터에서 확인 작업 한 단계를 마쳤어요/u);
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

test('긴 Telegram 작업 중 두 번째 입력은 즉시 Work에 보존되고 첫 실행 뒤 정확히 한 번 이어진다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-work-admission-'));
  const updates = []; const waiters = []; const progressTexts = [];
  const push = (update) => { updates.push(update); waiters.splice(0).forEach((wake) => wake()); };
  const provider = {
    id: 'telegram', inboundMode: 'long_polling',
    async validate() { return { id: 'bot-1', username: 'fixture_bot' }; },
    async poll({ signal } = {}) {
      if (!updates.length) await new Promise((resolve) => {
        const done = () => resolve(); waiters.push(done); signal?.addEventListener('abort', done, { once: true });
      });
      return updates.splice(0);
    },
    startTyping() { return { stop() {} }; },
    createProgress() { return { async update(value) { progressTexts.push(value); },
      async finalize() { return { sent: true, messageIds: [`progress-${progressTexts.length}`] }; },
      async discard() {} }; },
    async sendReply() { return { sent: true }; },
  };
  let modelCalls = 0; let releaseFirst;
  const first = new Promise((resolve) => { releaseFirst = resolve; });
  const server = makeConsoleServer({ stateDir: room, workspace: room,
    modelFactory: async (context) => context.purpose === 'transition_decision' ? ({ async respond() {
      return { text: '', toolCalls: [{ id: 'followup', name: 'transition_decision', args: {
        choice: 'followup_after_delivery', targetHandle: null, currentWorkDisposition: null,
      } }] };
    } }) : (() => {
      let completionProposed = false;
      return { async respond(input) {
        modelCalls += 1;
        if (modelCalls === 1) await first;
        const handles = [...new Set(input.messages.flatMap((item) => (
          [...String(item.content ?? '').matchAll(/inputHandle=(busy_[A-Za-z0-9_-]{8,80})/gu)]
            .map((match) => match[1])
        )))];
        if (handles.length && !completionProposed
          && input.tools.some((tool) => tool.name === 'work_completion')) {
          completionProposed = true;
          return { text: '', toolCalls: [{ id: 'settle', name: 'work_completion', args: {
            outcome: 'unresolved', inputSettlements: handles.map((handle) => ({
              handle, disposition: 'answered',
            })),
          } }] };
        }
        return { text: `완료 ${modelCalls}`, toolCalls: [] };
      } };
    })(),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    messengerProviderFactory: () => provider,
  });
  const base = await listen(server);
  try {
    await server.messengerCredentialStore.setVerified('telegram', {
      token: 'fixture-token', bot: { id: 'bot-1', username: 'fixture_bot' },
    });
    await server.messengerStateStore.allow('telegram', { userId: '42' });
    await server.messengerGateway.start({ provider: 'telegram' });
    const message = (id, text) => ({ updateId: id, message: { provider: 'telegram', messageId: String(id),
      chatId: '42', threadId: null, userId: '42', username: null, text, isDirectMessage: true } });
    push(message(10, '오래 걸리는 첫 작업'));
    await until(() => modelCalls === 1);
    const admittedAt = Date.now(); push(message(11, '이 교정도 반영해줘'));
    const queued = await until(async () => {
      const sessions = await fetch(`${base}/sessions`).then((response) => response.json());
      const reality = sessions.sessions[0]?.workReality;
      return reality?.inputs?.some((item) => item.text === '현재 작업에 반영할 내용을 받았어요.')
        ? reality : null;
    });
    assert.ok(Date.now() - admittedAt < 500, '두 번째 입력은 첫 모델 완료를 기다리지 않는다');
    assert.equal(modelCalls, 1);
    assert.ok(queued.inputs.some((item) => item.text === '현재 작업에 반영할 내용을 받았어요.'));
    await until(() => progressTexts.includes('현재 작업에 반영할 내용을 받았어요.'));
    const queuedIngress = await until(async () => {
      const value = await server.messengerStateStore.ingress('telegram', 11);
      return value?.state === 'completed' ? value : null;
    });
    assert.equal(queuedIngress.messageIds.length, 1, 'bounded acknowledgement ACK를 ingress에 정산한다');
    releaseFirst();
    await until(() => modelCalls >= 2);
    await until(async () => {
      const session = (await fetch(`${base}/sessions`).then((response) => response.json())).sessions[0];
      const detail = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
      return detail.transcript.filter((entry) => entry.role === 'assistant').length === 2
        && detail.workReality.inputs.some((item) => item.text === '현재 결과에 반영했어요.');
    });
    assert.equal(modelCalls, 2, '후속 입력은 한 Run에서만 실행한다');
  } finally {
    releaseFirst();
    await server.closeMessengers();
    await new Promise((resolve) => server.close(resolve));
  }
});
