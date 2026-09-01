import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_RECEIPT_BYTES = 256 * 1024;

async function sha256(path) {
  const digest = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.once('error', reject); stream.once('end', resolve);
  });
  return digest.digest('hex');
}

function finite(value) { return Number.isFinite(value) && value >= 0; }

function validReceipt(value) {
  return value?.schema === 't5.audio-reality.v1'
    && value.container && ['audio_file_property', 'media_foundation_presentation', 'unavailable']
      .includes(value.container.evidence)
    && (value.container.identifier == null || (typeof value.container.identifier === 'string'
      && value.container.identifier.length >= 1 && value.container.identifier.length <= 16))
    && finite(value.durationMs) && value.durationMs <= 7 * 24 * 60 * 60 * 1000
    && value.coverage === 'complete' && Array.isArray(value.tracks) && value.tracks.length <= 32
    && Number.isInteger(value.audioTrackCount) && Number.isInteger(value.videoTrackCount)
    && value.audioTrackCount === value.tracks.filter((track) => track?.kind === 'audio').length
    && value.videoTrackCount === value.tracks.filter((track) => track?.kind === 'video').length
    && value.tracks.every((track, index) => track?.index === index && Number.isInteger(track.trackId)
      && ['audio', 'video', 'other'].includes(track.kind)
      && (track.codec == null || (typeof track.codec === 'string' && track.codec.length <= 16))
      && (track.sampleRate == null || (finite(track.sampleRate) && track.sampleRate <= 768_000))
      && (track.channels == null || (Number.isInteger(track.channels) && track.channels >= 0
        && track.channels <= 64))
      && (track.languageTag == null || (typeof track.languageTag === 'string'
        && track.languageTag.length <= 80)));
}

export function makeAudioRealityProbe({
  platform = process.platform, helper = null, runCommand = execFileAsync,
} = {}) {
  return async function observe({ filePath, expectedSha256 = null, timeoutMs = 20_000 } = {}) {
    if (!['darwin', 'win32'].includes(platform) || !helper) {
      return { state: 'unavailable', reason: 'audio_reality_not_qualified' };
    }
    let exact; let before;
    try {
      exact = await realpath(filePath); before = await lstat(exact);
    } catch {
      return { state: 'unavailable', reason: 'audio_source_unavailable' };
    }
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
      return { state: 'unavailable', reason: 'audio_source_identity_boundary' };
    }
    const beforeDigest = await sha256(exact);
    if (expectedSha256 && expectedSha256 !== beforeDigest) {
      return { state: 'stale', reason: 'audio_source_digest_changed' };
    }
    try {
      const { stdout } = await runCommand(helper, ['--inspect', exact], {
        timeout: timeoutMs, maxBuffer: MAX_RECEIPT_BYTES,
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' },
      });
      if (Buffer.byteLength(String(stdout), 'utf8') > MAX_RECEIPT_BYTES) {
        throw new Error('audio reality receipt is too large');
      }
      const receipt = JSON.parse(String(stdout));
      if (!validReceipt(receipt)) throw new Error('audio reality receipt is malformed');
      const after = await lstat(exact); const afterDigest = await sha256(exact);
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || beforeDigest !== afterDigest) return { state: 'stale', reason: 'audio_source_changed_during_observation' };
      return {
        state: 'observed', engine: platform === 'win32'
          ? 'windows-media-foundation' : 'macos-avfoundation-audiotoolbox',
        source: { sha256: beforeDigest, bytes: before.size },
        container: receipt.container, durationMs: receipt.durationMs,
        tracks: receipt.tracks, audioTrackCount: receipt.audioTrackCount,
        videoTrackCount: receipt.videoTrackCount, coverage: receipt.coverage,
      };
    } catch (error) {
      return { state: 'unavailable', reason: error?.code === 'ETIMEDOUT'
        ? 'audio_reality_timeout' : 'audio_reality_failed' };
    }
  };
}

export function makeAudioDecode({
  observe, platform = process.platform,
  converter = platform === 'darwin' ? '/usr/bin/afconvert' : null,
  runCommand = execFileAsync,
} = {}) {
  if (typeof observe !== 'function') throw new TypeError('audio reality observer is required');
  return async function decode({
    filePath, expectedSha256 = null, scratchRoot, trackIndex = null, timeoutMs = 10 * 60_000,
  } = {}) {
    if (!['darwin', 'win32'].includes(platform) || !converter) {
      return { state: 'unavailable', reason: 'audio_decode_not_qualified' };
    }
    const input = await observe({ filePath, expectedSha256, timeoutMs: Math.min(timeoutMs, 20_000) });
    if (input.state !== 'observed') return input;
    const audioTracks = input.tracks.filter((track) => track.kind === 'audio');
    if (!audioTracks.length) return { state: 'unavailable', reason: 'audio_track_not_present', input };
    if (trackIndex == null && audioTracks.length !== 1) {
      return { state: 'selection_required', reason: 'multiple_audio_tracks',
        tracks: audioTracks.map((track) => structuredClone(track)), input };
    }
    const selected = trackIndex == null ? audioTracks[0]
      : audioTracks.find((track) => track.index === trackIndex);
    if (!selected) return { state: 'unavailable', reason: 'audio_track_not_found', input };
    let root; let directory = null;
    try {
      root = await realpath(scratchRoot); const rootStat = await lstat(root);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        return { state: 'unavailable', reason: 'audio_decode_scratch_boundary', input };
      }
      directory = await mkdtemp(join(root, 't5-audio-decode-'));
      const output = join(directory, 'decoded.wav');
      const argumentsList = platform === 'win32'
        ? ['--decode', filePath, output, String(selected.index)]
        : [filePath, '-o', output, '--read-track', String(selected.index),
          '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', '--no-filler'];
      await runCommand(converter, argumentsList, {
        timeout: timeoutMs, maxBuffer: MAX_RECEIPT_BYTES,
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' },
      });
      const sourceAfter = await observe({ filePath, expectedSha256: input.source.sha256,
        timeoutMs: Math.min(timeoutMs, 20_000) });
      if (sourceAfter.state !== 'observed') {
        await rm(directory, { recursive: true, force: true });
        return { state: 'stale', reason: 'audio_source_changed_during_decode' };
      }
      const decoded = await observe({ filePath: output, timeoutMs: Math.min(timeoutMs, 20_000) });
      const decodedTrack = decoded.state === 'observed'
        ? decoded.tracks.find((track) => track.kind === 'audio') : null;
      const decodedWave = decoded.state === 'observed' && (decoded.container.identifier === 'WAVE'
        || (platform === 'win32' && ['audio/wav', 'audio/x-wav'].includes(decoded.container.identifier)));
      if (decoded.state !== 'observed' || decoded.audioTrackCount !== 1 || decoded.videoTrackCount !== 0
        || !decodedWave || decodedTrack?.sampleRate !== 16000
        || decodedTrack?.channels !== 1
        || Math.abs(decoded.durationMs - input.durationMs) > 100) {
        await rm(directory, { recursive: true, force: true });
        return { state: 'unavailable', reason: 'audio_decode_output_invalid', input };
      }
      return { state: 'decoded', input, selectedTrack: structuredClone(selected),
        pcm: { path: output, sha256: decoded.source.sha256, bytes: decoded.source.bytes,
          durationMs: decoded.durationMs, sampleRate: 16000, channels: 1, coverage: 'complete' },
        cleanup: { directory } };
    } catch (error) {
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
      return { state: 'unavailable', reason: error?.code === 'ETIMEDOUT'
        ? 'audio_decode_timeout' : 'audio_decode_failed', input };
    }
  };
}
