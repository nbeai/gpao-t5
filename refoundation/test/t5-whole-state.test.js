import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AttachmentStore } from '../src/attachment-store.js';
import { AutomationStore } from '../src/automation-store.js';
import { renderAttachmentPreview } from '../src/artifact-preview.js';
import { ConsoleSessionStore } from '../src/console-session-store.js';
import { makeConsoleServer } from '../src/console-server.js';
import { ConversationLedger } from '../src/conversation-ledger.js';
import { RunLedger } from '../src/run-ledger.js';
import { createWholeStateBundle, restoreWholeStateBundle } from '../src/whole-state-bundle.js';
import { makeT5WholeStateRegistry, validateT5WholeStateRelationships } from '../src/t5-whole-state.js';
import { WorkStore } from '../src/work-store.js';

async function mixedState(state) {
  const sessions = new ConsoleSessionStore(state); const session = await sessions.create();
  const conversations = new ConversationLedger(join(state, 'conversations'));
  await conversations.ensure({ sessionId: session.id });
  await conversations.appendMessage({ sessionId: session.id, messageId: 'message-1',
    message: { role: 'user', content: '보고서를 계속해' } });
  const workStore = new WorkStore(join(state, 'work'));
  const work = await workStore.create({ sessionId: session.id, sourceMessageId: 'message-1' });
  const runLedger = new RunLedger(join(state, 'runs'));
  const run = await runLedger.start({ sessionId: session.id, request: '보고서를 계속해' }); await run.finish('cancelled');
  const automation = new AutomationStore(join(state, 'automation', 'state.json'));
  const job = await automation.create({ name: '보고서 확인', prompt: '보고서를 확인한다', sessionId: session.id,
    scheduleKind: 'at', schedule: '2099-01-01T00:00:00.000Z', timezone: 'UTC',
    requirements: { requiredTools: [], requiredEffect: 'observe', requireResultUrl: false },
    delivery: { kind: 'origin_session' }, workBinding: { workId: work.workId, revision: 1 } });
  const attachments = new AttachmentStore(join(state, 'attachments'));
  const artifact = await attachments.receive({ sessionId: session.id, originalName: 'report.html',
    bytes: Buffer.from('<!doctype html><p>quarterly report</p>'), direction: 'output',
    sourcePath: '/old-computer/private/report.html' });
  await attachments.link({ sessionId: session.id, attachmentIds: [artifact.attachmentId],
    messageId: 'message-1', runId: run.runId });
  await mkdir(join(state, 'messenger'), { recursive: true });
  await writeFile(join(state, 'messenger', 'messenger-runtime.json'), JSON.stringify({ version: 1,
    offsets: {}, bindings: {}, allowed: {}, pending: {}, ingress: {} }));
  await writeFile(join(state, 'messenger', 'messenger-credentials.json'), 'PRIVATE-BOT-TOKEN');
  return { session, work, runId: run.runId, job, artifact };
}

