import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeAttachmentTool } from '../src/attachment-hand.js';
import { AttachmentStore } from '../src/attachment-store.js';

const SESSION = '11111111-1111-4111-8111-111111111111';
const FOREIGN_SESSION = '99999999-9999-4999-8999-999999999999';
const RUN = '33333333-3333-4333-8333-333333333333';
const sha = (value) => createHash('sha256').update(value).digest('hex');
const attachmentArgs = (overrides = {}) => ({ action: 'register_output', attachmentId: null,
  filePath: null, maxChars: null, maxCells: null, maxPages: null, outputName: null,
  resultRelativePath: null, expectedResultJson: null, expectedStdoutIncludes: null,
  operationHandle: null, outputHandle: null, sourceManifestId: null, query: null,
  pageHandles: null, ...overrides });
const markPublished = (store, prepared, toolCallId) => store.markProducedOutputBatchPublicationVerified({
  sessionId: SESSION, runId: RUN, toolCallId, batchId: prepared.batchId,
  publication: { state: 'published_verified', undoHandle: `undo_${toolCallId}` },
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 't5-s4g-handoff-batch-'));
  const workspace = join(root, 'workspace'); const result = join(workspace, '결과');
  await mkdir(result, { recursive: true });
  const paths = [join(result, '합계.csv'), join(result, '행수.csv')];
  const contents = [Buffer.from('total\n30\n'), Buffer.from('rows\n2\n')];
  const directory = join(root, 'attachments'); const store = new AttachmentStore(directory);
  return { root, workspace, paths, contents, directory, store };
}

test('G handoff batch는 다중 postimage 전체를 한 commit으로 durable output identity로 만든다', async () => {
  const app = await fixture();
  try {
    const prepared = await app.store.prepareProducedOutputBatch({ sessionId: SESSION,
      workspace: app.workspace, runId: RUN, toolCallId: 'exec-g', outputs: app.paths.map((filePath, index) => ({
        filePath, expectedSha256: sha(app.contents[index]), expectedBytes: app.contents[index].length,
      })) });
    assert.equal(prepared.state, 'prepared'); assert.equal(prepared.outputCount, 2);
    await Promise.all(app.paths.map((path, index) => writeFile(path, app.contents[index])));
    await markPublished(app.store, prepared, 'exec-g');

    const committed = await app.store.commitProducedOutputBatch({ sessionId: SESSION,
      workspace: app.workspace, runId: RUN, toolCallId: 'exec-g', batchId: prepared.batchId });
    assert.equal(committed.state, 'committed'); assert.equal(committed.outputs.length, 2);
    assert.equal(new Set(committed.outputs.map((output) => output.outputHandle)).size, 2);
    const events = (await readFile(join(app.directory, 'ledger.jsonl'), 'utf8'))
      .split('\n').filter(Boolean).map(JSON.parse);
    assert.equal(events.filter((event) => event.type === 'output_batch_committed').length, 1);
    assert.equal(events.find((event) => event.type === 'output_batch_committed').payload.outputs.length, 2);
    const restored = new AttachmentStore(app.directory);
    assert.deepEqual((await restored.reconcileProducedOutputBatch({ sessionId: SESSION,
      workspace: app.workspace, runId: RUN, toolCallId: 'exec-g', batchId: prepared.batchId }))
      .outputs.map((output) => output.outputHandle), committed.outputs.map((output) => output.outputHandle));
    assert.equal((await restored.pendingProducedOutputs({ sessionId: SESSION, producerRunId: RUN })).length, 2);
  } finally { await rm(app.root, { recursive: true, force: true }); }
});

test('batch outputHandle은 path authorization이나 모델의 filePath 재구성 없이 Artifact로 등록된다', async () => {
  const app = await fixture();
  try {
    const prepared = await app.store.prepareProducedOutputBatch({ sessionId: SESSION,
      workspace: app.workspace, runId: RUN, toolCallId: 'exec-register', outputs: app.paths.map((filePath, index) => ({
        filePath, expectedSha256: sha(app.contents[index]), expectedBytes: app.contents[index].length,
    })) });
    await Promise.all(app.paths.map((path, index) => writeFile(path, app.contents[index])));
    await markPublished(app.store, prepared, 'exec-register');
    const committed = await app.store.commitProducedOutputBatch({ sessionId: SESSION,
      workspace: app.workspace, runId: RUN, toolCallId: 'exec-register', batchId: prepared.batchId });
    const tool = makeAttachmentTool({ store: app.store, sessionId: SESSION,
      workspace: app.workspace, runId: RUN, authorizeOutputPath: () => false });
    for (const output of committed.outputs) {
      const registered = await tool.execute(attachmentArgs({ outputHandle: output.outputHandle }));
      assert.equal(registered.state, 'registered'); assert.equal(registered.outputHandle, output.outputHandle);
    }
    assert.equal((await app.store.pendingProducedOutputs({ sessionId: SESSION, producerRunId: RUN })).length, 0);
    assert.equal((await app.store.list({ sessionId: SESSION })).length, 2);
  } finally { await rm(app.root, { recursive: true, force: true }); }
});

