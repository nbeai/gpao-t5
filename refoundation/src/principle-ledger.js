import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { dirname, join, parse, resolve, sep } from 'node:path';

import { validatePrincipleFieldQualification } from './principle-qualification.js';
import { validateRecordReference } from './record-reference.js';

const EVENT_SCHEMA = 't5.principle-ledger-event.v1';
const EVENT_TYPES = new Set(['principle_ledger_started', 'principle_published', 'principle_rolled_back']);
const EVENT_FIELDS = new Set(['schema', 'sequence', 'type', 'recordedAt', 'previousEventDigest', 'payload', 'eventDigest']);
const ROLLBACK_FIELDS = new Set(['requestId', 'principleId', 'expectedRevisionDigest', 'trigger', 'runtime']);
const TRIGGER_FIELDS = new Set(['workId', 'runId', 'resultDigest', 'type', 'evidenceDigest', 'recordRef']);
const RECEIPT_FIELDS = new Set(['schema', 'requestId', 'requestFingerprint', 'principleId',
  'archivedRevisionDigest', 'restoredRevisionDigest', 'triggerReceipt', 'sideEffects', 'receiptDigest']);
const TRIGGER_RECEIPT_FIELDS = new Set(['schema', 'workId', 'runId', 'resultDigest', 'type',
  'evidenceDigest', 'principleRevisionDigest', 'recordId', 'observedSha256', 'receiptDigest']);
const SIDE_EFFECTS = Object.freeze({ memoryWrites: 0, managedSkillWrites: 0, managedCliWrites: 0,
  pluginWrites: 0, externalWrites: 0 });
const RUNTIMES = new WeakSet(); const SHARED = new Map();

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const clone = (value) => structuredClone(value);
function exact(value, fields, label) { if (!value || typeof value !== 'object' || Array.isArray(value)
  || Object.keys(value).length !== fields.size || Object.keys(value).some((key) => !fields.has(key))) {
  throw new TypeError(`${label} is invalid`); } }