test('T5 전체 registry는 혼합 canonical 관계를 암호화 이동하고 secret 원문은 제외한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-whole-product-'));
  try {
    const source = join(room, 'source'); await mkdir(source); const identities = await mixedState(source);
    const registry = await makeT5WholeStateRegistry(source); const bundle = join(room, 'state.t5backup');
    const receipt = await createWholeStateBundle({ registry, outputFile: bundle, password: 'portable private state',
      stagingParent: room, generationId: '44444444-4444-4444-8444-444444444444', createdAt: '2026-08-27T00:00:00.000Z' });
    assert.equal(receipt.encrypted, true);
    assert.equal((await readFile(bundle)).includes(Buffer.from('PRIVATE-BOT-TOKEN')), false);
    const destination = join(room, 'destination');
    const restored = await restoreWholeStateBundle({ bundleFile: bundle, password: 'portable private state',
      destinationStateRoot: destination, validateRelationships: validateT5WholeStateRelationships });
    await rm(source, { recursive: true, force: true });
    assert.equal(restored.externalEffectsRetried, 0); assert.equal(restored.secretsRequired, true);
    const sessions = await new ConsoleSessionStore(destination).read();
    assert.ok(sessions.sessions.some((item) => item.id === identities.session.id));
    const work = await new WorkStore(join(destination, 'work')).read();
    assert.ok(work.works.some((item) => item.workId === identities.work.workId));
    const automation = await new AutomationStore(join(destination, 'automation', 'state.json')).read();
    assert.ok(automation.jobs.some((item) => item.id === identities.job.id));
    const restoredAttachmentStore = new AttachmentStore(join(destination, 'attachments'));
    const restoredAttachmentList = await restoredAttachmentStore.list({ sessionId: identities.session.id });
    assert.ok(restoredAttachmentList.some((item) => item.attachmentId === identities.artifact.attachmentId),
      JSON.stringify({ expected: identities.artifact.attachmentId,
        actual: restoredAttachmentList.map((item) => item.attachmentId),
        ledger: await readFile(join(destination, 'attachments', 'ledger.jsonl'), 'utf8') }));
    const artifact = await restoredAttachmentStore.readContent({
      sessionId: identities.session.id, attachmentId: identities.artifact.attachmentId });
    assert.match(artifact.bytes.toString('utf8'), /quarterly report/u);
    assert.equal(artifact.record.storedPath.startsWith(join(destination, 'attachments', 'objects')), true);
    assert.match((await renderAttachmentPreview(artifact)).body, /quarterly report/u);
    await assert.rejects(() => readFile(join(destination, 'messenger', 'messenger-credentials.json')), { code: 'ENOENT' });
    let sentDocument = null;
    const provider = { id: 'telegram', inboundMode: 'long_polling',
      async validate() { return { id: 'bot', username: 'bot' }; },
      async sendDocument(value) { sentDocument = value; return { sent: true, messageId: 'file-1', file: {}, artifact: {} }; },
      async sendReply() { return { sent: true, messageId: 'text-1', messageIds: ['text-1'] }; },
      async poll({ signal } = {}) { if (signal?.aborted) return []; await new Promise((resolve) => signal?.addEventListener('abort', resolve, { once: true })); return []; } };
    const server = makeConsoleServer({ stateDir: destination, workspace: room,
      messengerProviderFactory: () => provider,
      modelFactory: () => ({ async respond() { throw new Error('model must not run'); } }) });
    try {
      await server.messengerGateway.connect({ provider: 'telegram', token: 'fixture-token' });
      await server.messengerStateStore.bind('telegram', '555', identities.session.id);
      await server.messengerGateway.sendToSession({ sessionId: identities.session.id, text: '복원 파일',
        artifactIds: [identities.artifact.attachmentId] });
      assert.match(Buffer.from(sentDocument.artifact.bytes).toString('utf8'), /quarterly report/u);
    } finally { await server.closeAutomations(); await server.closeMessengers(); }
    const portableLedger = await readFile(join(destination, 'attachments', 'ledger.jsonl'), 'utf8');
    assert.doesNotMatch(portableLedger, /"(?:storedPath|sourcePath)"|old-computer/u);
    assert.match(portableLedger, /"objectRelativePath"|"sourceAvailability":"reconnect_required"/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('T5 relationship validator는 foreign Work Session을 activation 전에 거부한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-whole-foreign-'));
  try {
    const source = join(room, 'source'); await mkdir(source); await mixedState(source);
    const workFile = join(source, 'work', 'events.jsonl');
    const events = (await readFile(workFile, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
    events.find((event) => event.type === 'work_created').sessionId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    await writeFile(workFile, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
    const registry = await makeT5WholeStateRegistry(source); const manifest = await registry.manifest({
      generationId: '55555555-5555-4555-8555-555555555555', createdAt: '2026-08-27T00:00:00.000Z' });
    await assert.rejects(() => validateT5WholeStateRelationships({ root: source, manifest }), /no Session/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('restore된 delivery dispatch_claimed는 새 Runtime에서 unknown으로 닫히며 blind send를 만들지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-whole-effect-'));
  try {
    const source = join(room, 'source'); await mkdir(source); const sessions = new ConsoleSessionStore(source);
    const session = await sessions.create(); const runs = new RunLedger(join(source, 'runs'));
    const sourceRun = await runs.start({ sessionId: session.id, request: '외부 전달' }); await sourceRun.finish('completed');
    const store = new AutomationStore(join(source, 'automation', 'state.json'));
    const job = await store.create({ name: '외부 전달', prompt: '결과를 전달한다', sessionId: session.id,
      scheduleKind: 'at', schedule: '2099-01-01T00:00:00.000Z', timezone: 'UTC',
      requirements: { requiredTools: [], requiredEffect: 'external_send', requireResultUrl: false },
      delivery: { kind: 'telegram', sessionId: session.id } });
    const [{ run, claim }] = await store.claimDue({ jobId: job.id, force: true,
      owner: { runtimeId: 'old-runtime', generation: 1 } });
    await store.markRunning(job.id, run.id, claim);
    await store.prepareResult({ jobId: job.id, runId: run.id, claim, sourceRunId: sourceRun.runId,
      objectiveStatus: 'achieved', resultPointer: `work-result:${sourceRun.runId}`, resultDigest: 'a'.repeat(64) });
    await store.markSurfacePersisted({ jobId: job.id, runId: run.id, claim,
      surfaceReceipt: { sessionId: session.id, runId: sourceRun.runId, resultDigest: 'a'.repeat(64) } });
    await store.claimDelivery({ jobId: job.id, runId: run.id, claim, deliveryId: 'delivery-before-crash', provider: 'telegram' });
    const registry = await makeT5WholeStateRegistry(source); const bundle = join(room, 'effect.t5backup');
    await createWholeStateBundle({ registry, outputFile: bundle, password: 'effect continuity password', stagingParent: room,
      generationId: '77777777-7777-4777-8777-777777777777', createdAt: '2026-08-27T00:00:00.000Z' });
    const restoredRoot = join(room, 'restored'); await restoreWholeStateBundle({ bundleFile: bundle,
      password: 'effect continuity password', destinationStateRoot: restoredRoot,
      validateRelationships: validateT5WholeStateRelationships });
    const restored = new AutomationStore(join(restoredRoot, 'automation', 'state.json'));
    const recovered = await restored.claimRecoverablePublications({ owner: { runtimeId: 'new-runtime', generation: 1 },
      inspectOwner: async () => 'definitely_dead' });
    assert.equal(recovered.length, 1); let sends = 0;
    const adopted = recovered[0];
    await restored.settleDelivery({ jobId: job.id, runId: run.id, claim: adopted.claim,
      deliveryId: adopted.run.deliveryClaim.deliveryId, status: 'unknown', receipt: { state: 'acknowledgement_unknown' } });
    assert.equal(sends, 0);
    assert.equal((await restored.read()).runs.find((item) => item.id === run.id).deliveryStatus, 'unknown');
  } finally { await rm(room, { recursive: true, force: true }); }
});
