import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { strToU8, zipSync } from 'fflate';

import { AttachmentStore, detectAttachmentType } from '../src/attachment-store.js';

const SESSION_A = '11111111-1111-4111-8111-111111111111';
const SESSION_B = '22222222-2222-4222-8222-222222222222';
const RUN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function png(width = 3, height = 2) {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

test('첨부 수신은 이름을 경로로 쓰지 않고 magic MIME·bytes·hash·0600 원본을 남긴다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-attachments-'));
  const store = new AttachmentStore(join(room, 'attachments'));
  const record = await store.receive({
    sessionId: SESSION_A,
    originalName: '../../고객 사진.txt',
    declaredMime: 'text/plain',
    bytes: png(7, 5),
  });
  assert.equal(record.originalName, '고객 사진.txt');
  assert.equal(record.mimeType, 'image/png');
  assert.equal(record.kind, 'image');
  assert.equal(record.bytes, 24);
  assert.match(record.sha256, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(record.storedPath, /고객 사진|\.\.\//);
  assert.equal((await lstat(record.storedPath)).mode & 0o777, 0o600);
  assert.deepEqual(await readFile(record.storedPath), png(7, 5));
});

test('같은 bytes는 content-addressed object를 공유하지만 Attachment identity와 Session 권한은 분리된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-attachment-dedupe-'));
  const store = new AttachmentStore(join(room, 'attachments'));
  const one = await store.receive({ sessionId: SESSION_A, originalName: 'one.pdf', bytes: Buffer.from('%PDF-1.4\none') });
  const two = await store.receive({ sessionId: SESSION_A, originalName: 'two.pdf', bytes: Buffer.from('%PDF-1.4\none') });
  assert.notEqual(one.attachmentId, two.attachmentId);
  assert.equal(one.storedPath, two.storedPath);
  await assert.rejects(() => store.get({ sessionId: SESSION_B, attachmentId: one.attachmentId }), /not found/i);
  assert.equal((await store.list({ sessionId: SESSION_A })).length, 2);
});

test('기존 absolute storedPath ledger도 현재 Attachment root의 portable object identity로 재결속한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-attachment-portable-')); const sourceRoot = join(room, 'source');
  const destinationRoot = join(room, 'destination'); const source = new AttachmentStore(sourceRoot);
  try {
    const record = await source.receive({ sessionId: SESSION_A, originalName: 'portable.txt', bytes: Buffer.from('portable') });
    const ledger = join(sourceRoot, 'ledger.jsonl'); const events = (await readFile(ledger, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
    const persisted = events.find((event) => event.payload?.record)?.payload.record;
    persisted.storedPath = record.storedPath; delete persisted.objectRelativePath;
    await writeFile(ledger, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
    await rename(sourceRoot, destinationRoot);
    const reopened = await new AttachmentStore(destinationRoot).readContent({ sessionId: SESSION_A,
      attachmentId: record.attachmentId });
    assert.equal(reopened.bytes.toString('utf8'), 'portable');
    assert.equal(reopened.record.storedPath.startsWith(destinationRoot), true);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('첨부는 Message·Run에 append-only로 연결되고 재시작 뒤 복원된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-attachment-link-'));
  const directory = join(room, 'attachments');
  const first = new AttachmentStore(directory);
  const record = await first.receive({ sessionId: SESSION_A, originalName: 'data.txt', bytes: Buffer.from('hello') });
  await first.link({
    sessionId: SESSION_A, attachmentIds: [record.attachmentId],
    messageId: 'run-1:user', runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  const restored = await new AttachmentStore(directory).get({ sessionId: SESSION_A, attachmentId: record.attachmentId });
  assert.deepEqual(restored.links, [{
    messageId: 'run-1:user', runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  }]);
});

test('browser download artifact는 원래 파일명의 managed upload copy로 재료화되고 hash를 유지한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-attachment-browser-upload-'));
  const store = new AttachmentStore(join(room, 'attachments')); const bytes = Buffer.from('%PDF-1.7\nroundtrip');
  const record = await store.receive({
    sessionId: SESSION_A, originalName: 'settlement-2026-08.pdf', bytes,
    direction: 'input', sourcePath: join(room, 'browser-downloads', 'settlement-2026-08.pdf'),
  });
  await store.link({
    sessionId: SESSION_A, attachmentIds: [record.attachmentId],
    messageId: 'run-download:artifact', runId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  });
  const prepared = await store.prepareForUpload({ sessionId: SESSION_A, attachmentId: record.attachmentId });
  assert.equal(prepared.path.split('/').at(-1), 'settlement-2026-08.pdf');
  assert.equal(prepared.sha256, record.sha256); assert.deepEqual(await readFile(prepared.path), bytes);
  const repeated = await new AttachmentStore(join(room, 'attachments')).prepareForUpload({
    sessionId: SESSION_A, attachmentId: record.attachmentId,
  });
  assert.deepEqual(repeated, prepared);
});

