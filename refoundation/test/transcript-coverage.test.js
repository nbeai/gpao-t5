import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { verifyTranscriptCoverage } from '../src/transcript-coverage.js';

function wav(samples) { const data = Buffer.alloc(samples.length * 2); samples.forEach((sample, index) => data.writeInt16LE(sample, index * 2));
  const output = Buffer.alloc(44 + data.length); output.write('RIFF', 0); output.writeUInt32LE(36 + data.length, 4);
  output.write('WAVEfmt ', 8); output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(1, 22);
  output.writeUInt32LE(16000, 24); output.writeUInt32LE(32000, 28); output.writeUInt16LE(2, 32); output.writeUInt16LE(16, 34);
  output.write('data', 36); output.writeUInt32LE(data.length, 40); data.copy(output, 44); return output; }

test('5초 무음의 거짓 문장과 29.98초 timestamp는 coverage에서 차단된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-transcript-silence-')); const path = join(room, 'silence.wav');
  await writeFile(path, wav(Array(16000 * 5).fill(0)));
  try { const result = await verifyTranscriptCoverage({ pcmPath: path, sourceDurationMs: 5000, decodedDurationMs: 5000,
    transcript: { transcription: [{ text: '한글자막 by 한효정', offsets: { from: 0, to: 29980 } }] } });
    assert.equal(result.verified, false); assert.equal(result.defects.silenceHallucination, true);
    assert.equal(result.defects.invalidTimestampCount, 1); assert.equal(result.signal.digitalSilence, true);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('실제 신호·source 안 monotonic segment·전체 processing interval은 verified다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-transcript-speech-')); const path = join(room, 'speech.wav');
  const samples = Array.from({ length: 16000 }, (_, index) => index % 40 < 20 ? 1000 : -1000); await writeFile(path, wav(samples));
  try { const result = await verifyTranscriptCoverage({ pcmPath: path, sourceDurationMs: 1000, decodedDurationMs: 1000,
    transcript: { transcription: [{ text: '확인 문장', offsets: { from: 0, to: 900 } }] } });
    assert.equal(result.verified, true); assert.deepEqual(result.processedIntervals, [{ fromMs: 0, toMs: 1000 }]);
    assert.equal(result.signal.digitalSilence, false); assert.equal(result.defects.overlapCount, 0);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('비무음 empty transcript와 역전 overlap은 성공이 아니다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-transcript-invalid-')); const path = join(room, 'speech.wav');
  await writeFile(path, wav(Array(16000).fill(500)));
  try { const empty = await verifyTranscriptCoverage({ pcmPath: path, sourceDurationMs: 1000, decodedDurationMs: 1000,
    transcript: { transcription: [] } }); assert.equal(empty.defects.missingSpeechTranscript, true);
    const overlap = await verifyTranscriptCoverage({ pcmPath: path, sourceDurationMs: 1000, decodedDurationMs: 1000,
      transcript: { transcription: [{ text: '첫째', offsets: { from: 0, to: 700 } },
        { text: '둘째', offsets: { from: 400, to: 900 } }] } }); assert.equal(overlap.defects.overlapCount, 1);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('WAVE_FORMAT_EXTENSIBLE은 exact PCM subtype 1일 때만 16k mono로 인정한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-transcript-extensible-')); const path = join(room, 'speech.wav');
  const base = wav(Array(16000).fill(500)); const data = base.subarray(44);
  const output = Buffer.alloc(68 + data.length); output.write('RIFF'); output.writeUInt32LE(60 + data.length, 4);
  output.write('WAVEfmt ', 8); output.writeUInt32LE(40, 16); output.writeUInt16LE(0xfffe, 20);
  output.writeUInt16LE(1, 22); output.writeUInt32LE(16000, 24); output.writeUInt32LE(32000, 28);
  output.writeUInt16LE(2, 32); output.writeUInt16LE(16, 34); output.writeUInt16LE(22, 36);
  output.writeUInt16LE(16, 38); output.writeUInt32LE(4, 40); output.writeUInt32LE(1, 44);
  Buffer.from('00001000800000aa00389b71', 'hex').copy(output, 48); output.write('data', 60);
  output.writeUInt32LE(data.length, 64); data.copy(output, 68); await writeFile(path, output);
  try { const result = await verifyTranscriptCoverage({ pcmPath: path, sourceDurationMs: 1000,
    decodedDurationMs: 1000, transcript: { transcription: [{ text: '확인', offsets: { from: 0, to: 900 } }] } });
    assert.equal(result.verified, true);
  } finally { await rm(room, { recursive: true, force: true }); }
});
