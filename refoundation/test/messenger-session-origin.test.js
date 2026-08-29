import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
  const html = await readFile(new URL('../../refoundation/ui/index.html', import.meta.url), 'utf8');
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
    workAdmissionMode: 'action-v1',
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
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const ingress = await server.messengerStateStore.ingress('telegram', 1);
      if (ingress?.state === 'completed') break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    const turn = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '콘솔에서 이어서 답해줘' }),
    });
    assert.equal(turn.status, 200);
    const result = await turn.json();
    assert.equal(result.channelDelivery?.sent, true);
    if(deliveries.length!==3)throw new Error(JSON.stringify({deliveries,first,second,modelCalls}));
    assert.match(deliveries[1].text, /내 요청 · 콘솔에서/u);
    assert.equal(deliveries[2].chatId, '555');
  } finally {
    await server.closeMessengers();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});

test('Telegram 대화의 console Run은 사용자 입력을 동기화하고 선택한 기존 원본 파일을 sendDocument로 전달한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-console-file-'));
  const filePath = join(room, '휴대폰에서 받을 파일.bin');
  const original = Buffer.from('exact-phone-download-bytes'); await writeFile(filePath, original);
  const textDeliveries = []; const fileDeliveries = []; let modelTurn = 0;
  const provider = {
    id: 'telegram', inboundMode: 'long_polling',
    async validate() { return { id: '77', username: 't5_fixture_bot' }; },
    async sendReply(input) { textDeliveries.push(structuredClone(input)); return {
      sent: true, provider: 'telegram', chatId: input.chatId,
      messageId: 'text-1', messageIds: ['text-1'], chunks: 1,
    }; },
    async sendDocument(input) {
      fileDeliveries.push({ ...structuredClone(input), bytes: Buffer.from(input.artifact.bytes) });
      return { sent: true, provider: 'telegram', chatId: input.chatId, messageId: 'file-1',
        file: { fileId: 'provider-file-1', fileUniqueId: 'provider-unique-1',
          fileName: input.artifact.record.originalName, mimeType: input.artifact.record.mimeType,
          bytes: input.artifact.bytes.length },
        artifact: { attachmentId: input.artifact.record.attachmentId,
          sha256: input.artifact.record.sha256, bytes: input.artifact.bytes.length } };
    },
  };
  const server = makeConsoleServer({
    stateDir: room, workspace: room, messengerProviderFactory: () => provider,
    modelFactory: () => ({ async respond() {
      modelTurn += 1;
      if (modelTurn === 1) return { text: '', toolCalls: [{
        id: 'register-file', name: 'attachment', args: {
          action: 'register_existing_file', attachmentId: null, filePath,
          maxChars: null, maxCells: null, maxPages: null, outputName: null,
          resultRelativePath: null, expectedResultJson: null,
          expectedStdoutIncludes: [], operationHandle: null,
        },
      }] };
      return { text: '요청한 파일을 첨부했어요.', toolCalls: [] };
    } }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await server.sessionStore.create({ origin: { channel: 'telegram', chatId: '555' } });
    const consoleAttachment = await server.attachmentStore.receive({
      sessionId: session.id, originalName: '콘솔에서_첨부.txt',
      bytes: Buffer.from('console-input-attachment'),
    });
    await server.messengerGateway.connect({ provider: 'telegram', token: 'fixture-token' });
    await server.messengerStateStore.bind('telegram', '555', session.id);
    const response = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id,
        text: '휴대폰에서 받을 파일.bin을 내 Telegram에 첨부해줘',
        attachmentIds: [consoleAttachment.attachmentId] }) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.channelDelivery.sent, true);
    assert.equal(result.channelDelivery.files.length, 1);
    assert.equal(result.channelDelivery.files[0].messageId, 'file-1');
    assert.equal(fileDeliveries.length, 2);
    assert.deepEqual(fileDeliveries[0].bytes, Buffer.from('console-input-attachment'));
    assert.deepEqual(fileDeliveries[1].bytes, original);
    assert.equal(textDeliveries.length, 2);
    assert.match(textDeliveries[0].text, /내 요청 · 콘솔에서/u);
    const run = (await server.runLedger.list({ sessionId: session.id }))[0];
    const terminal = run.events.find((event) => event.type === 'delivery_terminal');
    assert.equal(terminal.payload.files[0].messageId, 'file-1');
    assert.equal(result.channelDelivery.files[0].artifact.sha256, result.artifacts[0].sha256);
  } finally {
    await server.closeMessengers(); await new Promise((resolveClose) => server.close(resolveClose));
  }
});

