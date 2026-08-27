import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { ConsoleSessionStore } from '../src/console-session-store.js';
import { WorkStore } from '../src/work-store.js';
import { MessengerCredentialStore } from '../src/messenger-credential-store.js';
import { MessengerStateStore } from '../src/messenger-gateway.js';

async function waitForFileCount(directory, count, attempts = 500) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if ((await readdir(directory)).length >= count) return true;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  return false;
}

async function crossProcessFixture(prefix) {
  const room = await mkdtemp(join(tmpdir(), prefix));
  const workspace = join(room, 'workspace'); const markers = join(room, 'markers');
  await mkdir(workspace); await mkdir(markers);
  const sessions = new ConsoleSessionStore(room);
  const session = await sessions.create({ origin: { channel: 'telegram', chatId: '555' } });
  const runId = randomUUID(); const surfaceResult = { kind: 'reply', reply: '한 번만 보내야 해요.', runId };
  const resultDigest = createHash('sha256').update(JSON.stringify(surfaceResult)).digest('hex');
  const workStore = new WorkStore(join(room, 'work'));
  await workStore.recordResultReady({ runId, sessionId: session.id,
    objectiveOutcome: 'achieved', resultDigest, surfaceResult });
  const messengerDirectory = join(room, 'messenger');
  const credentials = new MessengerCredentialStore(messengerDirectory);
  await credentials.setVerified('telegram', {
    token: 'fixture-token', bot: { id: 'fixture-bot', username: 'fixture_bot' },
  });
  await new MessengerStateStore(messengerDirectory).bind('telegram', '555', session.id);
  return { room, workspace, markers, sessions, session, workStore };
}

function spawnRecoveryChild({ room, workspace, markers, hold }) {
  const source = `
    import { access, writeFile } from 'node:fs/promises';
    import { join } from 'node:path';
    const { makeConsoleServer } = await import(process.env.T5_CONSOLE_MODULE);
    const wait = async (path) => {
      for (let attempt = 0; attempt < 2000; attempt += 1) {
        try { await access(path); return; } catch {}
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      throw new Error('child recovery gate timed out');
    };
    const provider = () => ({
      id: 'telegram', inboundMode: 'long_polling',
      async validate() { return { id: 'fixture-bot', username: 'fixture_bot' }; },
      async sendReply() {
        await writeFile(join(process.env.T5_MARKERS, String(process.pid)), 'send');
        if (process.env.T5_HOLD === '1') await wait(join(process.env.T5_ROOM, 'RELEASE'));
        return { sent: true, messageId: 'message-' + process.pid,
          messageIds: ['message-' + process.pid] };
      },
      async poll({ signal } = {}) {
        if (signal?.aborted) return [];
        await new Promise((resolve) => signal?.addEventListener('abort', resolve, { once: true }));
        return [];
      },
    });
    const server = makeConsoleServer({ stateDir: process.env.T5_ROOM,
      workspace: process.env.T5_WORKSPACE, messengerProviderFactory: provider,
      modelFactory: () => ({ async respond() { throw new Error('model must not run'); } }) });
    await server.recoverResultPublications();
    await server.closeMessengers();
  `;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', source], {
    env: { ...process.env, T5_ROOM: room, T5_WORKSPACE: workspace, T5_MARKERS: markers,
      T5_HOLD: hold ? '1' : '0',
      T5_CONSOLE_MODULE: new URL('../src/console-server.js', import.meta.url).href },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  const exit = new Promise((resolve) => child.on('exit', (code) => resolve({ code, stderr })));
  return { child, exit };
}

