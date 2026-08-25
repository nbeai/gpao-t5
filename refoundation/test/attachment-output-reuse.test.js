import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeAttachmentTool } from '../src/attachment-hand.js';
import { AttachmentStore } from '../src/attachment-store.js';

test('과거 exact output artifact는 복사·변환 없이 현재 Run delivery에 재결속된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-output-reuse-'));
  const workspace = join(room, 'workspace'); await mkdir(workspace);
  const filePath = join(workspace, '소스 및 드레싱.xls');
  const bytes = Buffer.from('exact-existing-output-bytes'); await writeFile(filePath, bytes);
  const store = new AttachmentStore(join(room, 'attachments'));
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const previous = await store.registerOutput({ sessionId, workspace, filePath });
  const tool = makeAttachmentTool({ store, sessionId, workspace, runId: 'run-current' });
  const reused = await tool.execute({
    action: 'register_output', attachmentId: previous.attachmentId,
    filePath: null, maxChars: null, maxCells: null, maxPages: null,
    outputName: null, resultRelativePath: null, expectedResultJson: null,
    expectedStdoutIncludes: null, operationHandle: null, outputHandle: null,
  });
  assert.equal(reused.state, 'registered'); assert.equal(reused.reused, true);
  assert.equal(reused.artifact.attachmentId, previous.attachmentId);
  assert.equal(reused.artifact.sha256, previous.sha256);
  assert.equal(reused.artifact.bytes, bytes.length);
  const content = await store.readContent({ sessionId, attachmentId: previous.attachmentId });
  assert.deepEqual(content.bytes, bytes);
  assert.ok((await store.get({ sessionId, attachmentId: previous.attachmentId })).links
    .some((link) => link.runId === 'run-current'));
});

test('input attachment는 output으로 가장해 재발신할 수 없다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-input-reuse-block-'));
  const workspace = join(room, 'workspace'); await mkdir(workspace);
  const store = new AttachmentStore(join(room, 'attachments'));
  const sessionId = '22222222-2222-4222-8222-222222222222';
  const input = await store.receive({ sessionId, originalName: 'input.bin',
    bytes: Buffer.from('input'), direction: 'input' });
  const tool = makeAttachmentTool({ store, sessionId, workspace, runId: 'run-current' });
  await assert.rejects(() => tool.execute({
    action: 'register_output', attachmentId: input.attachmentId,
    filePath: null, maxChars: null, maxCells: null, maxPages: null,
    outputName: null, resultRelativePath: null, expectedResultJson: null,
    expectedStdoutIncludes: null, operationHandle: null, outputHandle: null,
  }), /only an existing output artifact/u);
});
