import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AttachmentStore } from '../src/attachment-store.js';
import { makeAuditoryTool } from '../src/auditory-tool.js';

const SESSION = '33333333-3333-4333-8333-333333333333';
const RUN = '44444444-4444-4444-8444-444444444444';
const verified = { state: 'verified_transcript', publishable: true, operationId: 'op-1',
  source: { sha256: 'a'.repeat(64), durationMs: 1000 }, coverage: { verified: true },
  transcript: { result: { language: 'ko' }, transcription: [{ text: '회의 결론', offsets: { from: 0, to: 1000 } }] } };

test('자연어 audio Hand는 exact attachment를 verified requested Artifact로 끝낸다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-auditory-tool-')); const scratch = join(room, 'scratch'); await mkdir(scratch);
  const store = new AttachmentStore(join(room, 'attachments')); const wav = Buffer.alloc(64); wav.write('RIFF'); wav.write('WAVE', 8);
  const input = await store.receive({ sessionId: SESSION, originalName: '회의.wav', bytes: wav }); let cleaned = 0;
  try { const tool = makeAuditoryTool({ attachmentStore: store, sessionId: SESSION, runId: RUN, scratchRoot: scratch,
    spine: { start: async ({ expectedSha256, requestMetadata, waitMs }) => { assert.equal(expectedSha256, input.sha256);
      assert.equal(waitMs, null);
      assert.deepEqual(requestMetadata, { form: 'srt', outputName: '회의.srt' }); return verified; },
    cleanup: async () => { cleaned += 1; return true; } } });
    const result = await tool.execute({ action: 'start', attachmentId: input.attachmentId, operationId: null,
      language: 'ko', form: 'srt', outputName: '회의.srt', cursor: null });
    assert.equal(result.state, 'verified_transcript'); assert.equal(result.artifact.originalName, '회의.srt');
    assert.equal(result.artifactForm, 'srt'); assert.equal(cleaned, 1);
    const projected = tool.projectResultForModel(result);
    assert.equal(projected.artifact.originalName, '회의.srt');
    assert.doesNotMatch(JSON.stringify(projected), /storedPath|sourcePath|sha256|downloadUrl/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('audio가 아닌 attachment와 coverage rejected result는 발행되지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-auditory-tool-reject-')); const scratch = join(room, 'scratch'); await mkdir(scratch);
  const store = new AttachmentStore(join(room, 'attachments'));
  try { const text = await store.receive({ sessionId: SESSION, originalName: 'note.txt', bytes: Buffer.from('text') });
    const tool = makeAuditoryTool({ attachmentStore: store, sessionId: SESSION, runId: RUN, scratchRoot: scratch,
      spine: { start: async () => ({ state: 'coverage_rejected', publishable: false }), cleanup: async () => true } });
    await assert.rejects(tool.execute({ action: 'start', attachmentId: text.attachmentId, operationId: null,
      language: 'auto', form: 'txt', outputName: null, cursor: null }), /not audio or video/u);
    assert.equal((await store.list({ sessionId: SESSION })).filter((item) => item.direction === 'output').length, 0);
  } finally { await rm(room, { recursive: true, force: true }); }
});