test('Telegram result recovery는 저장된 exact artifact를 한 번 보내고 text+file receipt 뒤 terminal이 된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-telegram-result-recovery-'));
  const workspace = join(room, 'workspace'); await mkdir(workspace);
  const filePath = join(workspace, '복구할-원본.bin');
  const original = Buffer.from('telegram-crash-recovery-exact-bytes');
  await writeFile(filePath, original);
  let modelCalls = 0; let documentCalls = 0; let textCalls = 0;
  let textStarted; const textStartedPromise = new Promise((resolve) => { textStarted = resolve; });
  let releaseText; const textGate = new Promise((resolve) => { releaseText = resolve; });
  const provider = {
    id: 'telegram', inboundMode: 'long_polling',
    async validate() { return { id: 'fixture-bot', username: 'fixture_bot' }; },
    async sendDocument({ artifact }) {
      documentCalls += 1;
      assert.deepEqual(Buffer.from(artifact.bytes), original);
      return { sent: true, provider: 'telegram', chatId: '555', messageId: 'file-recovery-1',
        file: { fileId: 'file-id-1', fileUniqueId: 'unique-1',
          fileName: artifact.record.originalName, mimeType: artifact.record.mimeType,
          bytes: artifact.record.bytes },
        artifact: { attachmentId: artifact.record.attachmentId,
          sha256: artifact.record.sha256, bytes: artifact.record.bytes } };
    },
    async sendReply() {
      textCalls += 1; textStarted(); await textGate;
      return { sent: true, provider: 'telegram', chatId: '555',
        messageId: 'text-recovery-1', messageIds: ['text-recovery-1'], chunks: 1 };
    },
  };
  const modelFactory = () => ({ async respond() {
    modelCalls += 1; throw new Error('recovery must not rerun the model');
  } });
  const first = makeConsoleServer({ stateDir: room, workspace,
    messengerProviderFactory: () => provider, modelFactory });
  let second;
  try {
    await first.recoverResultPublications();
    const session = await first.sessionStore.create({ origin: { channel: 'telegram', chatId: '555' } });
    await first.messengerGateway.connect({ provider: 'telegram', token: 'fixture-token' });
    await first.messengerStateStore.bind('telegram', '555', session.id);
    const artifact = await first.attachmentStore.registerOutput({ sessionId: session.id,
      workspace, filePath });
    const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const surfaceResult = { kind: 'reply', reply: '복구한 원본 파일이에요.', runId,
      artifacts: [{ attachmentId: artifact.attachmentId, originalName: artifact.originalName,
        mimeType: artifact.mimeType, bytes: artifact.bytes, sha256: artifact.sha256 }] };
    const resultDigest = createHash('sha256').update(JSON.stringify(surfaceResult)).digest('hex');
    await first.workStore.recordResultReady({ runId, sessionId: session.id,
      objectiveOutcome: 'achieved', resultDigest, surfaceResult });

    second = makeConsoleServer({ stateDir: room, workspace,
      messengerProviderFactory: () => provider, modelFactory });
    const recovery = second.recoverResultPublications();
    await textStartedPromise;
    let state = await second.workStore.read();
    assert.equal(state.results[0].state, 'delivery_started');
    assert.equal(documentCalls, 1); assert.equal(textCalls, 1); assert.equal(modelCalls, 0);
    releaseText(); await recovery;

    state = await second.workStore.read(); const result = state.results[0];
    assert.equal(result.state, 'delivery_terminal'); assert.equal(result.delivery.state, 'sent');
    assert.deepEqual(result.delivery.messageIds, ['file-recovery-1', 'text-recovery-1']);
    assert.equal(result.delivery.files.length, 1);
    assert.equal(result.delivery.files[0].artifact.attachmentId, artifact.attachmentId);
    assert.equal(result.delivery.files[0].artifact.sha256, artifact.sha256);
    assert.equal(artifact.sha256, createHash('sha256').update(original).digest('hex'));
    assert.equal(documentCalls, 1); assert.equal(textCalls, 1); assert.equal(modelCalls, 0);
    assert.equal((await second.runLedger.list({ sessionId: session.id })).length, 0);
  } finally {
    releaseText?.();
    await first.closeMessengers(); await second?.closeMessengers();
    await rm(room, { recursive: true, force: true });
  }
});

