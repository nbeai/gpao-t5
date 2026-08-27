import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const STATE_SCHEMA = 't5.scoped-file-activity-state.v1';
const EVENT_SCHEMA = 't5.scoped-file-activity-event.v1';
const KINDS = new Set(['created', 'modified', 'moved', 'deleted']);
const SOURCES = new Set(['macos_fsevents', 'windows_usn', 'fixture']);
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = (value) => value == null ? value : structuredClone(value);

function canonicalTime(value) {
  const text = String(value ?? ''); const parsed = new Date(text);
  if (!text || !Number.isFinite(parsed.getTime()) || parsed.toISOString() !== text) throw new TypeError('canonical UTC time is required');
  return text;
}
function bounded(value, label, maximum = 4096) {
  const text = String(value ?? '');
  if (!text || text.length > maximum || /[\u0000-\u001f\u007f]/u.test(text)) throw new TypeError(`${label} is invalid`);
  return text;
}
function identity(value) {
  if (value == null) return null;
  const allowed = new Set(['device', 'inode', 'volume', 'fileId', 'reparse']);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.has(key))) throw new TypeError('file identity is invalid');
  const output = {};
  for (const key of allowed) if (value[key] != null) output[key] = bounded(value[key], key, 200);
  return Object.keys(output).length ? output : null;
}
function canonicalPath(path, platform) {
  const text = bounded(path, 'path');
  if (!isAbsolute(text)) throw new TypeError('absolute activity path is required');
  const exact = resolve(text);
  return platform === 'darwin' && /^\/(?:var|tmp|etc)(?:\/|$)/u.test(exact) ? `/private${exact}` : exact;
}
async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 }); await chmod(temporary, 0o600);
  await rename(temporary, path); await chmod(path, 0o600);
}
async function safeAppendLines(path, lines) {
  if (!Array.isArray(lines) || !lines.length) return;
  const flags = constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY
    | (constants.O_NOFOLLOW ?? 0); const handle = await open(path, flags, 0o600);
  try {
    const before = await handle.stat(); if (!before.isFile() || before.nlink !== 1) throw new Error('activity file is unsafe');
    await handle.write(`${lines.join('\n')}\n`); await handle.sync();
    const after = await handle.stat(); const pathAfter = await lstat(path);
    if (after.dev !== before.dev || after.ino !== before.ino || after.nlink !== 1
      || pathAfter.dev !== after.dev || pathAfter.ino !== after.ino || pathAfter.nlink !== 1) {
      throw new Error('activity file identity changed');
    }
  } finally { await handle.close(); }
  await chmod(path, 0o600);
}
function journalIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('journal identity is required');
  const allowed = new Set(['kind', 'volume', 'journalId']);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new TypeError('journal identity fields are invalid');
  return { kind: bounded(value.kind, 'journal kind', 40), volume: bounded(value.volume, 'journal volume', 200),
    journalId: bounded(value.journalId, 'journal id', 200) };
}
function publicEvent(event) {
  const pathText = relative(event.root, event.path) || basename(event.path) || '.';
  return { activityHandle: hash(['activity', event.source, event.sourceEventId, event.eventDigest]).slice(0, 32),
    kind: event.kind, pathText, occurredAt: event.occurredAt, availability: event.availability,
    actor: event.actor, coverage: 'metadata_only' };
}

