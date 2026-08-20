import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AttachmentStore } from '../src/attachment-store.js';
import { makeGoogleDriveTool } from '../src/google-drive-tool.js';

const SESSION = '11111111-1111-4111-8111-111111111111';
const effect = (kind) => ({
  kind, summary: 'Google Drive 작업', targets: ['google-drive'], reversible: true,
  backupAvailable: true, recipientNew: false, approvalToken: null,
});

test('Google Drive 도구는 검색·메타데이터를 읽고 다운로드를 실제 결과 첨부로 만든다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-google-tool-'));
  const attachments = new AttachmentStore(join(room, 'attachments'));
  const calls = [];
  const api = {
    async search(args) { calls.push(['search', args]); return { files: [{ id: 'f1', name: '보고서.pdf' }], nextPageToken: null, incompleteSearch: false }; },
    async metadata(id) { calls.push(['metadata', id]); return { id, name: '보고서.pdf', mimeType: 'application/pdf' }; },
    async download(args) {
      calls.push(['download', args]);
      return {
        file: { id: args.fileId, name: '보고서.pdf', mimeType: 'application/pdf' },
        originalName: '보고서.pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-T5'),
      };
    },
  };
  const tool = makeGoogleDriveTool({
    api, attachments, sessionId: SESSION,
    authorizeEffect: async () => ({ allowed: true }), authorizeUploadPath: () => true,
  });
  try {
    const found = await tool.execute({
      action: 'search', query: '보고서', fileId: null, pageSize: 20, pageToken: null,
      exportMime: null, name: null, parentId: null, filePath: null, mimeType: null, effect: null,
    });
    assert.equal(found.state, 'found');
    const metadata = await tool.execute({
      action: 'metadata', query: null, fileId: 'f1', pageSize: null, pageToken: null,
      exportMime: null, name: null, parentId: null, filePath: null, mimeType: null, effect: null,
    });
    assert.equal(metadata.file.id, 'f1');
    const downloaded = await tool.execute({
      action: 'download', query: null, fileId: 'f1', pageSize: null, pageToken: null,
      exportMime: null, name: null, parentId: null, filePath: null, mimeType: null,
      effect: effect('local_change'),
    });
    assert.equal(downloaded.state, 'downloaded');
    assert.equal(downloaded.artifact.direction, 'output');
    assert.equal(downloaded.artifact.originalName, '보고서.pdf');
    assert.equal((await attachments.readContent({
      sessionId: SESSION, attachmentId: downloaded.artifact.attachmentId,
    })).bytes.toString(), '%PDF-T5');
    assert.deepEqual(calls.map((entry) => entry[0]), ['search', 'metadata', 'download']);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('업로드·교체는 현재 사용자 요청의 exact file만 hash 결속하고 외부 변경 효과를 요구한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-google-tool-upload-'));
  const file = join(room, '결과.txt'); await writeFile(file, 'hello-drive');
  const calls = [];
  const api = {
    async search() { return { files: [] }; },
    async upload(args) { calls.push(['upload', args]); return { id: 'new-file', name: args.name, mimeType: args.mimeType }; },
    async replace(args) { calls.push(['replace', args]); return { id: args.fileId, name: '결과.txt', mimeType: args.mimeType }; },
  };
  let allowPath = false;
  const tool = makeGoogleDriveTool({
    api, attachments: new AttachmentStore(join(room, 'attachments')), sessionId: SESSION,
    authorizeUploadPath: (path) => allowPath && path === file,
    authorizeEffect: async (args) => args.effect?.kind === 'external_send'
      ? { allowed: true } : { allowed: false, outcome: 'not_executed', result: { state: 'effect_required' } },
  });
  const base = {
    query: null, fileId: null, pageSize: null, pageToken: null, exportMime: null,
    name: '결과.txt', parentId: null, filePath: file, mimeType: 'text/plain', effect: effect('external_send'),
  };
  try {
    assert.equal((await tool.preflight({ ...base, action: 'upload' })).allowed, false);
    allowPath = true;
    assert.equal((await tool.preflight({ ...base, action: 'upload' })).allowed, true);
    const uploaded = await tool.execute({ ...base, action: 'upload' });
    assert.equal(uploaded.state, 'uploaded');
    assert.match(uploaded.source.sha256, /^[0-9a-f]{64}$/u);
    assert.equal(uploaded.source.bytes, 11);
    const replaced = await tool.execute({ ...base, action: 'replace', fileId: 'existing-file' });
    assert.equal(replaced.state, 'replaced');
    assert.equal(calls[0][1].bytes.toString(), 'hello-drive');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('폴더 생성과 외부 변경은 authority preflight가 멈추면 실제 API를 부르지 않는다', async () => {
  let calls = 0;
  const tool = makeGoogleDriveTool({
    api: { async search() { return { files: [] }; }, async createFolder() { calls += 1; return {}; } },
    attachments: { receive: async () => ({}) }, sessionId: SESSION, authorizeUploadPath: () => false,
    authorizeEffect: async () => ({
      allowed: false, outcome: 'not_executed', result: { state: 'approval_required', pendingId: 'pending' },
    }),
  });
  const args = {
    action: 'create_folder', query: null, fileId: null, pageSize: null, pageToken: null,
    exportMime: null, name: '새 폴더', parentId: null, filePath: null, mimeType: null,
    effect: effect('external_change'),
  };
  const gate = await tool.preflight(args);
  assert.equal(gate.allowed, false);
  assert.equal(gate.result.state, 'approval_required');
  assert.equal(calls, 0);
});
