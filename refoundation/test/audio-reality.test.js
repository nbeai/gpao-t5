import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeAudioDecode, makeAudioRealityProbe } from '../src/audio-reality.js';

const receipt = (overrides = {}) => ({
  schema: 't5.audio-reality.v1',
  container: { identifier: 'WAVE', evidence: 'audio_file_property' },
  durationMs: 5000,
  tracks: [{ index: 0, trackId: 1, kind: 'audio', codec: 'lpcm', sampleRate: 16000,
    channels: 1, languageTag: null }],
  audioTrackCount: 1, videoTrackCount: 0, coverage: 'complete', ...overrides,
});

test('Audio Reality는 exact regular source를 content-free native facts로 관측한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-audio-reality-')); const source = join(room, 'memo.wav');
  await writeFile(source, 'audio-bytes');
  try {
    const calls = []; const probe = makeAudioRealityProbe({ platform: 'darwin', helper: '/helper',
      runCommand: async (command, args, options) => { calls.push({ command, args, options });
        return { stdout: JSON.stringify(receipt()), stderr: '' }; } });
    const result = await probe({ filePath: source });
    assert.equal(result.state, 'observed'); assert.equal(result.audioTrackCount, 1);
    assert.equal(result.durationMs, 5000); assert.equal(result.source.bytes, 11);
    assert.match(result.source.sha256, /^[0-9a-f]{64}$/u);
    assert.deepEqual(calls[0].args, ['--inspect', await realpath(source)]);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('source digest가 다르거나 관측 중 바뀌면 stale이고 native 결과를 승격하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-audio-stale-')); const source = join(room, 'memo.wav');
  await writeFile(source, 'before');
  try {
    let calls = 0; const probe = makeAudioRealityProbe({ platform: 'darwin', helper: '/helper',
      runCommand: async () => { calls += 1; await writeFile(source, 'after!');
        return { stdout: JSON.stringify(receipt()), stderr: '' }; } });
    const rejected = await probe({ filePath: source, expectedSha256: '0'.repeat(64) });
    assert.equal(rejected.state, 'stale'); assert.equal(calls, 0);
    const changed = await probe({ filePath: source });
    assert.equal(changed.state, 'stale'); assert.equal(changed.reason, 'audio_source_changed_during_observation');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('helper 부재·malformed receipt·track count 위조는 unavailable로 닫힌다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-audio-invalid-')); const source = join(room, 'memo.wav');
  await writeFile(source, 'audio');
  try {
    assert.equal((await makeAudioRealityProbe({ platform: 'win32' })({ filePath: source })).reason,
      'audio_reality_not_qualified');
    const malformed = makeAudioRealityProbe({ platform: 'darwin', helper: '/helper',
      runCommand: async () => ({ stdout: JSON.stringify(receipt({ audioTrackCount: 2 })) }) });
    assert.equal((await malformed({ filePath: source })).reason, 'audio_reality_failed');
    assert.equal((await readFile(source, 'utf8')), 'audio');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('Windows observer도 같은 closed receipt를 쓰되 Media Foundation engine 사실을 보존한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-audio-windows-contract-')); const source = join(room, 'memo.mp3');
  await writeFile(source, 'audio');
  try {
    const probe = makeAudioRealityProbe({ platform: 'win32', helper: 'C:\\T5\\audio.exe',
      runCommand: async () => ({ stdout: JSON.stringify(receipt({
        container: { identifier: 'audio/mpeg', evidence: 'media_foundation_presentation' },
        tracks: [{ index: 0, trackId: 1, kind: 'audio', codec: '0x00000055',
          sampleRate: 44100, channels: 2, languageTag: null }],
      })) }) });
    const result = await probe({ filePath: source });
    assert.equal(result.state, 'observed'); assert.equal(result.engine, 'windows-media-foundation');
    assert.equal(result.container.evidence, 'media_foundation_presentation');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('macOS decode는 exact audio track을 16k mono WAV scratch로 만들고 source를 재검사한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-audio-decode-')); const source = join(room, 'memo.m4a');
  await writeFile(source, 'source-audio'); let sourceObservations = 0;
  try {
    const observe = async ({ filePath }) => {
      if (filePath === source) { sourceObservations += 1; return { state: 'observed',
        engine: 'macos-avfoundation-audiotoolbox', source: { sha256: 'a'.repeat(64), bytes: 12 },
        container: { identifier: 'M4A ', evidence: 'audio_file_property' }, durationMs: 5000,
        tracks: [{ index: 0, trackId: 1, kind: 'audio', codec: 'aac ', sampleRate: 48000,
          channels: 2, languageTag: null }], audioTrackCount: 1, videoTrackCount: 0,
        coverage: 'complete' }; }
      return { state: 'observed', engine: 'macos-avfoundation-audiotoolbox',
        source: { sha256: 'b'.repeat(64), bytes: 160044 },
        container: { identifier: 'WAVE', evidence: 'audio_file_property' }, durationMs: 5000,
        tracks: [{ index: 0, trackId: 1, kind: 'audio', codec: 'lpcm', sampleRate: 16000,
          channels: 1, languageTag: null }], audioTrackCount: 1, videoTrackCount: 0,
        coverage: 'complete' };
    };
    const calls = []; const decode = makeAudioDecode({ observe, platform: 'darwin',
      runCommand: async (command, args) => { calls.push({ command, args });
        await writeFile(args[args.indexOf('-o') + 1], Buffer.alloc(160044)); return { stdout: '', stderr: '' }; } });
    const result = await decode({ filePath: source, scratchRoot: room });
    assert.equal(result.state, 'decoded'); assert.equal(sourceObservations, 2);
    assert.equal(result.pcm.sampleRate, 16000); assert.equal(result.pcm.channels, 1);
    assert.equal(result.pcm.coverage, 'complete'); assert.equal(result.selectedTrack.index, 0);
    assert.deepEqual(calls[0].args.slice(3), ['--read-track', '0', '-f', 'WAVE', '-d',
      'LEI16@16000', '-c', '1', '--no-filler']);
    await rm(result.cleanup.directory, { recursive: true, force: true });
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('audio track 0개와 multiple track 미선택은 converter 실행 전에 닫힌다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-audio-decode-admission-')); let calls = 0;
  const base = { state: 'observed', source: { sha256: 'a'.repeat(64), bytes: 1 },
    container: { identifier: null, evidence: 'unavailable' }, durationMs: 1000,
    videoTrackCount: 1, coverage: 'complete' };
  try {
    const noAudio = makeAudioDecode({ platform: 'darwin', observe: async () => ({ ...base,
      tracks: [{ index: 0, trackId: 1, kind: 'video' }], audioTrackCount: 0 }),
    runCommand: async () => { calls += 1; } });
    assert.equal((await noAudio({ filePath: 'video.mp4', scratchRoot: room })).reason,
      'audio_track_not_present');
    const multiple = makeAudioDecode({ platform: 'darwin', observe: async () => ({ ...base,
      videoTrackCount: 0, tracks: [{ index: 0, trackId: 1, kind: 'audio' },
        { index: 1, trackId: 2, kind: 'audio' }], audioTrackCount: 2 }),
    runCommand: async () => { calls += 1; } });
    assert.equal((await multiple({ filePath: 'multi.m4a', scratchRoot: room })).state,
      'selection_required');
    assert.equal(calls, 0);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('Windows decode adapter는 Media Foundation helper에 exact source·output·track만 전달한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-audio-windows-decode-')); const source = join(room, 'memo.mp3');
  await writeFile(source, 'source'); let sourceReads = 0;
  try {
    const observe = async ({ filePath }) => {
      if (filePath === source) { sourceReads += 1; return { state: 'observed',
        engine: 'windows-media-foundation', source: { sha256: 'a'.repeat(64), bytes: 6 },
        container: { identifier: 'audio/mpeg', evidence: 'media_foundation_presentation' },
        durationMs: 1000, tracks: [{ index: 2, trackId: 3, kind: 'audio', codec: '0x00000055',
          sampleRate: 44100, channels: 2, languageTag: null }], audioTrackCount: 1,
        videoTrackCount: 0, coverage: 'complete' }; }
      return { state: 'observed', engine: 'windows-media-foundation',
        source: { sha256: 'b'.repeat(64), bytes: 32044 },
        container: { identifier: 'audio/wav', evidence: 'media_foundation_presentation' },
        durationMs: 1000, tracks: [{ index: 0, trackId: 1, kind: 'audio', codec: 'PCM ',
          sampleRate: 16000, channels: 1, languageTag: null }], audioTrackCount: 1,
        videoTrackCount: 0, coverage: 'complete' };
    };
    const calls = []; const decode = makeAudioDecode({ observe, platform: 'win32',
      converter: 'C:\\T5\\t5-windows-audio-reality.exe', runCommand: async (command, args) => {
        calls.push({ command, args }); await writeFile(args[2], Buffer.alloc(32044)); return { stdout: '{}', stderr: '' };
      } });
    const result = await decode({ filePath: source, scratchRoot: room, trackIndex: 2 });
    assert.equal(result.state, 'decoded'); assert.equal(sourceReads, 2);
    assert.equal(calls[0].command, 'C:\\T5\\t5-windows-audio-reality.exe');
    assert.equal(calls[0].args[0], '--decode'); assert.equal(calls[0].args[1], source);
    assert.equal(calls[0].args[3], '2');
    await rm(result.cleanup.directory, { recursive: true, force: true });
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('macOS audio+video는 avconvert로 audio-only를 만든 뒤 afconvert하고 다중 audio는 차단한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-audio-video-decode-')); const source = join(room, 'video.mp4');
  await writeFile(source, 'video'); const calls = [];
  const base = { state: 'observed', engine: 'macos-avfoundation-audiotoolbox',
    source: { sha256: 'a'.repeat(64), bytes: 5 }, container: { identifier: 'mp4f', evidence: 'audio_file_property' },
    durationMs: 1000, tracks: [{ index: 0, trackId: 1, kind: 'video', codec: 'avc1' },
      { index: 1, trackId: 2, kind: 'audio', codec: 'aac ', sampleRate: 48000, channels: 2 }],
    audioTrackCount: 1, videoTrackCount: 1, coverage: 'complete' };
  try { const observe = async ({ filePath }) => filePath === source ? base : { ...base,
    source: { sha256: 'b'.repeat(64), bytes: 32044 }, container: { identifier: 'WAVE', evidence: 'audio_file_property' },
    durationMs: 1000, tracks: [{ index: 0, trackId: 1, kind: 'audio', codec: 'lpcm', sampleRate: 16000, channels: 1 }],
    audioTrackCount: 1, videoTrackCount: 0 };
    const decode = makeAudioDecode({ observe, platform: 'darwin', runCommand: async (command, args) => {
      calls.push({ command, args }); const output = args.includes('--output') ? args[args.indexOf('--output') + 1]
        : args[args.indexOf('-o') + 1]; await writeFile(output, Buffer.alloc(32044)); return { stdout: '', stderr: '' }; } });
    const result = await decode({ filePath: source, scratchRoot: room, trackIndex: 1 });
    assert.equal(result.state, 'decoded'); assert.equal(calls[0].command, '/usr/bin/avconvert');
    assert.equal(calls[1].command, '/usr/bin/afconvert'); assert.equal(calls[1].args.includes('--read-track'), false);
    await rm(result.cleanup.directory, { recursive: true, force: true });
  } finally { await rm(room, { recursive: true, force: true }); }
});
