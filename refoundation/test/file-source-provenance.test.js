import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';

import { makeAttachmentTool } from '../src/attachment-hand.js';
import { AttachmentStore } from '../src/attachment-store.js';
import { FileSourceManifestStore } from '../src/file-source-manifest-store.js';

const SESSION = '11111111-1111-4111-8111-111111111111';

async function room() {
  const root = await mkdtemp(join(tmpdir(), 't5-source-provenance-')); const workspace = join(root, 'workspace');
  await mkdir(workspace); const source = join(root, '7월매출.csv'); const output = join(workspace, '분기취합.csv');
  await writeFile(source, '월,매출\n7월,1200000\n'); await writeFile(output, '월,매출\n7월,1200000\n');
  const stat = await import('node:fs/promises').then(({ lstat }) => lstat(source));
  return { root, workspace, source, output, identity: { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs } };
}

test('검증된 원본 manifest는 결과 Artifact 등록 영수증에 결속된다', async () => {
  const app = await room();
  try {
    const manifests = new FileSourceManifestStore(join(app.root, 'state', 'source-manifests'));
    const manifest = await manifests.create({ sessionId: SESSION, purpose: '3분기 매출표 취합',
      unknowns: ['8월 자료 미수신'], sources: [{ path: app.source, displayName: '7월매출.csv',
        usage: '7월 확정 매출', identity: app.identity, columnMappings: [
          { sourceColumn: '월', outputColumn: '월' }, { sourceColumn: '매출', outputColumn: '매출' },
        ] }], standardization: { mode: 'append_rows', outputColumns: ['월', '매출'] } });
    const attachments = new AttachmentStore(join(app.root, 'attachments'));
    const tool = makeAttachmentTool({ store: attachments, sessionId: SESSION, workspace: app.workspace,
      runId: 'source-provenance-run', sourceManifestStore: manifests, authorizeOutputPath: () => true });
    const result = await tool.execute({ action: 'register_output', attachmentId: null, filePath: app.output,
      maxChars: null, maxCells: null, maxPages: null, outputName: null, resultRelativePath: null,
      expectedResultJson: null, expectedStdoutIncludes: null, operationHandle: null, outputHandle: null,
      sourceManifestId: manifest.manifestId, query: null, pageHandles: null });
    assert.equal(result.state, 'registered'); assert.equal(result.sourceProvenance.state, 'verified');
    assert.deepEqual(result.sourceReconciliation, { state: 'verified', mode: 'append_rows', rowCount: 1,
      outputColumns: ['월', '매출'] });
    assert.equal(result.sourceProvenance.sources[0].displayName, '7월매출.csv');
    assert.deepEqual(result.sourceProvenance.unknowns, ['8월 자료 미수신']);
  } finally { await rm(app.root, { recursive: true, force: true }); }
});

test('manifest 뒤 원본이 바뀌면 결과 파일이 있어도 Artifact로 등록하지 않는다', async () => {
  const app = await room();
  try {
    const manifests = new FileSourceManifestStore(join(app.root, 'state', 'source-manifests'));
    const manifest = await manifests.create({ sessionId: SESSION, purpose: '3분기 매출표 취합', sources: [{
      path: app.source, displayName: '7월매출.csv', usage: '7월 확정 매출', identity: app.identity,
    }] });
    await writeFile(app.source, '월,매출\n7월,9999999\n');
    const attachments = new AttachmentStore(join(app.root, 'attachments'));
    const tool = makeAttachmentTool({ store: attachments, sessionId: SESSION, workspace: app.workspace,
      runId: 'source-provenance-run', sourceManifestStore: manifests, authorizeOutputPath: () => true });
    await assert.rejects(tool.execute({ action: 'register_output', attachmentId: null, filePath: app.output,
      maxChars: null, maxCells: null, maxPages: null, outputName: null, resultRelativePath: null,
      expectedResultJson: null, expectedStdoutIncludes: null, operationHandle: null, outputHandle: null,
      sourceManifestId: manifest.manifestId, query: null, pageHandles: null }), /source file changed/u);
    assert.equal((await attachments.list({ sessionId: SESSION })).length, 0);
  } finally { await rm(app.root, { recursive: true, force: true }); }
});

test('표준 열이나 전체 행이 원본 매핑과 다르면 취합 Artifact로 등록하지 않는다', async () => {
  const app = await room();
  try {
    const manifests = new FileSourceManifestStore(join(app.root, 'state', 'source-manifests'));
    const manifest = await manifests.create({ sessionId: SESSION, purpose: '월별 매출 취합', sources: [{
      path: app.source, displayName: '7월매출.csv', usage: '7월 확정 매출', identity: app.identity,
      columnMappings: [{ sourceColumn: '월', outputColumn: '월' }, { sourceColumn: '매출', outputColumn: '매출' }],
    }], standardization: { mode: 'append_rows', outputColumns: ['월', '매출'] } });
    await writeFile(app.output, '월,매출\n7월,9999999\n');
    const attachments = new AttachmentStore(join(app.root, 'attachments'));
    const tool = makeAttachmentTool({ store: attachments, sessionId: SESSION, workspace: app.workspace,
      runId: 'source-provenance-run', sourceManifestStore: manifests, authorizeOutputPath: () => true });
    await assert.rejects(tool.execute({ action: 'register_output', attachmentId: null, filePath: app.output,
      maxChars: null, maxCells: null, maxPages: null, outputName: null, resultRelativePath: null,
      expectedResultJson: null, expectedStdoutIncludes: null, operationHandle: null, outputHandle: null,
      sourceManifestId: manifest.manifestId, query: null, pageHandles: null }), /does not match bound sources/u);
    assert.equal((await attachments.list({ sessionId: SESSION })).length, 0);
  } finally { await rm(app.root, { recursive: true, force: true }); }
});

test('ZIP 묶음은 source provenance를 보존하되 ZIP bytes를 CSV로 오판하지 않는다', async () => {
  const app = await room();
  try {
    const manifests = new FileSourceManifestStore(join(app.root, 'state', 'source-manifests'));
    const manifest = await manifests.create({ sessionId: SESSION, purpose: '3분기 매출 묶음', sources: [{
      path: app.source, displayName: '7월매출.csv', usage: '7월 확정 매출', identity: app.identity,
      columnMappings: [{ sourceColumn: '월', outputColumn: '월' }, { sourceColumn: '매출', outputColumn: '매출' }],
    }], standardization: { mode: 'append_rows', outputColumns: ['월', '매출'] } });
    const bundle = join(app.workspace, '분기취합.zip');
    await writeFile(bundle, zipSync({ '분기취합.csv': strToU8('월,매출\n7월,1200000\n') }));
    const attachments = new AttachmentStore(join(app.root, 'attachments'));
    const tool = makeAttachmentTool({ store: attachments, sessionId: SESSION, workspace: app.workspace,
      runId: 'source-bundle-run', sourceManifestStore: manifests, authorizeOutputPath: () => true });
    const result = await tool.execute({ action: 'register_output', attachmentId: null, filePath: bundle,
      maxChars: null, maxCells: null, maxPages: null, outputName: null, resultRelativePath: null,
      expectedResultJson: null, expectedStdoutIncludes: null, operationHandle: null, outputHandle: null,
      sourceManifestId: manifest.manifestId, query: null, pageHandles: null });
    assert.equal(result.state, 'registered'); assert.equal(result.sourceProvenance.state, 'verified');
    assert.equal(result.sourceReconciliation, undefined);
  } finally { await rm(app.root, { recursive: true, force: true }); }
});
