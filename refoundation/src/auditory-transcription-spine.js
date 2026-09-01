import { randomUUID } from 'node:crypto';
import { lstat, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

function publicProcess(snapshot) { return { processId: snapshot.processId, state: snapshot.state,
  stdout: snapshot.stdout, stderr: snapshot.stderr, cursor: snapshot.cursor,
  exitCode: snapshot.exitCode, durationMs: snapshot.durationMs,
  ...(snapshot.outputRecall ? { outputRecall: snapshot.outputRecall } : {}) }; }

function validTranscript(value) { return value && typeof value === 'object' && !Array.isArray(value)
  && Array.isArray(value.transcription) && value.transcription.length <= 100_000
  && value.transcription.every((segment) => typeof segment?.text === 'string'
    && segment.text.length <= 100_000 && Number.isFinite(segment?.offsets?.from)
    && Number.isFinite(segment?.offsets?.to)); }

export function makeAuditoryTranscriptionSpine({
  capabilityService, decodeAudio, processRegistry, helper, makeId = randomUUID,
} = {}) {
  if (!capabilityService?.prepare || typeof decodeAudio !== 'function' || !processRegistry?.start || !helper) {
    throw new TypeError('auditory transcription spine inputs are required');
  }
  const operations = new Map();
  async function settle(operation, snapshot) {
    if (snapshot.state === 'running' || snapshot.state === 'stop_requested') {
      return { state: 'running', operationId: operation.operationId, process: publicProcess(snapshot) };
    }
    if (snapshot.state !== 'completed' || snapshot.exitCode !== 0) {
      return { state: snapshot.state === 'stopped' ? 'stopped' : 'failed',
        operationId: operation.operationId, process: publicProcess(snapshot), publishable: false };
    }
    try {
      const path = `${operation.outputPrefix}.json`; const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 128 * 1024 * 1024) {
        throw new Error('transcript output identity is invalid');
      }
      const output = JSON.parse(await readFile(path, 'utf8'));
      if (!validTranscript(output)) throw new Error('transcript output is malformed');
      operation.terminal = true;
      return { state: 'transcribed_unverified', operationId: operation.operationId,
        process: publicProcess(snapshot), source: operation.source, model: operation.model,
        decoded: operation.decoded, transcriptPath: path, transcript: output, publishable: false };
    } catch {
      return { state: 'verification_failed', operationId: operation.operationId,
        process: publicProcess(snapshot), publishable: false };
    }
  }
  return {
    async start({ ownerId, filePath, expectedSha256 = null, scratchRoot, language = 'auto',
      waitMs = 1000, signal = null, onProgress = null } = {}) {
      if (!ownerId || !scratchRoot || !/^(?:auto|[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)$/u.test(language)) {
        throw new TypeError('auditory transcription request is invalid');
      }
      const ready = await capabilityService.prepare({ signal, onProgress });
      if (ready.state !== 'ready') throw new Error('auditory capability is not ready');
      const decoded = await decodeAudio({ filePath, expectedSha256, scratchRoot, signal });
      if (decoded.state !== 'decoded') return { ...decoded, publishable: false };
      const operationId = makeId(); const outputPrefix = join(decoded.cleanup.directory, 'transcript');
      const operation = { operationId, ownerId, outputPrefix,
        source: { sha256: decoded.input.source.sha256, durationMs: decoded.input.durationMs,
          selectedTrack: decoded.selectedTrack },
        model: { assetId: ready.model.assetId, generationId: ready.model.generationId,
          sha256: ready.model.sha256 },
        decoded: { sha256: decoded.pcm.sha256, durationMs: decoded.pcm.durationMs,
          sampleRate: decoded.pcm.sampleRate, channels: decoded.pcm.channels },
        cleanupDirectory: decoded.cleanup.directory, terminal: false };
      const snapshot = await processRegistry.start({ program: helper,
        args: ['-m', ready.model.path, '-f', decoded.pcm.path, '-l', language,
          '-ojf', '-otxt', '-osrt', '-of', outputPrefix, '--print-progress'],
        cwd: decoded.cleanup.directory, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C' },
        ownerId, waitMs, command: 'T5 managed local transcription',
        metadata: { kind: 'managed', capability: 'auditory_transcription', operationId,
          sourceSha256: operation.source.sha256, modelGenerationId: operation.model.generationId },
        onActivity: (activity) => onProgress?.({ phase: 'transcribing', ...activity }) });
      operation.processId = snapshot.processId; operations.set(operationId, operation);
      return settle(operation, snapshot);
    },
    async poll({ ownerId, operationId, cursor = null, waitMs = 0 } = {}) {
      const operation = operations.get(operationId);
      if (!operation || operation.ownerId !== ownerId) throw Object.assign(new Error('auditory operation not found'), { status: 404 });
      return settle(operation, await processRegistry.poll({ processId: operation.processId, ownerId, cursor, waitMs }));
    },
    async stop({ ownerId, operationId, cursor = null } = {}) {
      const operation = operations.get(operationId);
      if (!operation || operation.ownerId !== ownerId) throw Object.assign(new Error('auditory operation not found'), { status: 404 });
      const snapshot = await processRegistry.stop({ processId: operation.processId, ownerId,
        reason: 'user_cancelled', cursor });
      await rm(operation.cleanupDirectory, { recursive: true, force: true }); operations.delete(operationId);
      return { state: 'stopped', operationId, process: publicProcess(snapshot), publishable: false };
    },
    async cleanup({ ownerId, operationId } = {}) { const operation = operations.get(operationId);
      if (!operation || operation.ownerId !== ownerId || !operation.terminal) return false;
      await rm(operation.cleanupDirectory, { recursive: true, force: true }); operations.delete(operationId); return true; },
  };
}