test('파일 상한과 Session 누적 상한은 partial object와 거짓 record를 남기지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-attachment-limit-'));
  const store = new AttachmentStore(join(room, 'attachments'), { maxFileBytes: 8, maxSessionBytes: 10 });
  await assert.rejects(() => store.receive({
    sessionId: SESSION_A, originalName: 'too-big.bin', bytes: Buffer.alloc(9),
  }), /file size limit/i);
  await store.receive({ sessionId: SESSION_A, originalName: 'first.bin', bytes: Buffer.alloc(6) });
  await assert.rejects(() => store.receive({
    sessionId: SESSION_A, originalName: 'second.bin', bytes: Buffer.alloc(5),
  }), /session attachment limit/i);
  assert.equal((await store.list({ sessionId: SESSION_A })).length, 1);
});

test('보내기 전 첨부 취소는 identity를 폐기하고 이미 Message에 연결된 첨부는 지우지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-attachment-discard-'));
  const store = new AttachmentStore(join(room, 'attachments'));
  const staged = await store.receive({ sessionId: SESSION_A, originalName: 'staged.txt', bytes: Buffer.from('staged') });
  assert.equal((await store.discard({ sessionId: SESSION_A, attachmentId: staged.attachmentId })).discarded, true);
  assert.equal((await store.list({ sessionId: SESSION_A })).length, 0);

  const linked = await store.receive({ sessionId: SESSION_A, originalName: 'linked.txt', bytes: Buffer.from('linked') });
  await store.link({
    sessionId: SESSION_A, attachmentIds: [linked.attachmentId],
    messageId: 'run-2:user', runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  });
  await assert.rejects(() => store.discard({ sessionId: SESSION_A, attachmentId: linked.attachmentId }), /already linked/i);
});

test('생성 결과 등록은 workspace 안 regular file만 복사하고 다운로드 identity를 만든다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-artifact-output-'));
  const workspace = join(room, 'workspace');
  await mkdir(workspace);
  const resultPath = join(workspace, 'result.xlsx');
  await writeFile(resultPath, Buffer.from('PK\x03\x04fake-xlsx'));
  const store = new AttachmentStore(join(room, 'attachments'));
  const output = await store.registerOutput({
    sessionId: SESSION_A, workspace, filePath: resultPath,
  });
  assert.equal(output.direction, 'output');
  assert.equal(output.originalName, 'result.xlsx');
  assert.equal(output.sourcePath, await realpath(resultPath));
  assert.match(output.downloadUrl, new RegExp(output.attachmentId));

  const outside = join(room, 'outside.txt');
  await writeFile(outside, 'outside');
  await assert.rejects(() => store.registerOutput({
    sessionId: SESSION_A, workspace, filePath: outside,
  }), /outside workspace/i);
  const linked = join(workspace, 'linked.txt');
  await symlink(outside, linked);
  await assert.rejects(() => store.registerOutput({
    sessionId: SESSION_A, workspace, filePath: linked,
  }), /symbolic link/i);
});

