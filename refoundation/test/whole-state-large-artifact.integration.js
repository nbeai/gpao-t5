import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AttachmentStore } from '../src/attachment-store.js';
import { createWholeStateBundle, restoreWholeStateBundle } from '../src/whole-state-bundle.js';
import { makeT5WholeStateRegistry, validateT5WholeStateRelationships } from '../src/t5-whole-state.js';

test('T5가 정상 수용한 80MiB Artifact는 full backup에서 제외하지 않고 cross-root로 다시 읽는다', { timeout: 120_000 }, async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-whole-large-artifact-')); const source = join(room, 'source'); await mkdir(source);
  const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await writeFile(join(source, 'console-sessions.json'), JSON.stringify({ version: 1, nextOrder: 2,
    sessions: [{ id: sessionId, title: 'large', manualTitle: false, createdAt: 1, updatedAt: 1,
      order: 1, transcript: [], pinned: false, origin: null, continuationOf: null }] }));
  const store = new AttachmentStore(join(source, 'attachments')); const bytes = Buffer.alloc(80 * 1024 * 1024, 0x7f);
  try {
    const artifact = await store.receive({ sessionId, originalName: 'accepted-80MiB.bin', bytes, direction: 'output' });
    const registry = await makeT5WholeStateRegistry(source); const bundle = join(room, 'large-artifact.t5backup');
    const receipt = await createWholeStateBundle({ registry, outputFile: bundle,
      password: 'large artifact password', stagingParent: room });
    assert.equal(receipt.excludedFiles, 0); const destination = join(room, 'destination');
    await restoreWholeStateBundle({ bundleFile: bundle, password: 'large artifact password',
      destinationStateRoot: destination, validateRelationships: validateT5WholeStateRelationships });
    await rm(source, { recursive: true, force: true });
    const reopened = await new AttachmentStore(join(destination, 'attachments')).readContent({
      sessionId, attachmentId: artifact.attachmentId });
    assert.equal(reopened.bytes.length, 80 * 1024 * 1024); assert.equal(reopened.record.sha256, artifact.sha256);
  } finally { bytes.fill(0); await rm(room, { recursive: true, force: true }); }
});