test('committed batch는 모델 호출 없이 Artifact 전량을 한 사건으로 등록하고 재시작에 멱등이다', async () => {
  const app = await fixture();
  try {
    const prepared = await app.store.prepareProducedOutputBatch({ sessionId: SESSION,
      workspace: app.workspace, runId: RUN, toolCallId: 'exec-artifacts', outputs: app.paths.map((filePath, index) => ({
        filePath, expectedSha256: sha(app.contents[index]), expectedBytes: app.contents[index].length,
      })) });
    await Promise.all(app.paths.map((path, index) => writeFile(path, app.contents[index])));
    await markPublished(app.store, prepared, 'exec-artifacts');
    await app.store.commitProducedOutputBatch({ sessionId: SESSION,
      workspace: app.workspace, runId: RUN, toolCallId: 'exec-artifacts', batchId: prepared.batchId });
    const registered = await app.store.registerProducedOutputBatch({ sessionId: SESSION,
      workspace: app.workspace, runId: RUN, batchId: prepared.batchId });
    assert.equal(registered.state, 'artifacts_registered'); assert.equal(registered.artifacts.length, 2);
    assert.ok(registered.artifacts.every((artifact) => artifact.direction === 'output'));
    assert.ok(registered.artifacts.every((artifact) => artifact.links.length === 1
      && artifact.links[0].runId === RUN));
    assert.equal((await app.store.pendingProducedOutputs({ sessionId: SESSION, producerRunId: RUN })).length, 0);
    const events = (await readFile(join(app.directory, 'ledger.jsonl'), 'utf8'))
      .split('\n').filter(Boolean).map(JSON.parse);
    assert.equal(events.filter((event) => event.type === 'output_batch_artifacts_registered').length, 1);
    const restored = new AttachmentStore(app.directory);
    const repeated = await restored.registerProducedOutputBatch({ sessionId: SESSION,
      workspace: app.workspace, runId: RUN, batchId: prepared.batchId });
    assert.deepEqual(repeated.artifacts.map((artifact) => artifact.attachmentId),
      registered.artifacts.map((artifact) => artifact.attachmentId));
  } finally { await rm(app.root, { recursive: true, force: true }); }
});

test('batch commit 뒤 target이 바뀌면 Artifact 사건과 일부 등록을 만들지 않는다', async () => {
  const app = await fixture();
  try {
    const prepared = await app.store.prepareProducedOutputBatch({ sessionId: SESSION,
      workspace: app.workspace, runId: RUN, toolCallId: 'exec-stale', outputs: app.paths.map((filePath, index) => ({
        filePath, expectedSha256: sha(app.contents[index]), expectedBytes: app.contents[index].length,
      })) });
    await Promise.all(app.paths.map((path, index) => writeFile(path, app.contents[index])));
    await markPublished(app.store, prepared, 'exec-stale');
    await app.store.commitProducedOutputBatch({ sessionId: SESSION,
      workspace: app.workspace, runId: RUN, toolCallId: 'exec-stale', batchId: prepared.batchId });
    await writeFile(app.paths[1], 'changed');
    await assert.rejects(app.store.registerProducedOutputBatch({ sessionId: SESSION,
      workspace: app.workspace, runId: RUN, batchId: prepared.batchId }), /identity changed/u);
    assert.equal((await app.store.list({ sessionId: SESSION })).length, 0);
    assert.equal((await app.store.pendingProducedOutputs({ sessionId: SESSION, producerRunId: RUN })).length, 2);
  } finally { await rm(app.root, { recursive: true, force: true }); }
});

test('F 뒤 crash는 successor가 postimage 전량일 때 handoff만 commit한다', async () => {
  const app = await fixture();
  try {
    const prepared = await app.store.prepareProducedOutputBatch({ sessionId: SESSION,
      workspace: app.workspace, runId: RUN, toolCallId: 'exec-crash', outputs: app.paths.map((filePath, index) => ({
        filePath, expectedSha256: sha(app.contents[index]), expectedBytes: app.contents[index].length,
    })) });
    await Promise.all(app.paths.map((path, index) => writeFile(path, app.contents[index])));
    await markPublished(app.store, prepared, 'exec-crash');
    const successor = new AttachmentStore(app.directory);
    const recovered = await successor.reconcileProducedOutputBatch({ sessionId: SESSION,
      workspace: app.workspace, runId: RUN, toolCallId: 'exec-crash', batchId: prepared.batchId });
    assert.equal(recovered.state, 'committed'); assert.equal(recovered.reconciled, true);
    assert.equal(recovered.outputs.length, 2);
  } finally { await rm(app.root, { recursive: true, force: true }); }
});

