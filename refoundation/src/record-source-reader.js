import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

import { validateRecordReference } from './record-reference.js';

const MODES = new Set(['O0_off', 'O2_full_shadow']);
const digestJson = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const digestBytes = (value) => createHash('sha256').update(value).digest('hex');
const byteLength = (value) => Buffer.isBuffer(value)
  ? value.length : Buffer.byteLength(JSON.stringify(value), 'utf8');

function permissionError(message) {
  return Object.assign(new Error(message), { code: 'T5_RECORD_PERMISSION' });
}

function safeClock(nowNs) {
  try { return BigInt(nowNs()); } catch { return null; }
}

function availabilityFromError(error) {
  if (error?.status === 404 || error?.code === 'ENOENT') return 'missing';
  if (['EACCES', 'EPERM', 'T5_RECORD_PERMISSION'].includes(error?.code)) return 'permission_denied';
  return 'unknown';
}

function accounting(reference, availability, {
  observedSha256 = null, bytesRead = null, digestMatched = null, start = null, end = null,
} = {}) {
  return {
    schema: 't5.record-source-accounting.v1',
    recordId: reference.recordId,
    sourceKind: reference.sourceKind,
    sourceStore: reference.sourceStore,
    availability,
    coverage: reference.coverage,
    digestMatched,
    observedSha256,
    bytesRead,
    durationNs: start == null || end == null ? null : String(end >= start ? end - start : 0n),
  };
}

async function readManagedFile(reference, resolver) {
  if (!resolver) throw Object.assign(new Error('local file resolver unavailable'), { code: 'T5_RECORD_UNKNOWN' });
  const location = await resolver(reference);
  if (!location?.root || !location?.path) throw Object.assign(new Error('local file missing'), { code: 'ENOENT' });
  const root = await realpath(resolve(location.root));
  const requested = resolve(location.path);
  const stat = await lstat(requested);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
    throw permissionError('managed source must be a regular single-link file');
  }
  const path = await realpath(requested);
  const rel = relative(root, path);
  if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(root, rel) !== path) {
    throw permissionError('managed source is outside its root');
  }
  const source = await readFile(path);
  return { source, sha256: digestBytes(source), bytesRead: source.length };
}

async function readConversation(reference, ledger) {
  if (!ledger) throw Object.assign(new Error('conversation reader unavailable'), { code: 'T5_RECORD_UNKNOWN' });
  const value = await ledger.read(reference.scope.sessionId);
  const source = value.events.find((event) => event.type === 'message'
    && event.messageId === reference.sourceId && event.sequence === reference.sourceRevision);
  if (!source) throw Object.assign(new Error('conversation source missing'), { status: 404 });
  return { source, sha256: digestJson(source), bytesRead: byteLength(source) };
}

async function readRun(reference, ledger) {
  if (!ledger) throw Object.assign(new Error('run reader unavailable'), { code: 'T5_RECORD_UNKNOWN' });
  const match = /^(.*):event:(\d+)$/u.exec(reference.sourceId);
  if (!match || Number(match[2]) !== reference.sourceRevision) {
    throw Object.assign(new Error('run source missing'), { status: 404 });
  }
  const value = await ledger.read(match[1]);
  if (value.sessionId !== reference.scope.sessionId) throw permissionError('foreign Session run source');
  const source = value.events.find((event) => event.sequence === reference.sourceRevision);
  if (!source) throw Object.assign(new Error('run source missing'), { status: 404 });
  return { source, sha256: digestJson(source), bytesRead: byteLength(source) };
}