export class ScopedFileActivityLedger {
  constructor(directory) {
    if (!directory || !isAbsolute(directory)) throw new TypeError('absolute activity directory is required');
    this.directory = directory; this.stateFile = join(directory, 'state.json'); this.queue = Promise.resolve();
  }
  serialize(work) { const next = this.queue.then(work, work); this.queue = next.catch(() => {}); return next; }
  activityFile(generation) { return join(this.directory, `activity-${generation}.jsonl`); }
  async ensureDirectory() { await mkdir(this.directory, { recursive: true, mode: 0o700 }); await chmod(this.directory, 0o700); }
  async readState() {
    await this.ensureDirectory();
    try {
      const info = await lstat(this.stateFile); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('activity state path is unsafe');
      const value = JSON.parse(await readFile(this.stateFile, 'utf8'));
      if (value.schema !== STATE_SCHEMA || !Number.isSafeInteger(value.generation) || value.generation < 1) throw new Error('activity state is invalid');
      return value;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      return { schema: STATE_SCHEMA, generation: 1, configured: false, enabled: false,
        platform: null, roots: [], journal: null, cursor: null, gap: null, eventCount: 0,
        retention: 'until_user_deletes', contentCapture: false, modelContextDefault: false };
    }
  }
  async saveState(value) { await atomicJson(this.stateFile, value); }
  async readEvents(state = null) {
    const current = state ?? await this.readState(); const path = this.activityFile(current.generation);
    try {
      const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('activity log path is unsafe');
      const text = await readFile(path, 'utf8'); return text.split('\n').filter(Boolean).map((line, index) => {
        const event = JSON.parse(line); if (event.schema !== EVENT_SCHEMA || event.sequence !== index + 1) throw new Error('activity event sequence is invalid');
        const { schema: _schema, sequence: _sequence, source, journalDigest, eventDigest,
          sourceKey, ...activity } = event;
        if (eventDigest !== hash(activity)
          || sourceKey !== hash([source, journalDigest, event.sourceEventId, event.kind, event.path])) {
          throw new Error('activity event digest is invalid');
        }
        return event;
      });
    } catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  }
  async configure({ roots, platform = process.platform, recordedAt } = {}) {
    if (!['darwin', 'win32'].includes(platform) || !Array.isArray(roots) || roots.length < 1 || roots.length > 32) {
      throw new TypeError('platform and 1..32 roots are required');
    }
    const exactRoots = [];
    for (const requested of roots) {
      const input = bounded(requested, 'root'); const inputInfo = await lstat(input);
      if (!inputInfo.isDirectory() || inputInfo.isSymbolicLink()) throw new Error('activity root must be an exact directory');
      const exact = await realpath(input); const info = await lstat(exact);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('activity root must be an exact directory');
      exactRoots.push(exact);
    }
    return this.serialize(async () => {
      const state = await this.readState(); const next = { ...state, generation: state.generation + 1,
        configured: true, enabled: false, platform, roots: [...new Set(exactRoots)].sort(),
        journal: null, cursor: null, gap: null, eventCount: 0, configuredAt: canonicalTime(recordedAt) };
      await rm(this.activityFile(state.generation), { force: true });
      await this.saveState(next); return this.status();
    });
  }
  async setEnabled({ enabled, recordedAt } = {}) {
    return this.serialize(async () => {
      const state = await this.readState(); if (!state.configured) throw new Error('activity scope is not configured');
      if (enabled === true && state.gap) throw new Error('activity journal requires a metadata rescan');
      const next = { ...state, enabled: enabled === true, changedAt: canonicalTime(recordedAt) };
      await this.saveState(next); return this.status();
    });
  }
  async markGap({ source, journal, cursor, reason, recordedAt } = {}) {
    if (!SOURCES.has(source)) throw new TypeError('activity source is invalid');
    return this.serialize(async () => {
      const state = await this.readState(); const next = { ...state, enabled: false,
        journal: journalIdentity(journal ?? state.journal), cursor: cursor == null ? state.cursor : bounded(cursor, 'cursor', 500),
        gap: { reason: bounded(reason, 'gap reason', 100), recordedAt: canonicalTime(recordedAt) } };
      await this.saveState(next); return this.status();
    });
  }
  async settleSnapshot({ journal, cursor, itemCount, snapshotDigest, recordedAt } = {}) {
    if (!journal || typeof journal !== 'object' || !/^[a-f0-9]{64}$/u.test(snapshotDigest ?? '')
      || !Number.isSafeInteger(itemCount) || itemCount < 0) throw new TypeError('qualified metadata snapshot is required');
    return this.serialize(async () => {
      const state = await this.readState(); if (!state.gap) throw new Error('activity journal has no open gap');
      const next = { ...state, journal: journalIdentity(journal), cursor: bounded(cursor, 'cursor', 500), gap: null,
        snapshot: { itemCount, snapshotDigest, recordedAt: canonicalTime(recordedAt) } };
      await this.saveState(next); return this.status();
    });
  }
  async ingest({ source, journal, cursor, events, recordedAt } = {}) {
    if (!SOURCES.has(source) || !journal || typeof journal !== 'object'
      || !Array.isArray(events) || events.length > 4096) throw new TypeError('bounded activity batch is required');
    return this.serialize(async () => {
      const state = await this.readState(); if (!state.enabled) return { accepted: 0, state: 'paused' };
      if (state.gap) return { accepted: 0, state: 'rescan_required' };
      const exactJournal = journalIdentity(journal);
      const journalDigest = hash(exactJournal); const currentJournalDigest = state.journal ? hash(state.journal) : null;
      if (currentJournalDigest && currentJournalDigest !== journalDigest) {
        const next = { ...state, enabled: false, gap: { reason: 'journal_identity_changed',
          recordedAt: canonicalTime(recordedAt) } }; await this.saveState(next); return { accepted: 0, state: 'rescan_required' };
      }
      const exactCursor = bounded(cursor, 'cursor', 500);
      if (!/^[0-9]+$/u.test(exactCursor)) throw new TypeError('numeric activity cursor is required');
      if (state.cursor != null && BigInt(exactCursor) < BigInt(state.cursor)) return { accepted: 0, state: 'stale_cursor' };
      const existing = await this.readEvents(state); const seen = new Set(existing.map((event) => event.sourceKey));
      const coalesced = new Map();
      for (const input of events) {
        const allowed = new Set(['kind', 'path', 'occurredAt', 'sourceEventId', 'identity', 'availability']);
        if (!input || typeof input !== 'object' || Object.keys(input).some((key) => !allowed.has(key))
          || !KINDS.has(input.kind)) throw new Error('activity event fields are invalid');
        const path = canonicalPath(input.path, state.platform);
        const root = state.roots.find((candidate) => path === candidate || path.startsWith(`${candidate}${sep}`));
        if (!root) continue;
        const event = { kind: input.kind, path, root, occurredAt: canonicalTime(input.occurredAt),
          sourceEventId: bounded(input.sourceEventId, 'source event id', 500), identity: identity(input.identity),
          availability: ['available', 'missing', 'unknown'].includes(input.availability) ? input.availability : 'unknown',
          actor: 'unknown', coverage: 'metadata_only' };
        event.eventDigest = hash(event); event.sourceKey = hash([source, journalDigest, event.sourceEventId, event.kind, event.path]);
        if (!seen.has(event.sourceKey)) coalesced.set(event.sourceKey, event);
      }
      const accepted = [...coalesced.values()]; let sequence = existing.length;
      await safeAppendLines(this.activityFile(state.generation), accepted.map((event) => JSON.stringify({
        schema: EVENT_SCHEMA, sequence: ++sequence, source, journalDigest, ...event })));
      const next = { ...state, journal: exactJournal, cursor: exactCursor,
        eventCount: existing.length + accepted.length, lastBatchAt: canonicalTime(recordedAt) };
      await this.saveState(next);
      return { accepted: accepted.length, state: accepted.length ? 'recorded' : 'duplicate' };
    });
  }
  async status() {
    const state = await this.readState(); const events = await this.readEvents(state); let activityBytes = 0;
    try { activityBytes = (await stat(this.activityFile(state.generation))).size; } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    let stateBytes = 0; try { stateBytes = (await stat(this.stateFile)).size; } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    return { configured: state.configured, enabled: state.enabled, platform: state.platform,
      roots: clone(state.roots), cursor: state.cursor, gap: clone(state.gap), eventCount: events.length,
      storageBytes: stateBytes + activityBytes, retention: state.retention,
      contentCapture: false, modelContextDefault: false };
  }
  async query({ limit = 100 } = {}) {
    const state = await this.readState(); const count = Math.min(500, Math.max(1, Number(limit) || 100));
    return (await this.readEvents(state)).slice(-count).reverse().map(publicEvent);
  }
  async forgetAll({ recordedAt } = {}) {
    return this.serialize(async () => {
      const state = await this.readState(); const deletedEvents = (await this.readEvents(state)).length;
      await rm(this.activityFile(state.generation), { force: true });
      const next = { ...state, generation: state.generation + 1, enabled: false, cursor: null,
        journal: null, gap: null, eventCount: 0, forgottenAt: canonicalTime(recordedAt) };
      await this.saveState(next); return { deletedEvents, remainingEvents: 0, enabled: false };
    });
  }
}