test('postimage가 모두 맞아도 F verified receipt가 없으면 output identity를 만들지 않는다', async () => {
  const app = await fixture();
  try {
    const prepared = await app.store.prepareProducedOutputBatch({ sessionId: SESSION,
      workspace: app.workspace, runId: RUN, toolCallId: 'exec-unverified', outputs: app.paths.map((filePath, index) => ({
        filePath, expectedSha256: sha(app.contents[index]), expectedBytes: app.contents[index].length,
      })) });
    await Promise.all(app.paths.map((path, index) => writeFile(path, app.contents[index])));
    const result = await new AttachmentStore(app.directory).reconcileProducedOutputBatch({ sessionId: SESSION,
      workspace: app.workspace, runId: RUN, toolCallId: 'exec-unverified', batchId: prepared.batchId });
    assert.equal(result.state, 'partial_effect_unknown');
    assert.equal((await app.store.pendingProducedOutputs({ sessionId: SESSION, producerRunId: RUN })).length, 0);
  } finally { await rm(app.root, { recursive: true, force: true }); }
});

test('일부 target만 postimage면 handle을 하나도 만들지 않고 partial effect unknown이다', async () => {
  const app = await fixture();
  try {
    const prepared = await app.store.prepareProducedOutputBatch({ sessionId: SESSION,
      workspace: app.workspace, runId: RUN, toolCallId: 'exec-partial', outputs: app.paths.map((filePath, index) => ({
        filePath, expectedSha256: sha(app.contents[index]), expectedBytes: app.contents[index].length,
      })) });
    await writeFile(app.paths[0], app.contents[0]);
    const result = await new AttachmentStore(app.directory).reconcileProducedOutputBatch({ sessionId: SESSION,
      workspace: app.workspace, runId: RUN, toolCallId: 'exec-partial', batchId: prepared.batchId });
    assert.equal(result.state, 'partial_effect_unknown');
    assert.equal((await app.store.pendingProducedOutputs({ sessionId: SESSION, producerRunId: RUN })).length, 0);
  } finally { await rm(app.root, { recursive: true, force: true }); }
});

test('모든 target이 preimage면 미발행으로 정산하고 output identity를 만들지 않는다', async () => {
  const app = await fixture();
  try {
    await Promise.all(app.paths.map((path, index) => writeFile(path, Buffer.from(`old-${index}`))));
    const prepared = await app.store.prepareProducedOutputBatch({ sessionId: SESSION,
      workspace: app.workspace, runId: RUN, toolCallId: 'exec-none', outputs: app.paths.map((filePath, index) => ({
        filePath, expectedSha256: sha(app.contents[index]), expectedBytes: app.contents[index].length,
      })) });
    const result = await new AttachmentStore(app.directory).reconcileProducedOutputBatch({ sessionId: SESSION,
      workspace: app.workspace, runId: RUN, toolCallId: 'exec-none', batchId: prepared.batchId });
    assert.equal(result.state, 'not_published');
    assert.equal((await app.store.pendingProducedOutputs({ sessionId: SESSION, producerRunId: RUN })).length, 0);
  } finally { await rm(app.root, { recursive: true, force: true }); }
});

test('foreign Session·workspace는 prepared batch를 commit하거나 reconcile하지 못한다', async () => {
  const app = await fixture(); const foreignWorkspace = join(app.root, 'foreign'); await mkdir(foreignWorkspace);
  try {
    const prepared = await app.store.prepareProducedOutputBatch({ sessionId: SESSION,
      workspace: app.workspace, runId: RUN, toolCallId: 'exec-owner', outputs: app.paths.map((filePath, index) => ({
        filePath, expectedSha256: sha(app.contents[index]), expectedBytes: app.contents[index].length,
    })) });
    await Promise.all(app.paths.map((path, index) => writeFile(path, app.contents[index])));
    await markPublished(app.store, prepared, 'exec-owner');
    await assert.rejects(app.store.commitProducedOutputBatch({ sessionId: FOREIGN_SESSION,
      workspace: app.workspace, runId: RUN, toolCallId: 'exec-owner', batchId: prepared.batchId }),
    /identity mismatch/u);
    await assert.rejects(app.store.reconcileProducedOutputBatch({ sessionId: SESSION,
      workspace: foreignWorkspace, runId: RUN, toolCallId: 'exec-owner', batchId: prepared.batchId }),
    /workspace mismatch/u);
    assert.equal((await app.store.pendingProducedOutputs({ sessionId: SESSION, producerRunId: RUN })).length, 0);
  } finally { await rm(app.root, { recursive: true, force: true }); }
});