test('Telegram result recovery의 ACK 불명확 오류는 unknown으로 보존하고 blind retry하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-telegram-result-recovery-unknown-'));
  const workspace = join(room, 'workspace'); await mkdir(workspace);
  let sendCalls = 0;
  const provider = {
    id: 'telegram', inboundMode: 'long_polling',
    async validate() { return { id: 'fixture-bot', username: 'fixture_bot' }; },
    async poll({ signal } = {}) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 100); timer.unref?.();
        signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
      });
      return [];
    },
    async sendReply() {
      sendCalls += 1;
      throw Object.assign(new Error('Telegram acknowledgement lost'), {
        code: 'telegram_delivery_unknown', effectUnknown: true, retrySafe: false,
      });
    },
  };
  const modelFactory = () => ({ async respond() { throw new Error('recovery must not rerun the model'); } });
  const first = makeConsoleServer({ stateDir: room, workspace,
    messengerProviderFactory: () => provider, modelFactory });
  let second;
  try {
    await first.recoverResultPublications();
    const session = await first.sessionStore.create({ origin: { channel: 'telegram', chatId: '555' } });
    await first.messengerGateway.connect({ provider: 'telegram', token: 'fixture-token' });
    await first.messengerStateStore.bind('telegram', '555', session.id);
    const runId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const surfaceResult = { kind: 'reply', reply: 'ACK를 확인할 수 없는 복구 결과', runId };
    const resultDigest = createHash('sha256').update(JSON.stringify(surfaceResult)).digest('hex');
    await first.workStore.recordResultReady({ runId, sessionId: session.id,
      objectiveOutcome: 'achieved', resultDigest, surfaceResult });

    second = makeConsoleServer({ stateDir: room, workspace,
      messengerProviderFactory: () => provider, modelFactory });
    await second.recoverResultPublications();
    let result = (await second.workStore.read()).results[0];
    assert.equal(result.state, 'delivery_terminal');
    assert.equal(result.delivery.state, 'unknown');
    assert.equal(result.delivery.retrySafe, false);
    assert.equal(sendCalls, 1);
    await second.recoverResultPublications();
    result = (await second.workStore.read()).results[0];
    assert.equal(result.delivery.state, 'unknown');
    assert.equal(sendCalls, 1, 'unknown external delivery must not be retried after terminal recovery');
  } finally {
    await first.closeMessengers(); await second?.closeMessengers();
    await rm(room, { recursive: true, force: true });
  }
});

test('두 product process의 result recovery는 같은 polling owner fence로 exact-once 전송한다', async () => {
  const fixture = await crossProcessFixture('t5-telegram-cross-process-recovery-');
  const first = spawnRecoveryChild({ ...fixture, hold: true });
  const second = spawnRecoveryChild({ ...fixture, hold: true });
  try {
    assert.equal(await waitForFileCount(fixture.markers, 1), true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await readdir(fixture.markers)).length, 1,
      'the contender must not persist a second surface or dispatch a second send');
    await writeFile(join(fixture.room, 'RELEASE'), 'continue');
    const exits = await Promise.all([first.exit, second.exit]);
    assert.deepEqual(exits.map((item) => item.code), [0, 0],
      exits.map((item) => item.stderr).join('\n'));
    const state = await fixture.workStore.read();
    assert.equal(state.results[0].state, 'delivery_terminal');
    assert.equal(state.results[0].delivery.state, 'sent');
    assert.deepEqual(state.events.map((event) => event.sequence),
      state.events.map((_, index) => index + 1));
    const session = await fixture.sessions.load(fixture.session.id);
    assert.equal(session.transcript.filter((entry) => entry.role === 'assistant').length, 1);
  } finally {
    if (first.child.exitCode == null) first.child.kill('SIGKILL');
    if (second.child.exitCode == null) second.child.kill('SIGKILL');
    await rm(fixture.room, { recursive: true, force: true });
  }
});

test('result recovery owner crash 뒤 successor는 delivery_started를 unknown으로 인계하고 재전송하지 않는다', async () => {
  const fixture = await crossProcessFixture('t5-telegram-recovery-owner-crash-');
  const owner = spawnRecoveryChild({ ...fixture, hold: true });
  let successor = null;
  try {
    assert.equal(await waitForFileCount(fixture.markers, 1), true);
    owner.child.kill('SIGKILL');
    const ownerExit = await owner.exit;
    assert.notEqual(ownerExit.code, 0);
    successor = spawnRecoveryChild({ ...fixture, hold: false });
    const successorExit = await successor.exit;
    assert.equal(successorExit.code, 0, successorExit.stderr);
    assert.equal((await readdir(fixture.markers)).length, 1,
      'successor must not blind resend after the owner crossed delivery_started');
    const state = await fixture.workStore.read();
    assert.equal(state.results[0].state, 'delivery_terminal');
    assert.equal(state.results[0].delivery.state, 'unknown');
    assert.deepEqual(state.events.map((event) => event.sequence),
      state.events.map((_, index) => index + 1));
    const session = await fixture.sessions.load(fixture.session.id);
    assert.equal(session.transcript.filter((entry) => entry.role === 'assistant').length, 1);
  } finally {
    if (owner.child.exitCode == null) owner.child.kill('SIGKILL');
    if (successor?.child.exitCode == null) successor.child.kill('SIGKILL');
    await rm(fixture.room, { recursive: true, force: true });
  }
});
