import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';

async function waveData(path) {
  const handle = await open(path, 'r');
  try {
    const header = Buffer.alloc(1024 * 1024); const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead < 44 || header.toString('ascii', 0, 4) !== 'RIFF'
      || header.toString('ascii', 8, 12) !== 'WAVE') throw new Error('decoded PCM is not WAVE');
    let offset = 12; let format = null; let data = null;
    while (offset + 8 <= bytesRead) {
      const kind = header.toString('ascii', offset, offset + 4); const size = header.readUInt32LE(offset + 4);
      const body = offset + 8; if (body + size > bytesRead && kind !== 'data') break;
      if (kind === 'fmt ' && size >= 16) format = { encoding: header.readUInt16LE(body),
        channels: header.readUInt16LE(body + 2), sampleRate: header.readUInt32LE(body + 4),
        bits: header.readUInt16LE(body + 14) };
      if (kind === 'data') { data = { offset: body, bytes: size }; break; }
      offset = body + size + (size % 2);
    }
    if (!format || !data || format.encoding !== 1 || format.channels !== 1
      || format.sampleRate !== 16000 || format.bits !== 16 || data.bytes % 2 !== 0) {
      throw new Error('decoded PCM format is invalid');
    }
    return { ...data, ...format };
  } finally { await handle.close(); }
}

async function signalFacts(path, data) {
  let peak = 0; let sumSquares = 0; let samples = 0; let carry = null;
  for await (const chunk of createReadStream(path, { start: data.offset, end: data.offset + data.bytes - 1 })) {
    const bytes = carry == null ? chunk : Buffer.concat([Buffer.from([carry]), chunk]);
    const limit = bytes.length - (bytes.length % 2);
    for (let offset = 0; offset < limit; offset += 2) {
      const sample = bytes.readInt16LE(offset); const absolute = Math.abs(sample);
      if (absolute > peak) peak = absolute; const normalized = sample / 32768;
      sumSquares += normalized * normalized; samples += 1;
    }
    carry = limit < bytes.length ? bytes[bytes.length - 1] : null;
  }
  if (carry != null || samples * 2 !== data.bytes) throw new Error('decoded PCM length changed');
  return { samples, peak, rms: samples ? Math.sqrt(sumSquares / samples) : 0,
    digitalSilence: peak === 0, durationMs: samples / data.sampleRate * 1000 };
}

function segmentFacts(transcription, durationMs, toleranceMs) {
  const segments = []; let priorEnd = 0; let overlapCount = 0; let invalidCount = 0;
  for (let index = 0; index < transcription.length; index += 1) {
    const item = transcription[index]; const from = Number(item?.offsets?.from); const to = Number(item?.offsets?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from
      || to > durationMs + toleranceMs) invalidCount += 1;
    if (from < priorEnd - toleranceMs) overlapCount += 1;
    priorEnd = Math.max(priorEnd, to);
    segments.push({ index, fromMs: from, toMs: to, textChars: String(item?.text ?? '').length });
  }
  return { segments, invalidCount, overlapCount, lastEndMs: priorEnd };
}

export async function verifyTranscriptCoverage({
  pcmPath, sourceDurationMs, decodedDurationMs, transcript, toleranceMs = 100,
} = {}) {
  if (!pcmPath || !Number.isFinite(sourceDurationMs) || !Number.isFinite(decodedDurationMs)
    || !Array.isArray(transcript?.transcription)) throw new TypeError('transcript coverage inputs are required');
  const data = await waveData(pcmPath); const signal = await signalFacts(pcmPath, data);
  const durationConsistent = Math.abs(signal.durationMs - decodedDurationMs) <= toleranceMs
    && Math.abs(decodedDurationMs - sourceDurationMs) <= toleranceMs;
  const facts = segmentFacts(transcript.transcription, sourceDurationMs, toleranceMs);
  const nonemptySegments = transcript.transcription.filter((item) => String(item?.text ?? '').trim()).length;
  const silenceHallucination = signal.digitalSilence && nonemptySegments > 0;
  const missingSpeechTranscript = !signal.digitalSilence && nonemptySegments === 0;
  const verified = durationConsistent && facts.invalidCount === 0 && facts.overlapCount === 0
    && !silenceHallucination && !missingSpeechTranscript;
  return { state: verified ? 'verified' : 'rejected', verified,
    sourceDurationMs, decodedDurationMs, processedIntervals: [{ fromMs: 0, toMs: decodedDurationMs }],
    unknownIntervals: [], signal, segments: facts.segments,
    defects: { durationMismatch: !durationConsistent, invalidTimestampCount: facts.invalidCount,
      overlapCount: facts.overlapCount, silenceHallucination, missingSpeechTranscript } };
}