function text(value, label, max = 256) { if (typeof value !== 'string' || !value || value.trim() !== value
  || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${label} is invalid`); return value; }
function digest(value, label) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
  throw new TypeError(`${label} is invalid`); } return value; }
function canonicalTime(value) { if (typeof value !== 'string' || new Date(value).toISOString() !== value) {
  throw new TypeError('Principle ledger time is invalid'); } return value; }
function requestId(value) { const id = text(value, 'rollback requestId', 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(id)) throw new TypeError('rollback requestId is invalid'); return id; }
function eventDigest(event) { const { eventDigest: ignored, ...body } = event; return hash(body); }
function sameIdentity(a, b) { return a.dev === b.dev && a.ino === b.ino && a.nlink === 1 && b.nlink === 1; }
function normalizePlatformRootAlias(path) { if (process.platform !== 'darwin') return path;
  for (const alias of ['/var', '/tmp', '/etc']) if (path === alias || path.startsWith(`${alias}/`)) return `/private${path}`;
  return path; }
function exclusive(path, work) { const prior = SHARED.get(path) ?? Promise.resolve(); const next = prior.then(work, work);
  SHARED.set(path, next.catch(() => {})); return next; }
async function assertNoLinks(target) { const root = parse(target).root; let cursor = root;
  for (const part of target.slice(root.length).split(sep).filter(Boolean)) { cursor = join(cursor, part);
    const stat = await lstat(cursor).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
    if (!stat) return; if (stat.isSymbolicLink()) throw new Error('Principle ledger path is unsafe'); } }

export function makePrincipleRollbackRuntime({ withStableWindow, recordSourceReader } = {}) {
  if (typeof withStableWindow !== 'function' || typeof recordSourceReader?.reopen !== 'function') {
    throw new TypeError('Principle rollback runtime dependencies are required');
  }
  const runtime = Object.freeze({ withStableWindow, recordSourceReader }); RUNTIMES.add(runtime); return runtime;
}

async function materializeTrigger(runtime, trigger, revisionDigest) {
  const reference = validateRecordReference(trigger.recordRef);
  if (!['run_event', 'work_event'].includes(reference.sourceKind)
    || reference.trust !== 'runtime_observed') {
    throw new TypeError('Principle rollback trigger must be a runtime-observed Run or Work event');
  }
  const reopened = await runtime.recordSourceReader.reopen(reference, {
    expectedSessionId: reference.scope.sessionId, expectedWorkId: reference.scope.workId });
  const accounting = reopened?.accounting; const source = reopened?.source;
  const observedWorkId = source?.workId ?? source?.payload?.workId ?? reference.scope.workId;
  const observedRunId = source?.runId ?? source?.payload?.runId ?? null;
  const observedResultDigest = source?.resultDigest ?? source?.payload?.resultDigest ?? null;
  if (reopened?.state !== 'reopened' || !source || accounting?.recordId !== reference.recordId
    || accounting?.availability !== 'available' || accounting?.digestMatched !== true
    || accounting?.observedSha256 !== reference.sha256 || observedWorkId !== trigger.workId
    || observedRunId !== trigger.runId || observedResultDigest !== trigger.resultDigest) {
    throw new TypeError('Principle rollback trigger source reopen is not exact');
  }
  const core = { schema: 't5.principle-rollback-trigger.v1', workId: trigger.workId,
    runId: trigger.runId, resultDigest: trigger.resultDigest, type: trigger.type,
    evidenceDigest: trigger.evidenceDigest, principleRevisionDigest: revisionDigest,
    recordId: reference.recordId, observedSha256: accounting.observedSha256 };
  return { ...core, receiptDigest: hash(core) };
}

function apply(events) {
  const publications = new Map(); const order = []; const current = new Map(); const archived = new Set();
  const requests = new Map();
  for (const event of events) {
    if (event.type === 'principle_ledger_started') continue;
    if (event.type === 'principle_published') {
      exact(event.payload, new Set(['qualification']), 'Principle publication payload');
      const qualification = validatePrincipleFieldQualification(event.payload.qualification);
      const key = `${qualification.candidate.principleId}:${qualification.candidate.revisionDigest}`;
      if (publications.has(key)) throw new Error('duplicate Principle publication event');
      publications.set(key, qualification); order.push(key);
      current.set(qualification.candidate.principleId, qualification.candidate.revisionDigest); continue;
    }
    exact(event.payload, new Set(['receipt']), 'Principle rollback payload');
    exact(event.payload.receipt, RECEIPT_FIELDS, 'Principle rollback receipt');
    const receipt = event.payload.receipt; const core = { ...receipt }; delete core.receiptDigest;
    exact(receipt.sideEffects, new Set(Object.keys(SIDE_EFFECTS)), 'Principle rollback sideEffects');
    exact(receipt.triggerReceipt, TRIGGER_RECEIPT_FIELDS, 'Principle rollback trigger receipt');
    const triggerCore = { ...receipt.triggerReceipt }; delete triggerCore.receiptDigest;
    const persistedRequestId = requestId(receipt.requestId);
    const persistedPrincipleId = text(receipt.principleId, 'rollback principleId');
    const archivedRevisionDigest = digest(receipt.archivedRevisionDigest, 'archivedRevisionDigest');
    for (const field of ['workId', 'runId', 'recordId']) text(receipt.triggerReceipt[field], `triggerReceipt.${field}`);
    for (const field of ['resultDigest', 'evidenceDigest', 'principleRevisionDigest', 'observedSha256']) {
      digest(receipt.triggerReceipt[field], `triggerReceipt.${field}`);
    }
    if (!['correctness_regression', 'completeness_regression', 'current_correction_changed',
      'false_trigger', 'cost_regression'].includes(receipt.triggerReceipt.type)) {
      throw new Error('invalid Principle rollback trigger type');
    }
    const expectedFingerprint = hash({ requestId: persistedRequestId, principleId: persistedPrincipleId,
      expectedRevisionDigest: archivedRevisionDigest, trigger: { workId: receipt.triggerReceipt.workId,
        runId: receipt.triggerReceipt.runId, resultDigest: receipt.triggerReceipt.resultDigest,
        type: receipt.triggerReceipt.type, evidenceDigest: receipt.triggerReceipt.evidenceDigest,
        recordRef: receipt.triggerReceipt.recordId } });
    if (receipt.schema !== 't5.principle-rollback-receipt.v1' || receipt.receiptDigest !== hash(core)
      || Object.values(receipt.sideEffects).some((value) => value !== 0)
      || receipt.triggerReceipt.schema !== 't5.principle-rollback-trigger.v1'
      || receipt.triggerReceipt.receiptDigest !== hash(triggerCore)
      || receipt.triggerReceipt.principleRevisionDigest !== receipt.archivedRevisionDigest
      || receipt.requestFingerprint !== expectedFingerprint
      || current.get(receipt.principleId) !== receipt.archivedRevisionDigest
      || requests.has(receipt.requestId)) throw new Error('invalid Principle rollback event');
    archived.add(`${receipt.principleId}:${receipt.archivedRevisionDigest}`);
    if (receipt.restoredRevisionDigest === null) current.delete(receipt.principleId);
    else {
      const restored = `${receipt.principleId}:${receipt.restoredRevisionDigest}`;
      if (!publications.has(restored) || archived.has(restored)) throw new Error('invalid restored Principle revision');
      current.set(receipt.principleId, receipt.restoredRevisionDigest);
    }
    requests.set(receipt.requestId, receipt);
  }
  return { publications, order, current, archived, requests };
}

function parseLedger(raw, maxBytes) { if (!raw.endsWith('\n')) throw new Error('invalid partial Principle ledger line');
  const events = raw.slice(0, -1).split('\n').map(JSON.parse); let previous = null;
  for (const [index, event] of events.entries()) { exact(event, EVENT_FIELDS, 'Principle ledger event');
    if (Buffer.byteLength(JSON.stringify(event), 'utf8') > maxBytes || event.schema !== EVENT_SCHEMA
      || event.sequence !== index + 1 || !EVENT_TYPES.has(event.type) || event.previousEventDigest !== previous
      || event.eventDigest !== eventDigest(event)) throw new Error('invalid Principle ledger integrity');
    canonicalTime(event.recordedAt); if (event.type === 'principle_ledger_started') {
      if (index !== 0 || JSON.stringify(event.payload) !== '{}') throw new Error('invalid Principle ledger start');
    }
    previous = event.eventDigest;
  }
  if (!events.length || events[0].type !== 'principle_ledger_started') throw new Error('invalid Principle ledger start');
  return { events, ...apply(events) };
}

function projection(qualification) { const candidate = qualification.candidate; return {
  principleId: candidate.principleId, revisionDigest: candidate.revisionDigest,
  statement: candidate.statement, scope: clone(candidate.scope), state: 'field_qualified',
  qualificationDigest: qualification.qualificationDigest } }

export class PrincipleLedger {
  constructor(directory, { clock = () => new Date().toISOString(), maxEventBytes = 4 * 1024 * 1024,
    beforeAppend = null, afterWrite = null } = {}) { if (!directory) throw new TypeError('Principle ledger directory is required');
    this.directory = normalizePlatformRootAlias(resolve(directory)); this.path = join(this.directory, 'principles.jsonl');
    this.clock = clock; this.maxEventBytes = maxEventBytes; this.beforeAppend = beforeAppend;
    this.afterWrite = afterWrite; }
  async #load() { await assertNoLinks(this.path); const pathStat = await lstat(this.path);
    if (!pathStat.isFile() || pathStat.nlink !== 1 || dirname(await realpath(this.path)) !== await realpath(this.directory)) {
      throw new Error('Principle ledger file is unsafe'); }
    const handle = await open(this.path, 'r'); try { const opened = await handle.stat();
      if (!sameIdentity(pathStat, opened)) throw new Error('Principle ledger identity changed');
      const raw = await handle.readFile('utf8'); const final = await handle.stat();
      if (!sameIdentity(opened, final) || final.size !== Buffer.byteLength(raw)) throw new Error('Principle ledger changed during read');
      return { ...parseLedger(raw, this.maxEventBytes), identity: final }; } finally { await handle.close(); } }
  #event(type, payload, events) { const event = { schema: EVENT_SCHEMA, sequence: events.length + 1,
    type, recordedAt: canonicalTime(this.clock()), previousEventDigest: events.at(-1)?.eventDigest ?? null,
    payload: clone(payload), eventDigest: '' }; event.eventDigest = eventDigest(event); return event; }
  async #append(event, identity) { const line = `${JSON.stringify(event)}\n`;
    if (Buffer.byteLength(line) > this.maxEventBytes) throw new Error('Principle ledger event is too large');
    await this.beforeAppend?.(clone(event)); await assertNoLinks(this.path); const stat = await lstat(this.path);
    if (!sameIdentity(stat, identity) || stat.size !== identity.size) throw new Error('Principle ledger append conflict');
    const handle = await open(this.path, 'r+'); try { const opened = await handle.stat();
      if (!sameIdentity(opened, identity) || opened.size !== identity.size) throw new Error('Principle ledger append conflict');
      const written = await handle.write(line, identity.size, 'utf8');
      if (written.bytesWritten !== Buffer.byteLength(line)) throw new Error('Principle ledger short write');
      await this.afterWrite?.(clone(event));
      await handle.chmod(0o600); await handle.sync(); const committed = await handle.stat(); const current = await lstat(this.path);
      if (!sameIdentity(committed, current) || committed.size !== identity.size + written.bytesWritten) {
        throw new Error('Principle ledger path changed during append');
      }
    } finally { await handle.close(); } }
  async ensure() { return exclusive(this.path, async () => { try { return await this.read(); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    await assertNoLinks(this.directory); await mkdir(this.directory, { recursive: true, mode: 0o700 }); await chmod(this.directory, 0o700);
    const handle = await open(this.path, 'wx', 0o600); await handle.close(); const stat = await lstat(this.path);
    await this.#append(this.#event('principle_ledger_started', {}, []), stat); return this.read(); }); }
  async read() { const parsed = await this.#load(); return { events: clone(parsed.events),
    currentPrinciples: [...parsed.current.entries()].map(([id, revision]) => projection(parsed.publications.get(`${id}:${revision}`))),
    defaultModelContext: [], defaultProjectionCount: 0, activeSkills: [], publicationScope: 'internal_principle_only',
    sideEffects: clone(SIDE_EFFECTS), crossProcessQualified: false, truncationQualified: false,
    anchoredHead: false, defaultContextQualified: false } }
  async publish(input) { return exclusive(this.path, async () => { const qualification = validatePrincipleFieldQualification(input);
    const parsed = await this.#load(); const id = qualification.candidate.principleId;
    const key = `${id}:${qualification.candidate.revisionDigest}`; const prior = parsed.publications.get(key);
    if (prior) { if (prior.qualificationDigest !== qualification.qualificationDigest) throw new Error('Principle revision qualification conflict');
      return { created: false, idempotent: true, current: projection(parsed.publications.get(`${id}:${parsed.current.get(id)}`)) }; }
    const event = this.#event('principle_published', { qualification }, parsed.events); await this.#append(event, parsed.identity);
    return { created: true, idempotent: false, current: projection(qualification), defaultProjectionCount: 0,
      sideEffects: clone(SIDE_EFFECTS) }; }); }
  async rollback(input = {}) { exact(input, ROLLBACK_FIELDS, 'Principle rollback input');
    const runtime = input.runtime; if (!runtime || !RUNTIMES.has(runtime)) throw new TypeError('Principle rollback requires runtime adapter');
    const id = text(input.principleId, 'principleId'); const request = requestId(input.requestId);
    const expected = digest(input.expectedRevisionDigest, 'expectedRevisionDigest'); exact(input.trigger, TRIGGER_FIELDS, 'Principle rollback trigger');
    for (const field of ['workId', 'runId']) text(input.trigger[field], `trigger.${field}`);
    for (const field of ['resultDigest', 'evidenceDigest']) digest(input.trigger[field], `trigger.${field}`);
    if (!['correctness_regression', 'completeness_regression', 'current_correction_changed',
      'false_trigger', 'cost_regression'].includes(input.trigger.type)) throw new TypeError('rollback trigger type is invalid');
    return runtime.withStableWindow(() => exclusive(this.path, async () => { const parsed = await this.#load();
      const priorRequest = parsed.requests.get(request); const fingerprint = hash({ requestId: request,
        principleId: id, expectedRevisionDigest: expected, trigger: { ...input.trigger, recordRef: input.trigger.recordRef.recordId } });
      if (priorRequest) { if (priorRequest.requestFingerprint !== fingerprint) throw Object.assign(new Error('rollback request conflict'), { code: 'principle_rollback_request_conflict' });
        return { idempotent: true, receipt: clone(priorRequest), current: parsed.current.has(id)
          ? projection(parsed.publications.get(`${id}:${parsed.current.get(id)}`)) : null }; }
      if (parsed.current.get(id) !== expected) throw Object.assign(new Error('Principle current revision changed'), { code: 'principle_rollback_version_changed' });
      const triggerReceipt = await materializeTrigger(runtime, input.trigger, expected);
      const currentKey = `${id}:${expected}`; const position = parsed.order.lastIndexOf(currentKey);
      let restored = null; for (let index = position - 1; index >= 0; index -= 1) { const key = parsed.order[index];
        if (key.startsWith(`${id}:`) && !parsed.archived.has(key)) { restored = key.slice(id.length + 1); break; } }
      const core = { schema: 't5.principle-rollback-receipt.v1', requestId: request,
        requestFingerprint: fingerprint, principleId: id, archivedRevisionDigest: expected,
        restoredRevisionDigest: restored, triggerReceipt, sideEffects: clone(SIDE_EFFECTS) };
      const receipt = { ...core, receiptDigest: hash(core) };
      await this.#append(this.#event('principle_rolled_back', { receipt }, parsed.events), parsed.identity);
      return { idempotent: false, receipt, current: restored
        ? projection(parsed.publications.get(`${id}:${restored}`)) : null,
      defaultProjectionCount: 0, sideEffects: clone(SIDE_EFFECTS) }; })); }
}
