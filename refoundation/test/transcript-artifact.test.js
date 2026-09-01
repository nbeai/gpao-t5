import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AttachmentStore } from '../src/attachment-store.js';
import { makeTranscriptArtifactAdapter } from '../src/transcript-artifact.js';

const SESSION = '33333333-3333-4333-8333-333333333333';
const RUN = '44444444-4444-4444-8444-444444444444';
const verified = { state: 'verified_transcript', publishable: true, operationId: 'operation-1',
  source: { sha256: 'a'.repeat(64), durationMs: 2500 }, coverage: { verified: true },
  transcript: { transcription: [{ text: '첫 문장', offsets: { from: 0, to: 1000 } },
    { text: '둘째 문장', offsets: { from: 1200, to: 2500 } }] } };

test('검증된 transcript는 요청한 TXT·SRT·VTT 한 형식만 기존 Artifact로 발행한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-transcript-artifact-')); const store = new AttachmentStore(room);
  try { const adapter = makeTranscriptArtifactAdapter({ attachmentStore: store });
    for (const [form, marker] of [['txt', '첫 문장\n둘째 문장'], ['srt', '00:00:00,000 --> 00:00:01,000'],
      ['vtt', 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000']]) {
      const result = await adapter.publish({ sessionId: SESSION, runId: RUN, messageId: `message-${form}`,
        result: { ...verified, operationId: `operation-${form}` }, form });
      assert.equal(result.state, 'published'); assert.equal(result.artifact.originalName, `transcript.${form}`);
      const reopened = await store.readContent({ sessionId: SESSION, attachmentId: result.artifact.attachmentId });
      assert.match(reopened.bytes.toString('utf8'), new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.equal((await store.list({ sessionId: SESSION })).filter((item) => item.direction === 'output').length, 3);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('unverified·coverage rejected transcript와 요청하지 않은 형식은 Artifact 0이다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-transcript-reject-')); const store = new AttachmentStore(room);
  try { const adapter = makeTranscriptArtifactAdapter({ attachmentStore: store });
    await assert.rejects(adapter.publish({ sessionId: SESSION, runId: RUN, messageId: 'message',
      result: { ...verified, coverage: { verified: false } }, form: 'txt' }), /only a verified/u);
    await assert.rejects(adapter.publish({ sessionId: SESSION, runId: RUN, messageId: 'message',
      result: verified, form: 'docx' }), /output form/u);
    assert.equal((await store.list({ sessionId: SESSION })).length, 0);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('사용자 교정본은 raw transcript를 덮지 않고 같은 Artifact family의 다음 version이다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-transcript-version-')); const store = new AttachmentStore(room);
  try { const adapter = makeTranscriptArtifactAdapter({ attachmentStore: store });
    const first = await adapter.publish({ sessionId: SESSION, runId: RUN, messageId: 'm1', result: verified, form: 'txt' });
    const corrected = { ...verified, operationId: 'operation-corrected',
      transcript: { transcription: [{ text: '교정 문장', offsets: { from: 0, to: 2500 } }] } };
    const second = await adapter.publish({ sessionId: SESSION, runId: RUN, messageId: 'm2', result: corrected,
      form: 'txt', revisesAttachmentId: first.artifact.attachmentId });
    assert.equal(second.artifact.artifactFamilyId, first.artifact.artifactFamilyId);
    assert.equal(second.artifact.artifactVersion, 2); assert.equal(first.artifact.artifactVersion, 1);
  } finally { await rm(room, { recursive: true, force: true }); }
});