export function normalizeMacOSFSEvent(input = {}) {
  const flags = new Set(input.flags ?? []);
  if (flags.has('must_scan_subdirs') || flags.has('user_dropped') || flags.has('kernel_dropped')
    || flags.has('event_ids_wrapped') || flags.has('root_changed')) return { gap: true,
    reason: [...flags].sort().join('+'), cursor: String(input.eventId ?? 0) };
  const kind = flags.has('item_created') ? 'created' : flags.has('item_removed') ? 'deleted'
    : flags.has('item_renamed') ? 'moved'
      : flags.has('item_modified') || flags.has('inode_meta_mod') ? 'modified' : null;
  if (!kind) return null;
  return { kind, path: input.path, occurredAt: input.occurredAt, sourceEventId: String(input.eventId),
    identity: input.device != null && input.inode != null ? { device: String(input.device), inode: String(input.inode) } : null,
    availability: kind === 'deleted' ? 'missing' : input.availability ?? 'unknown' };
}

export function normalizeWindowsUSNRecord(input = {}) {
  if (input.gap === true) return { gap: true,
    reason: String(input.reason ?? 'usn_journal_gap'), cursor: String(input.usn ?? 0) };
  const reasons = new Set(input.reasons ?? []);
  const kind = reasons.has('file_create') ? 'created' : reasons.has('file_delete') ? 'deleted'
    : reasons.has('rename_old_name') || reasons.has('rename_new_name') ? 'moved'
      : reasons.size ? 'modified' : null;
  if (!kind) return null;
  return { kind, path: input.path, occurredAt: input.occurredAt, sourceEventId: String(input.usn),
    identity: input.volume && input.fileId ? { volume: String(input.volume), fileId: String(input.fileId),
      ...(input.reparse ? { reparse: String(input.reparse) } : {}) } : null,
    availability: kind === 'deleted' ? 'missing' : input.availability ?? 'unknown' };
}
