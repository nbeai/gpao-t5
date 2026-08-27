import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AttachmentStore } from '../src/attachment-store.js';
import { makeAttachmentTool } from '../src/attachment-hand.js';
import { makeArtifactPublicationProductAdapter, projectHumanArtifactReceipt } from '../src/artifact-publication-projection.js';
import { RunLedger } from '../src/run-ledger.js';
import { WorkStore } from '../src/work-store.js';

const SESSION = '11111111-1111-4111-8111-111111111111';
async function fixture({ existing = true, sourceProvenance = null } = {}) {
  const room = await mkdtemp(join(tmpdir(), 't5-artifact-publication-')); const workspace = join(room, 'workspace');
  await mkdir(workspace); const file = join(workspace, '결과.xlsx'); await writeFile(file, 'exact-bytes');
  const attachments = new AttachmentStore(join(room, 'attachments'));
  const runs = new RunLedger(join(room, 'runs')); const work = new WorkStore(join(room, 'work.jsonl'));
  const writer = await runs.start({ sessionId: SESSION, request: '파일을 준비해줘' });
  const current = await work.create({ sessionId: SESSION, sourceMessageId: 'fixture-message' });
  await work.claimExecution({ workId: current.workId, revision: current.revision, runId: writer.runId });
  const tool = makeAttachmentTool({ store: attachments, sessionId: SESSION, workspace, runId: writer.runId,
    authorizeExistingFilePath: () => true, authorizeOutputPath: () => true });
  let result = await tool.execute({ action: existing ? 'register_existing_file' : 'register_output', filePath: file });
  if (sourceProvenance) result = { ...result, sourceProvenance };
  await writer.append({ type: 'tool_completed', payload: { receipt: { outcome: 'succeeded',
    requestedCall: { name: 'attachment', args: { action: existing ? 'register_existing_file' : 'register_output',
      filePath: file } }, result } } });
  await work.recordResultReady({ runId: writer.runId, sessionId: SESSION,
    workId: current.workId, revision: current.revision, resultDigest: 'a'.repeat(64),
    surfaceResult: { kind: 'reply', artifacts: [{ attachmentId: result.artifact.attachmentId }] } });
  await work.markResultSurfacePersisted(writer.runId);
  return { attachments, runs, work, writer, result };
}

test('실제 store readback·Run link·Work surface를 결속해 기존 파일 인간 영수증을 만든다', async () => {
  const f = await fixture(); const adapter = makeArtifactPublicationProductAdapter({ attachmentStore: f.attachments,
    runLedger: f.runs, workStore: f.work });
  const publication = await adapter.materialize({ sessionId: SESSION, runId: f.writer.runId,
    attachmentId: f.result.artifact.attachmentId });
  assert.equal(publication.classification, 'existing_file'); assert.equal(publication.storage.exactReadback, true);
  const value = projectHumanArtifactReceipt(publication); assert.match(value.title, /기존 파일 그대로/u);
  assert.doesNotMatch(JSON.stringify(value), /11111111|[a-f0-9]{64}|\/workspace|attachmentId|runId/u);
});

test('outputHandle 없는 직접 register_output은 generated로 승격하지 않는다', async () => {
  const f = await fixture({ existing: false }); const adapter = makeArtifactPublicationProductAdapter({
    attachmentStore: f.attachments, runLedger: f.runs, workStore: f.work });
  const publication = await adapter.materialize({ sessionId: SESSION, runId: f.writer.runId,
    attachmentId: f.result.artifact.attachmentId });
  assert.equal(publication.classification, 'authorized_workspace_output');
});

test('runtime 검증 원본은 Artifact 인간 영수증에서 개수만 안전하게 확인된다', async () => {
  const f = await fixture({ existing: false, sourceProvenance: { state: 'verified', purpose: '분기 취합',
    unknowns: ['8월 미수신'], sources: [{ displayName: '7월.csv', usage: '7월 매출', bytes: 10 }] } });
  const adapter = makeArtifactPublicationProductAdapter({ attachmentStore: f.attachments, runLedger: f.runs, workStore: f.work });
  const publication = await adapter.materialize({ sessionId: SESSION, runId: f.writer.runId,
    attachmentId: f.result.artifact.attachmentId });
  assert.equal(publication.sourceProvenance.sourceCount, 1);
  assert.match(projectHumanArtifactReceipt(publication).confirmed.join(' '), /원본 1개.*다시 확인/u);
  assert.doesNotMatch(JSON.stringify(projectHumanArtifactReceipt(publication)), /7월\.csv|8월 미수신/u);
});

