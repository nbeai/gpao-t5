import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

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