test('provider 실패 전에 함께 제시된 Telegram 발화는 failure surface로 닫고 자동 재실행하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-provider-failure-release-'));
  const deliveries = []; let poll = 0; let modelCalls = 0; let transitionCalls = 0;
  const errors = [];
  const messages = ['첨부를 읽어줘', '그럼 다음 질문에 답해줘'];
  const provider = {
    id: 'telegram', inboundMode: 'long_polling',
    async validate() { return { id: '77', username: 't5_fixture_bot' }; },
    async poll({ signal }) {
      if (poll < messages.length) {
        poll += 1;
        return [{ updateId: poll, message: {
          provider: 'telegram', updateId: poll, messageId: String(poll), chatId: '555', threadId: null,
          userId: '42', username: 'owner', text: messages[poll - 1], isDirectMessage: true,
        } }];
      }
      await new Promise((resolve) => signal?.addEventListener('abort', resolve, { once: true }));
      return [];
    },
    startTyping() { return { stop() {} }; },
    async sendReply(input) {
      deliveries.push(String(input.text)); const messageId = String(700 + deliveries.length);
      return { sent: true, provider: 'telegram', chatId: input.chatId,
        messageId, messageIds: [messageId], chunks: 1 };
    },
  };
  const server = makeConsoleServer({
    stateDir: room, workspace: room, messengerProviderFactory: () => provider,
    workAdmissionMode: 'action-v1',
    modelFactory: (context) => context.purpose === 'transition_decision' ? ({ async respond() {
      transitionCalls += 1; return { text: '', toolCalls: [{ id: 'provider-failure-followup',
        name: 'transition_decision', args: { choice: 'steer_current', targetHandle: null,
          currentWorkDisposition: null } }] };
    } }) : ({ async respond() {
      modelCalls += 1;
      if (modelCalls === 1) throw Object.assign(new Error('provider rejected input'), {
        code: 'provider_http_error',
      });
      return { text: '두 번째 요청은 정상적으로 받았어요.', toolCalls: [] };
    } }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    onError: (error) => errors.push(error),
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
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [first,second] = await Promise.all([server.messengerStateStore.ingress('telegram',1),
        server.messengerStateStore.ingress('telegram', 2)]);
      if (first?.state === 'completed' && second?.state === 'completed') break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    const first = await server.messengerStateStore.ingress('telegram', 1);
    const second = await server.messengerStateStore.ingress('telegram', 2);
    for (let attempt = 0; attempt < 100 && deliveries.length < 2; attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    assert.equal(first.state, 'completed');
    assert.equal(first.messageIds?.length, 1);
    assert.equal(second.state, 'completed');
    const work = await server.workStore.read();
    assert.equal(modelCalls, 1, JSON.stringify({ transitionCalls, deliveries,
      claims: work.claims, inputs: work.inputs, events: work.events.map((event) => event.type),
      errors: errors.map((error) => error?.message ?? String(error)) }));
    assert.equal(transitionCalls, 0,
      'provider failure before input presentation closes the admitted input on one failure surface without a semantic transition call');
    assert.equal(deliveries.length, 2);
    assert.match(deliveries[Number(first.messageIds[0]) - 701],/응답을 만드는 단계에서 중단/u);
    assert.equal(work.claims.length, 1);
    assert.equal(work.claims[0].state, 'released');
    assert.equal(work.inputs[0].state, 'executed');
    assert.equal(work.events.filter((event) => event.type === 'input_execution_claimed').length, 0);
    assert.equal(work.events.filter((event) => event.type === 'input_failure_surface_claimed').length, 1);
  } finally {
    await server.closeMessengers();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});

test('T5를 재시작해도 첫 Telegram 사용자는 같은 콘솔 대화로 이어지고 중복 답장하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-console-restart-'));
  const deliveries = [];
  const makeProvider = (updateId, text) => {
    let first = true;
    return {
      id: 'telegram', inboundMode: 'long_polling',
      async validate() { return { id: '77', username: 't5_fixture_bot' }; },
      async poll({ signal }) {
        if (first) {
          first = false;
          return [{ updateId, message: {
            provider: 'telegram', updateId, messageId: String(updateId), chatId: '555', threadId: null,
            userId: '42', username: 'owner', text, isDirectMessage: true,
          } }];
        }
        await new Promise((resolve) => signal?.addEventListener('abort', resolve, { once: true }));
        return [];
      },
      startTyping() { return { stop() {} }; },
      async sendReply(input) {
        deliveries.push({ updateId, ...structuredClone(input) });
        return {
          sent: true, provider: 'telegram', chatId: input.chatId,
          messageId: String(deliveries.length), messageIds: [String(deliveries.length)], chunks: 1,
        };
      },
    };
  };
  const makeServer = (provider) => makeConsoleServer({
    stateDir: room, workspace: room, messengerProviderFactory: () => provider,
    modelFactory: () => ({ respond: async () => ({ text: '이어진 대화로 답했어요.', toolCalls: [] }) }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
  });
  const listen = async (server) => {
    await new Promise((resolveListen, reject) => {
      server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen);
    });
    return `http://127.0.0.1:${server.address().port}`;
  };
  const close = async (server) => {
    await server.closeMessengers();
    await new Promise((resolveClose) => server.close(resolveClose));
  };

  const firstServer = makeServer(makeProvider(1, '첫 메시지'));
  const firstBase = await listen(firstServer);
  let sessionId;
  try {
    const connected = await fetch(`${firstBase}/channels/connect`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'telegram', token: 'fixture-token' }),
    });
    assert.equal(connected.status, 200);
    for (let attempt = 0; attempt < 50 && !sessionId; attempt += 1) {
      const listed = await fetch(`${firstBase}/sessions`).then((response) => response.json());
      sessionId = listed.sessions?.find((item) => item.origin?.channel === 'telegram')?.id;
      if (!sessionId) await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    assert.ok(sessionId, '첫 Telegram 메시지가 콘솔 대화를 만든다');
    for (let attempt = 0; attempt < 50 && deliveries.length < 1; attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    assert.equal(deliveries.length, 1);
  } finally {
    await close(firstServer);
  }

  const secondServer = makeServer(makeProvider(2, '재시작 뒤 메시지'));
  const secondBase = await listen(secondServer);
  try {
    for (let attempt = 0; attempt < 50 && deliveries.length < 2; attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    assert.equal(deliveries.length, 2, '재시작 뒤 새 메시지에 답한다');
    const listed = await fetch(`${secondBase}/sessions`).then((response) => response.json());
    const telegramSessions = listed.sessions?.filter((item) => item.origin?.channel === 'telegram') ?? [];
    assert.equal(telegramSessions.length, 1, '같은 사용자의 대화를 새로 만들지 않는다');
    assert.equal(telegramSessions[0].id, sessionId);
    assert.deepEqual(deliveries.map((item) => item.updateId), [1, 2], '받은 메시지마다 한 번만 답한다');
  } finally {
    await close(secondServer);
  }
});