async function readWork(reference, store) {
  if (!store) throw Object.assign(new Error('work reader unavailable'), { code: 'T5_RECORD_UNKNOWN' });
  const match = /^(.*):event:(\d+)$/u.exec(reference.sourceId);
  if (!match || match[1] !== reference.scope.workId || Number(match[2]) !== reference.sourceRevision) {
    throw Object.assign(new Error('work source missing'), { status: 404 });
  }
  const value = await store.read();
  const source = value.events.find((event) => event.sequence === reference.sourceRevision);
  if (!source) throw Object.assign(new Error('work source missing'), { status: 404 });
  if (source.workId != null && String(source.workId) !== reference.scope.workId) {
    throw permissionError('foreign Work source');
  }
  return { source, sha256: digestJson(source), bytesRead: byteLength(source) };
}

async function readAttachment(reference, store) {
  if (!store) throw Object.assign(new Error('attachment reader unavailable'), { code: 'T5_RECORD_UNKNOWN' });
  const source = await store.get({
    sessionId: reference.scope.sessionId, attachmentId: reference.sourceId,
  });
  const kind = source.direction === 'output' ? 'artifact' : 'attachment';
  const revision = source.direction === 'output' ? Number(source.artifactVersion ?? 1) : 1;
  if (kind !== reference.sourceKind || revision !== reference.sourceRevision) {
    throw Object.assign(new Error('attachment revision missing'), { status: 404 });
  }
  return { source, sha256: source.sha256, bytesRead: Number(source.bytes ?? 0) };
}

export function makeRecordSourceReader({
  mode = 'O0_off', conversationLedger = null, runLedger = null, workStore = null,
  attachmentStore = null, localFileResolver = null, providerResolver = null,
  nowNs = () => process.hrtime.bigint(),
} = {}) {
  if (!MODES.has(mode)) throw new TypeError('record source reader mode is invalid');

  async function observe(reference) {
    if (reference.sourceKind === 'conversation_message') return readConversation(reference, conversationLedger);
    if (reference.sourceKind === 'run_event') return readRun(reference, runLedger);
    if (reference.sourceKind === 'work_event') return readWork(reference, workStore);
    if (['attachment', 'artifact'].includes(reference.sourceKind)) {
      return readAttachment(reference, attachmentStore);
    }
    if (reference.sourceKind === 'local_file') return readManagedFile(reference, localFileResolver);
    if (!providerResolver) throw Object.assign(new Error('provider unavailable'), { code: 'T5_RECORD_UNKNOWN' });
    const value = await providerResolver(reference);
    if (!value || !Object.hasOwn(value, 'source')) {
      throw Object.assign(new Error('provider source missing'), { status: 404 });
    }
    return {
      source: value.source,
      sha256: value.sha256 ?? digestJson(value.source),
      bytesRead: value.bytesRead ?? byteLength(value.source),
    };
  }

  return {
    mode,
    async reopen(input, { expectedSessionId = null, expectedWorkId = null } = {}) {
      if (mode === 'O0_off') return { state: 'off', source: null, accounting: null };
      const reference = validateRecordReference(input);
      const start = safeClock(nowNs);
      if ((expectedSessionId != null && reference.scope.sessionId !== String(expectedSessionId))
        || (expectedWorkId != null && reference.scope.workId !== String(expectedWorkId))) {
        const end = safeClock(nowNs);
        return { state: 'permission_denied', source: null,
          accounting: accounting(reference, 'permission_denied', { start, end }) };
      }
      try {
        const observed = await observe(reference);
        const end = safeClock(nowNs);
        const digestMatched = reference.sha256 == null ? null : reference.sha256 === observed.sha256;
        if (digestMatched === false) return {
          state: 'changed', source: null,
          accounting: accounting(reference, 'changed', { ...observed, digestMatched, start, end,
            observedSha256: observed.sha256 }),
        };
        return {
          state: 'reopened', source: observed.source,
          accounting: accounting(reference, 'available', { ...observed, digestMatched, start, end,
            observedSha256: observed.sha256 }),
        };
      } catch (error) {
        const end = safeClock(nowNs); const availability = availabilityFromError(error);
        return { state: availability, source: null,
          accounting: accounting(reference, availability, { start, end }) };
      }
    },
  };
}