test('schema 문자열이나 plain store clone으로 사람용 완료 문구를 만들 수 없다', () => {
  assert.throws(() => projectHumanArtifactReceipt({ schema: 't5.artifact-publication.v1', artifact: {
    name: '/Users/private/secret' }, publication: { delivery: 'succeeded' } }), /runtime-materialized/u);
  assert.throws(() => makeArtifactPublicationProductAdapter({ attachmentStore: {}, runLedger: {}, workStore: {} }),
    /canonical artifact stores/u);
});

test('materialized receipt nested state는 바꿀 수 없고 Work identity mismatch는 거부한다', async () => {
  const f = await fixture(); const adapter = makeArtifactPublicationProductAdapter({ attachmentStore: f.attachments,
    runLedger: f.runs, workStore: f.work });
  const publication = await adapter.materialize({ sessionId: SESSION, runId: f.writer.runId,
    attachmentId: f.result.artifact.attachmentId });
  assert.equal(Object.isFrozen(publication.artifact), true);
  assert.throws(() => { publication.artifact.name = '/Users/private/secret'; }, /read only|Cannot assign/u);
  const state = await f.work.read(); const result = state.results.find((item) => item.runId === f.writer.runId);
  result.workId = 'foreign';
  f.work.read = async () => state;
  await assert.rejects(() => adapter.materialize({ sessionId: SESSION, runId: f.writer.runId,
    attachmentId: f.result.artifact.attachmentId }), /Work result identity mismatch/u);
});

test('실제 readback 파일이 바뀌면 verified·delivered로 승격하지 않는다', async () => {
  const f = await fixture(); await writeFile(f.result.artifact.storedPath, 'changed');
  const adapter = makeArtifactPublicationProductAdapter({ attachmentStore: f.attachments,
    runLedger: f.runs, workStore: f.work });
  const publication = await adapter.materialize({ sessionId: SESSION, runId: f.writer.runId,
    attachmentId: f.result.artifact.attachmentId });
  assert.equal(publication.storage.exactReadback, false); assert.equal(publication.state, 'unknown');
});

test('managed stored object가 same-byte symlink로 바뀌어도 readback으로 인정하지 않는다', async () => {
  const f = await fixture(); const outside = `${f.result.artifact.storedPath}.outside`;
  await writeFile(outside, 'exact-bytes'); await rm(f.result.artifact.storedPath);
  await symlink(outside, f.result.artifact.storedPath);
  const adapter = makeArtifactPublicationProductAdapter({ attachmentStore: f.attachments,
    runLedger: f.runs, workStore: f.work });
  await assert.rejects(() => adapter.materialize({ sessionId: SESSION, runId: f.writer.runId,
    attachmentId: f.result.artifact.attachmentId }), /regular single-link/u);
});

test('delivery 실패는 저장 readback이 있을 때만 보존과 실패를 함께 말한다', async () => {
  const f = await fixture(); await f.work.markResultDeliveryTerminal(f.writer.runId,
    { provider: 'telegram', state: 'failed', reason: 'fixture' });
  const adapter = makeArtifactPublicationProductAdapter({ attachmentStore: f.attachments,
    runLedger: f.runs, workStore: f.work });
  const publication = await adapter.materialize({ sessionId: SESSION, runId: f.writer.runId,
    attachmentId: f.result.artifact.attachmentId });
  const value = projectHumanArtifactReceipt(publication);
  assert.equal(publication.publication.delivery, 'failed');
  assert.match(value.unknowns.join(' '), /전달에 실패.*보존/u);
  assert.doesNotMatch(value.delivery, /마쳤/u);
});

test('Work delivery가 성공해도 exact Run link가 없으면 이 파일의 전달 완료로 말하지 않는다', async () => {
  const f = await fixture(); await f.work.markResultDeliveryTerminal(f.writer.runId,
    { provider: 'console', state: 'persisted' });
  const originalGet = f.attachments.get.bind(f.attachments);
  const originalRead = f.attachments.readContent.bind(f.attachments);
  f.attachments.get = async (input) => ({ ...await originalGet(input), links: [] });
  f.attachments.readContent = async (input) => { const value = await originalRead(input);
    return { ...value, record: { ...value.record, links: [] } }; };
  const adapter = makeArtifactPublicationProductAdapter({ attachmentStore: f.attachments,
    runLedger: f.runs, workStore: f.work });
  const publication = await adapter.materialize({ sessionId: SESSION, runId: f.writer.runId,
    attachmentId: f.result.artifact.attachmentId });
  assert.equal(publication.publication.linkedToRun, false); assert.equal(publication.state, 'verified');
  assert.doesNotMatch(projectHumanArtifactReceipt(publication).delivery, /마쳤/u);
});