test('생성 관측 output handle은 재시작 뒤 exact SHA로 등록되고 다른 Session·변경 파일은 거부된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-output-provenance-'));
  const workspace = join(room, 'workspace'); await mkdir(workspace);
  const file = join(workspace, 'result.txt'); await writeFile(file, 'PRODUCED-1');
  const directory = join(room, 'attachments');
  const first = new AttachmentStore(directory);
  const produced = await first.recordProducedOutput({
    sessionId: SESSION_A, workspace, runId: RUN_A,
    toolCallId: 'exec-1', filePath: file,
  });
  assert.match(produced.outputHandle, /^[0-9a-f-]{36}$/i);
  assert.equal((await first.pendingProducedOutputs({ sessionId: SESSION_A })).length, 1);
  await assert.rejects(() => first.producedOutput({
    sessionId: SESSION_B, outputHandle: produced.outputHandle,
  }), /not found/i);

  const restored = new AttachmentStore(directory);
  const exact = await restored.producedOutput({
    sessionId: SESSION_A, outputHandle: produced.outputHandle,
  });
  assert.equal(exact.sha256, produced.sha256);
  await writeFile(file, 'CHANGED');
  await assert.rejects(() => restored.registerOutput({
    sessionId: SESSION_A, workspace, filePath: exact.sourcePath,
    expectedSha256: exact.sha256,
  }), /identity changed/i);

  await writeFile(file, 'PRODUCED-1');
  const artifact = await restored.registerOutput({
    sessionId: SESSION_A, workspace, filePath: exact.sourcePath,
    expectedSha256: exact.sha256,
  });
  await restored.markProducedOutputRegistered({
    sessionId: SESSION_A, outputHandle: produced.outputHandle,
    attachmentId: artifact.attachmentId, registeringRunId: RUN_B,
  });
  assert.equal((await restored.pendingProducedOutputs({ sessionId: SESSION_A })).length, 0);
  assert.equal((await restored.producedOutput({
    sessionId: SESSION_A, outputHandle: produced.outputHandle,
  })).attachmentId, artifact.attachmentId);
});

test('HTML·SVG·정적 웹 꾸러미는 다운로드 파일이 아니라 관리 preview 결과물로도 식별된다', () => {
  assert.deepEqual(detectAttachmentType(Buffer.from('<!doctype html><h1>T5</h1>'), 'site.html'), {
    mimeType: 'text/html', kind: 'web', extension: '.html',
  });
  assert.deepEqual(detectAttachmentType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'mark.svg'), {
    mimeType: 'image/svg+xml', kind: 'vector', extension: '.svg',
  });
  const bundle = Buffer.from(zipSync({
    'index.html': strToU8('<!doctype html><script src="assets/app.js"></script>'),
    'assets/app.js': strToU8('document.body.dataset.ready="yes"'),
  }));
  assert.equal(detectAttachmentType(bundle, 'site.zip').kind, 'web_app');
});

test('Telegram voice의 OggS bytes는 binary가 아니라 audio identity다', () => {
  assert.deepEqual(detectAttachmentType(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(32)]),
    'telegram-voice.ogg'), { mimeType: 'audio/ogg', kind: 'audio', extension: '.ogg' });
});

test('결과 수정은 이전 attachmentId를 명시한 경우에만 같은 family의 다음 버전이 된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-artifact-version-'));
  const workspace = join(room, 'workspace'); await mkdir(workspace);
  const file = join(workspace, 'site.html');
  await writeFile(file, '<h1>첫 시안</h1>');
  const store = new AttachmentStore(join(room, 'attachments'));
  const first = await store.registerOutput({ sessionId: SESSION_A, workspace, filePath: file });
  await writeFile(file, '<h1>수정 시안</h1>');
  const second = await store.registerOutput({
    sessionId: SESSION_A, workspace, filePath: file, revisesAttachmentId: first.attachmentId,
  });
  assert.equal(first.artifactVersion, 1);
  assert.equal(second.artifactVersion, 2);
  assert.equal(second.artifactFamilyId, first.artifactFamilyId);
  assert.deepEqual((await store.versions({ sessionId: SESSION_A, attachmentId: second.attachmentId }))
    .map((item) => item.artifactVersion), [1, 2]);
  await assert.rejects(() => store.registerOutput({
    sessionId: SESSION_B, workspace, filePath: file, revisesAttachmentId: first.attachmentId,
  }), /not found/i);
});
