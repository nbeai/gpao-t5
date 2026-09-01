import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeAuditoryTranscriptionSpine } from '../src/auditory-transcription-spine.js';

const model = { assetId: 'large-v3-turbo-full', generationId: 'gen-1', path: '/model.bin', sha256: 'a'.repeat(64) };

test('managed transcription은 prepare→decode→D process→unverified transcript 한 경계로 끝난다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-auditory-spine-')); const output = join(room, 'transcript.json');
  const starts = [];
  try {
    const spine = makeAuditoryTranscriptionSpine({ helper: '/t5-whisper-host', makeId: () => 'operation-1',
      capabilityService: { prepare: async () => ({ state: 'ready', model }) },
      decodeAudio: async () => ({ state: 'decoded', input: { source: { sha256: 'b'.repeat(64) }, durationMs: 5000 },
        selectedTrack: { index: 0 }, pcm: { path: join(room, 'audio.wav'), sha256: 'c'.repeat(64),
          durationMs: 5000, sampleRate: 16000, channels: 1 }, cleanup: { directory: room } }),
      processRegistry: { start: async (input) => { starts.push(input); await writeFile(output, JSON.stringify({
        model: { type: 'large' }, transcription: [{ text: '안녕하세요', offsets: { from: 0, to: 5000 } }],
      })); return { processId: 'process-1', state: 'completed', stdout: '', stderr: '', cursor: {}, exitCode: 0, durationMs: 10 }; } } });
    const result = await spine.start({ ownerId: 'session-1', filePath: 'input.wav', scratchRoot: room, language: 'ko' });
    assert.equal(result.state, 'transcribed_unverified'); assert.equal(result.publishable, false);
    assert.equal(starts[0].metadata.capability, 'auditory_transcription');
    assert.deepEqual(starts[0].args.slice(-7), ['ko', '-ojf', '-otxt', '-osrt', '-of', join(room, 'transcript'), '--print-progress']);
    assert.equal(await spine.cleanup({ ownerId: 'session-1', operationId: 'operation-1' }), true);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('running poll·Stop은 exact owner만 가능하고 stopped result는 publishable이 아니다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-auditory-stop-')); let stopped = 0;
  try {
    const registry = { start: async () => ({ processId: 'process-2', state: 'running', stdout: '', stderr: '', cursor: { stdout: 0, stderr: 0 }, exitCode: null, durationMs: 1 }),
      poll: async () => ({ processId: 'process-2', state: 'running', stdout: 'progress', stderr: '', cursor: { stdout: 8, stderr: 0 }, exitCode: null, durationMs: 2 }),
      stop: async () => { stopped += 1; return { processId: 'process-2', state: 'stopped', stdout: '', stderr: '', cursor: {}, exitCode: -1, durationMs: 3 }; } };
    const spine = makeAuditoryTranscriptionSpine({ helper: '/helper', makeId: () => 'operation-2', processRegistry: registry,
      capabilityService: { prepare: async () => ({ state: 'ready', model }) },
      decodeAudio: async () => ({ state: 'decoded', input: { source: { sha256: 'b'.repeat(64) }, durationMs: 5000 },
        selectedTrack: { index: 0 }, pcm: { path: join(room, 'audio.wav'), sha256: 'c'.repeat(64), durationMs: 5000,
          sampleRate: 16000, channels: 1 }, cleanup: { directory: room } }) });
    assert.equal((await spine.start({ ownerId: 'session-2', filePath: 'a', scratchRoot: room })).state, 'running');
    await assert.rejects(spine.poll({ ownerId: 'foreign', operationId: 'operation-2' }), /not found/u);
    assert.equal((await spine.poll({ ownerId: 'session-2', operationId: 'operation-2' })).state, 'running');
    const result = await spine.stop({ ownerId: 'session-2', operationId: 'operation-2' });
    assert.equal(result.state, 'stopped'); assert.equal(result.publishable, false); assert.equal(stopped, 1);
  } finally { await rm(room, { recursive: true, force: true }); }
});
