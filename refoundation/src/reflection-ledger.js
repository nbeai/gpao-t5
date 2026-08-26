import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, open, realpath } from 'node:fs/promises';
import { dirname, join, parse, resolve, sep } from 'node:path';

import {
  transitionReflectionCandidate,
  validateReflectionCandidateEnvelope,
} from './reflection-candidate.js';
import {
  consumeReflectionMaterialization,
  validatePersistedReflectionMaterialization,
} from './reflection-evidence-materializer.js';

const SCHEMA = 't5.reflection-ledger-event.v1';
const EVENT_FIELDS = new Set([
  'schema', 'sequence', 'type', 'recordedAt', 'previousEventDigest', 'payload', 'eventDigest',
]);
const EVENT_TYPES = new Set([
  'reflection_ledger_started', 'reflection_proposed', 'reflection_transitioned',
  'reflection_review_decided',
]);
const REVIEW_INPUT_FIELDS = new Set([
  'requestId', 'expectedCandidateDigest', 'decision', 'currentEvidence', 'sourceProbeReceipt',
]);
const REVIEW_RECEIPT_FIELDS = new Set([
  'schema', 'requestId', 'requestFingerprint', 'reviewerKind', 'decision',
  'beforeCandidateDigest', 'afterCandidateDigest', 'beforeState', 'afterState',
  'materializationDigest', 'sourceFenceDigest', 'sourceProbeReceipt', 'sideEffects',
  'receiptDigest',
]);
const SOURCE_PROBE_FIELDS = new Set([
  'schema', 'state', 'sourceFenceDigest', 'sourceSetDigest', 'requiredSources',
  'reopenedSources', 'missingSources', 'changedSources', 'permissionDeniedSources',
  'unknownSources', 'affectedScopeDigest', 'receiptDigest',
]);
const SIDE_EFFECT_FIELDS = new Set([
  'memoryWrites', 'principleWrites', 'managedCapabilityChanges', 'externalWrites',
]);
const SHARED_QUEUES = new Map();
const FRESH_REVIEW_PROBES = new WeakSet();

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
};
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const clone = (value) => structuredClone(value);

function exactFields(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is invalid`);
  const keys = Object.keys(value);
  if (keys.length !== fields.size || keys.some((key) => !fields.has(key))) throw new Error(`${label} is invalid`);
}

function eventDigest(event) {
  const { eventDigest: ignored, ...body } = event;
  return hash(body);
}

function canonicalTime(value) {
  const parsed = new Date(value);
  if (typeof value !== 'string' || !Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error('Reflection ledger time must be canonical UTC');
  }
  return value;
}

function boundedText(value, label, max = 256) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > max
    || /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function requestIdentity(value) {
  const id = boundedText(value, 'review requestId', 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(id)) {
    throw new TypeError('review requestId must be an opaque identity');
  }
  return id;
}

function digest(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} is invalid`);
  return value;
}

function sourceSetDigest(recordIds) {
  if (!Array.isArray(recordIds) || recordIds.length > 512) {
    throw new TypeError('source record identities must be a bounded array');
  }
  const ids = recordIds.map((id) => boundedText(id, 'source record identity'));
  if (new Set(ids).size !== ids.length) throw new TypeError('source record identities must be unique');
  return hash(ids.toSorted());
}

export async function materializeReflectionReviewProbe({
  recordSourceReader, recordRefs, sourceFenceDigest, affectedScopeDigest,
} = {}) {
  if (typeof recordSourceReader?.reopen !== 'function' || !Array.isArray(recordRefs)) {
    throw new TypeError('Reflection review probe requires an exact source reader and RecordRefs');
  }
  const ids = [];
  for (const reference of recordRefs) {
    if (!reference?.recordId || !reference.sha256) {
      throw new TypeError('Reflection review probe requires source digests');
    }
    let reopened;
    try {
      reopened = await recordSourceReader.reopen(reference, {
        expectedSessionId: reference.scope?.sessionId ?? null,
        expectedWorkId: reference.scope?.workId ?? null,
      });
    } catch {
      const failure = new Error('Reflection review source is unknown');
      failure.code = 'reflection_review_source_unknown'; throw failure;
    }
    const accounting = reopened?.accounting;
    if (reopened?.state !== 'reopened' || !reopened.source
      || accounting?.recordId !== reference.recordId
      || accounting?.availability !== 'available' || accounting?.digestMatched !== true
      || accounting?.observedSha256 !== reference.sha256) {
      const state = ['changed', 'missing', 'permission_denied', 'unknown'].includes(reopened?.state)
        ? reopened.state : accounting?.digestMatched === false ? 'changed' : 'unknown';
      const failure = new Error(`Reflection review source is ${state}`);
      failure.code = `reflection_review_source_${state}`; throw failure;
    }
    ids.push(reference.recordId);
  }
  const core = { schema: 't5.reflection-source-probe-receipt.v1', state: 'qualified',
    sourceFenceDigest: digest(sourceFenceDigest, 'sourceFenceDigest'),
    sourceSetDigest: sourceSetDigest(ids), requiredSources: ids.length, reopenedSources: ids.length,
    missingSources: 0, changedSources: 0, permissionDeniedSources: 0, unknownSources: 0,
    affectedScopeDigest: digest(affectedScopeDigest, 'affectedScopeDigest') };
  const wrapper = Object.freeze({ schema: 't5.reflection-review-probe-materialization.v1',
    receipt: Object.freeze({ ...core, receiptDigest: hash(core) }) });
  FRESH_REVIEW_PROBES.add(wrapper); return wrapper;
}

function validateSourceProbeReceipt(input, candidate, materialization) {
  exactFields(input, SOURCE_PROBE_FIELDS, 'Reflection source-probe receipt');
  const core = { schema: input.schema, state: input.state,
    sourceFenceDigest: digest(input.sourceFenceDigest, 'sourceProbe.sourceFenceDigest'),
    sourceSetDigest: digest(input.sourceSetDigest, 'sourceProbe.sourceSetDigest'),
    requiredSources: count(input.requiredSources, 'sourceProbe.requiredSources'),
    reopenedSources: count(input.reopenedSources, 'sourceProbe.reopenedSources'),
    missingSources: count(input.missingSources, 'sourceProbe.missingSources'),
    changedSources: count(input.changedSources, 'sourceProbe.changedSources'),
    permissionDeniedSources: count(input.permissionDeniedSources, 'sourceProbe.permissionDeniedSources'),
    unknownSources: count(input.unknownSources, 'sourceProbe.unknownSources'),
    affectedScopeDigest: digest(input.affectedScopeDigest, 'sourceProbe.affectedScopeDigest') };
  const expectedIds = candidate.recordRefs.map((reference) => reference.recordId);
  if (core.schema !== 't5.reflection-source-probe-receipt.v1' || core.state !== 'qualified'
    || core.sourceFenceDigest !== candidate.sourceFence.windowDigest
    || core.affectedScopeDigest !== materialization.receipt.affectedScopeDigest
    || core.sourceSetDigest !== sourceSetDigest(expectedIds)
    || core.requiredSources !== expectedIds.length || core.reopenedSources !== expectedIds.length
    || core.missingSources !== 0 || core.changedSources !== 0
    || core.permissionDeniedSources !== 0 || core.unknownSources !== 0
    || input.receiptDigest !== hash(core)) {
    throw new TypeError('Reflection retain requires a qualified exact source probe');
  }
  return { ...core, receiptDigest: input.receiptDigest };
}

function consumeReviewProbe(input, candidate, materialization) {
  if (!input || !FRESH_REVIEW_PROBES.has(input)) {
    throw new TypeError('Reflection retain requires a fresh exact source probe');
  }
  FRESH_REVIEW_PROBES.delete(input);
  return validateSourceProbeReceipt(input.receipt, candidate, materialization);
}

function reviewFingerprint({ requestId, reflectionId, expectedCandidateDigest, decision }) {
  return hash({ schema: 't5.reflection-review-request.v1', requestId, reflectionId,
    expectedCandidateDigest, decision });
}

function validateReviewReceipt(input, { previous, after, materialization }) {
  exactFields(input, REVIEW_RECEIPT_FIELDS, 'Reflection review receipt');
  exactFields(input.sideEffects, SIDE_EFFECT_FIELDS, 'Reflection review sideEffects');
  const decision = input.decision;
  if (!['retain', 'reject'].includes(decision) || input.schema !== 't5.reflection-review-receipt.v1'
    || input.reviewerKind !== 'settings_runtime') throw new Error('invalid Reflection review receipt');
  const expectedAfter = decision === 'retain' ? 'reviewed' : 'rejected';
  const requestId = requestIdentity(input.requestId);
  const beforeCandidateDigest = digest(input.beforeCandidateDigest, 'beforeCandidateDigest');
  const afterCandidateDigest = digest(input.afterCandidateDigest, 'afterCandidateDigest');
  const requestFingerprint = digest(input.requestFingerprint, 'review requestFingerprint');
  const materializationDigest = digest(input.materializationDigest, 'review materializationDigest');
  const sourceFence = digest(input.sourceFenceDigest, 'review sourceFenceDigest');
  const sourceProbeReceipt = decision === 'retain'
    ? validateSourceProbeReceipt(input.sourceProbeReceipt, previous, materialization) : input.sourceProbeReceipt;
  if (decision === 'reject' && sourceProbeReceipt !== null) throw new Error('reject review cannot claim a source probe');
  if ((decision === 'retain' && previous.candidate.state !== 'proposed')
    || (decision === 'reject' && !['proposed', 'reviewed'].includes(previous.candidate.state))
    || input.beforeState !== previous.candidate.state || input.afterState !== expectedAfter
    || after.candidate.state !== expectedAfter || beforeCandidateDigest !== previous.candidateDigest
    || afterCandidateDigest !== after.candidateDigest
    || materializationDigest !== materialization.materializationDigest
    || sourceFence !== previous.sourceFence.windowDigest
    || requestFingerprint !== reviewFingerprint({ requestId,
      reflectionId: previous.candidate.reflectionId, expectedCandidateDigest: beforeCandidateDigest,
      decision })
    || Object.values(input.sideEffects).some((value) => value !== 0)) {
    throw new Error('invalid Reflection review receipt');
  }
  const core = { schema: input.schema, requestId, requestFingerprint,
    reviewerKind: 'settings_runtime', decision, beforeCandidateDigest, afterCandidateDigest,
    beforeState: input.beforeState, afterState: input.afterState, materializationDigest,
    sourceFenceDigest: sourceFence, sourceProbeReceipt, sideEffects: clone(input.sideEffects) };
  if (input.receiptDigest !== hash(core)) throw new Error('invalid Reflection review receipt digest');
  return { ...core, receiptDigest: input.receiptDigest };
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.nlink === 1 && right.nlink === 1;
}

function normalizePlatformRootAlias(path) {
  if (process.platform !== 'darwin') return path;
  for (const alias of ['/var', '/tmp', '/etc']) {
    if (path === alias || path.startsWith(`${alias}/`)) return `/private${path}`;
  }
  return path;
}

async function assertExistingComponentsAreNotLinks(target) {
  const root = parse(target).root;
  let cursor = root;
  for (const component of target.slice(root.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, component);
    const stat = await lstat(cursor).catch((error) => {
      if (error?.code === 'ENOENT') return null; throw error;
    });
    if (!stat) return;
    if (stat.isSymbolicLink()) throw new Error('Reflection ledger intermediate path is unsafe');
  }
}

function isInitialProposal(envelope) {
  return envelope.candidate.state === 'proposed'
    && envelope.projection === 'none'
    && envelope.stateHistory.length === 1
    && envelope.stateHistory[0].from === null
    && envelope.stateHistory[0].to === 'proposed';
}

function unchangedCandidateBody(before, after) {
  const scrub = (envelope) => {
    const result = clone(envelope);
    result.candidate.state = '__state__';
    result.stateHistory = '__history__';
    result.candidateDigest = '__digest__';
    return result;
  };
  return JSON.stringify(scrub(before)) === JSON.stringify(scrub(after));
}

function applyEvents(events) {
  const candidates = new Map();
  const materializations = new Map();
  const proposalKeys = new Map();
  const reviewRequests = new Map();
  for (const event of events) {
    if (event.type === 'reflection_ledger_started') continue;
    if (event.type === 'reflection_proposed') {
      const materialization = validatePersistedReflectionMaterialization(event.payload.materialization);
      const envelope = materialization.envelope;
      const id = envelope.candidate.reflectionId;
      if (!isInitialProposal(envelope) || candidates.has(id)) throw new Error('invalid Reflection proposal event');
      const key = hash({ hypothesis: envelope.candidate.hypothesis,
        sourceWindowDigest: envelope.sourceFence.windowDigest });
      if (proposalKeys.has(key)) throw new Error('duplicate Reflection proposal event');
      proposalKeys.set(key, id); candidates.set(id, envelope);
      materializations.set(id, materialization); continue;
    }
    const envelope = validateReflectionCandidateEnvelope(event.payload.envelope);
    const id = envelope.candidate.reflectionId;
    const previous = candidates.get(id);
    const materialization = materializations.get(id);
    if (!previous || !materialization
      || event.payload.materializationDigest !== materialization.materializationDigest
      || !unchangedCandidateBody(previous, envelope)
      || envelope.stateHistory.length !== previous.stateHistory.length + 1
      || JSON.stringify(envelope.stateHistory.slice(0, -1)) !== JSON.stringify(previous.stateHistory)
      || envelope.stateHistory.at(-1).from !== previous.candidate.state
      || envelope.stateHistory.at(-1).to !== envelope.candidate.state) {
      throw new Error('invalid Reflection transition event');
    }
    if (event.type === 'reflection_review_decided') {
      const receipt = validateReviewReceipt(event.payload.review,
        { previous, after: envelope, materialization });
      if (reviewRequests.has(receipt.requestId)) throw new Error('duplicate Reflection review request');
      reviewRequests.set(receipt.requestId, { fingerprint: receipt.requestFingerprint,
        receipt, reflectionId: id, envelope: clone(envelope) });
    }
    candidates.set(id, envelope);
  }
  return { candidates, materializations, proposalKeys, reviewRequests };
}

function parseLedger(text, maxEventBytes) {
  if (!text || !text.endsWith('\n')) throw new Error('invalid partial Reflection ledger line');
  const lines = text.slice(0, -1).split('\n');
  const events = [];
  let previousDigest = null;
  for (const [index, line] of lines.entries()) {
    if (Buffer.byteLength(line, 'utf8') > maxEventBytes) throw new Error('Reflection ledger event is too large');
    let event;
    try { event = JSON.parse(line); } catch { throw new Error('invalid Reflection ledger JSON'); }
    exactFields(event, EVENT_FIELDS, 'Reflection ledger event');
    if (event.schema !== SCHEMA || event.sequence !== index + 1 || !EVENT_TYPES.has(event.type)
      || event.previousEventDigest !== previousDigest || !/^[a-f0-9]{64}$/u.test(event.eventDigest)
      || eventDigest(event) !== event.eventDigest) {
      throw new Error('invalid Reflection ledger event integrity');
    }
    try { canonicalTime(event.recordedAt); } catch { throw new Error('invalid Reflection ledger event time'); }
    if (event.type === 'reflection_ledger_started') {
      if (index !== 0 || JSON.stringify(event.payload) !== '{}') throw new Error('invalid Reflection ledger start');
    } else if (event.type === 'reflection_proposed') {
      exactFields(event.payload, new Set(['materialization']), 'Reflection ledger proposal payload');
    } else if (event.type === 'reflection_transitioned') {
      exactFields(event.payload, new Set(['envelope', 'materializationDigest']),
        'Reflection ledger transition payload');
    } else {
      exactFields(event.payload, new Set(['envelope', 'materializationDigest', 'review']),
        'Reflection ledger review payload');
    }
    events.push(event); previousDigest = event.eventDigest;
  }
  if (!events.length || events[0].type !== 'reflection_ledger_started') {
    throw new Error('invalid Reflection ledger start');
  }
  const projection = applyEvents(events);
  return { events, ...projection };
}

function materializationProjection(candidate, materialization) {
  return {
    candidate: clone(candidate), materialization: clone(materialization),
    receipt: clone(materialization.receipt),
    materializationDigest: materialization.materializationDigest,
    counterexampleHeads: clone(materialization.receipt.counterexampleSearch.heads),
  };
}

function result(candidate, materialization, extra = {}) {
  return {
    ...materializationProjection(candidate, materialization),
    productProjection: 'none',
    active: false,
    publicationQualified: false,
    crossStoreAtomicCasQualified: false,
    truncationQualified: false,
    anchoredHead: false,
    pathChmodReplacementRaceQualified: false,
    knownLimitations: ['cross_process_lock_unqualified', 'cross_store_atomic_cas_unqualified',
      'external_head_anchor_absent', 'path_chmod_replacement_race_unqualified'],
    sideEffects: { memoryWrites: 0, principleWrites: 0, managedCapabilityChanges: 0, externalWrites: 0 },
    ...extra,
  };
}

export class ReflectionLedger {
  constructor(directory, { clock = () => new Date().toISOString(), maxEventBytes = 2 * 1024 * 1024,
    beforeAppend = null } = {}) {
    if (!directory) throw new TypeError('Reflection ledger directory is required');
    this.directory = normalizePlatformRootAlias(resolve(String(directory)));
    this.path = join(this.directory, 'reflection.jsonl');
    this.clock = clock;
    this.maxEventBytes = maxEventBytes;
    this.beforeAppend = beforeAppend;
  }

  #serialize(work) {
    const prior = SHARED_QUEUES.get(this.path) ?? Promise.resolve();
    const next = prior.then(work, work);
    SHARED_QUEUES.set(this.path, next.catch(() => {}));
    return next;
  }

  async #assertNearestExistingAncestorSafe() {
    await assertExistingComponentsAreNotLinks(this.directory);
    let cursor = this.directory;
    while (true) {
      const stat = await lstat(cursor).catch((error) => {
        if (error?.code === 'ENOENT') return null; throw error;
      });
      if (stat) {
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          throw new Error('Reflection ledger ancestor is unsafe');
        }
        return;
      }
      const parent = dirname(cursor);
      if (parent === cursor) throw new Error('Reflection ledger ancestor is unsafe');
      cursor = parent;
    }
  }

  async #assertSafePath({ allowMissingFile = false } = {}) {
    await assertExistingComponentsAreNotLinks(this.directory);
    const directoryStat = await lstat(this.directory).catch((error) => {
      if (error?.code === 'ENOENT') return null; throw error;
    });
    if (!directoryStat) {
      if (!allowMissingFile) throw Object.assign(new Error('Reflection ledger does not exist'), { code: 'ENOENT' });
      return;
    }
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new Error('Reflection ledger directory is unsafe');
    }
    const fileStat = await lstat(this.path).catch((error) => {
      if (error?.code === 'ENOENT') return null; throw error;
    });
    if (!fileStat) {
      if (!allowMissingFile) throw Object.assign(new Error('Reflection ledger does not exist'), { code: 'ENOENT' });
      return;
    }
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.nlink !== 1
      || dirname(await realpath(this.path)) !== await realpath(this.directory)) {
      throw new Error('Reflection ledger file is unsafe');
    }
  }

  #makeEvent(type, payload, currentEvents) {
    const event = { schema: SCHEMA, sequence: currentEvents.length + 1, type,
      recordedAt: canonicalTime(this.clock()), previousEventDigest: currentEvents.at(-1)?.eventDigest ?? null,
      payload: clone(payload), eventDigest: '' };
    event.eventDigest = eventDigest(event);
    return event;
  }

  async #load() {
    await this.#assertSafePath();
    const pathStat = await lstat(this.path);
    const handle = await open(this.path, 'r');
    try {
      const openedStat = await handle.stat();
      if (!sameIdentity(pathStat, openedStat) || !openedStat.isFile()) {
        throw new Error('Reflection ledger file identity changed');
      }
      const content = await handle.readFile('utf8');
      const finalStat = await handle.stat();
      if (!sameIdentity(openedStat, finalStat) || finalStat.size !== Buffer.byteLength(content, 'utf8')) {
        throw new Error('Reflection ledger file changed during read');
      }
      return { ...parseLedger(content, this.maxEventBytes), identity: {
        dev: finalStat.dev, ino: finalStat.ino, nlink: finalStat.nlink, size: finalStat.size,
      } };
    } finally { await handle.close(); }
  }

  async #appendEvent(event, expectedIdentity) {
    const line = `${JSON.stringify(event)}\n`;
    if (Buffer.byteLength(line, 'utf8') > this.maxEventBytes) throw new Error('Reflection ledger event is too large');
    await this.beforeAppend?.(clone(event));
    await this.#assertSafePath();
    const pathStat = await lstat(this.path);
    if (!sameIdentity(pathStat, expectedIdentity) || pathStat.size !== expectedIdentity.size) {
      throw new Error('Reflection ledger compare-and-append conflict');
    }
    const handle = await open(this.path, 'r+');
    try {
      const openedStat = await handle.stat();
      if (!sameIdentity(openedStat, expectedIdentity) || openedStat.size !== expectedIdentity.size) {
        throw new Error('Reflection ledger compare-and-append conflict');
      }
      const written = await handle.write(line, expectedIdentity.size, 'utf8');
      if (written.bytesWritten !== Buffer.byteLength(line, 'utf8')) throw new Error('Reflection ledger short write');
      await handle.chmod(0o600); await handle.sync();
      const committedStat = await handle.stat();
      const currentPathStat = await lstat(this.path);
      if (!sameIdentity(committedStat, currentPathStat)
        || committedStat.size !== expectedIdentity.size + written.bytesWritten) {
        throw new Error('Reflection ledger path changed during append');
      }
    } finally { await handle.close(); }
  }

  async ensure() {
    return this.#serialize(async () => {
      try { return await this.read(); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
      await this.#assertNearestExistingAncestorSafe();
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const directoryStat = await lstat(this.directory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
        throw new Error('Reflection ledger directory is unsafe');
      }
      await chmod(this.directory, 0o700);
      const handle = await open(this.path, 'wx', 0o600); await handle.close();
      await chmod(this.path, 0o600);
      const started = this.#makeEvent('reflection_ledger_started', {}, []);
      const emptyStat = await lstat(this.path);
      await this.#appendEvent(started, { dev: emptyStat.dev, ino: emptyStat.ino,
        nlink: emptyStat.nlink, size: emptyStat.size });
      return this.read();
    });
  }

  async read() {
    const parsed = await this.#load();
    const reflectionEntries = [...parsed.candidates.entries()].map(([id, candidate]) => (
      materializationProjection(candidate, parsed.materializations.get(id))
    ));
    return {
      events: clone(parsed.events), candidates: [...parsed.candidates.values()].map(clone),
      reflectionEntries,
      reviewReceipts: [...parsed.reviewRequests.values()].map((item) => clone(item.receipt)),
      productProjection: [], activeCandidates: [], publicationQualified: false,
      crossStoreAtomicCasQualified: false, productWiring: false,
      truncationQualified: false, anchoredHead: false,
      pathChmodReplacementRaceQualified: false,
      knownLimitations: ['cross_process_lock_unqualified', 'cross_store_atomic_cas_unqualified',
        'external_head_anchor_absent', 'path_chmod_replacement_race_unqualified'],
      sideEffects: { memoryWrites: 0, principleWrites: 0, managedCapabilityChanges: 0, externalWrites: 0 },
    };
  }

  async propose(input) {
    return this.#serialize(async () => {
      const materialization = consumeReflectionMaterialization(input);
      const envelope = materialization.envelope;
      if (!isInitialProposal(envelope)) {
        throw new TypeError('ReflectionLedger accepts only proposed materializations');
      }
      const parsed = await this.#load();
      const key = hash({ hypothesis: envelope.candidate.hypothesis,
        sourceWindowDigest: envelope.sourceFence.windowDigest });
      const existingId = parsed.proposalKeys.get(key);
      if (existingId) return result(parsed.candidates.get(existingId),
        parsed.materializations.get(existingId), { created: false, idempotent: true });
      if (parsed.candidates.has(envelope.candidate.reflectionId)) {
        throw new Error('Reflection candidate identity already exists');
      }
      const event = this.#makeEvent('reflection_proposed', { materialization }, parsed.events);
      await this.#appendEvent(event, parsed.identity);
      return result(envelope, materialization, { created: true, idempotent: false });
    });
  }

  async transition(reflectionId, { to, currentEvidence = null } = {}) {
    const id = String(reflectionId ?? '');
    if (to === 'reviewed' || to === 'rejected') {
      const failure = new Error('Human Reflection decisions require the atomic review API');
      failure.code = 'reflection_review_api_required'; throw failure;
    }
    return this.#serialize(async () => {
      const parsed = await this.#load();
      const current = parsed.candidates.get(id);
      if (!current) throw new Error('Reflection candidate not found');
      const materialization = parsed.materializations.get(id);
      const transitioned = transitionReflectionCandidate(current, { to, currentEvidence });
      const event = this.#makeEvent('reflection_transitioned', { envelope: transitioned,
        materializationDigest: materialization.materializationDigest }, parsed.events);
      await this.#appendEvent(event, parsed.identity);
      return result(transitioned, materialization, { transitioned: true });
    });
  }

  async review(reflectionId, input = {}) {
    exactFields(input, REVIEW_INPUT_FIELDS, 'Reflection review input');
    const id = boundedText(reflectionId, 'reflectionId');
    const requestId = requestIdentity(input.requestId);
    const expectedCandidateDigest = digest(input.expectedCandidateDigest, 'expectedCandidateDigest');
    const decision = input.decision;
    if (!['retain', 'reject'].includes(decision)) throw new TypeError('Reflection review decision is invalid');
    const fingerprint = reviewFingerprint({ requestId, reflectionId: id, expectedCandidateDigest, decision });
    return this.#serialize(async () => {
      const parsed = await this.#load();
      const priorRequest = parsed.reviewRequests.get(requestId);
      if (priorRequest) {
        if (priorRequest.fingerprint !== fingerprint) {
          const error = new Error('Reflection review request identity conflicts with prior decision');
          error.code = 'reflection_review_request_conflict'; throw error;
        }
        const materialization = parsed.materializations.get(priorRequest.reflectionId);
        const currentCandidate = parsed.candidates.get(priorRequest.reflectionId);
        return result(currentCandidate, materialization, { reviewDecisionRecorded: true, idempotent: true,
          decisionCandidateDigest: priorRequest.envelope.candidateDigest,
          reviewReceipt: clone(priorRequest.receipt) });
      }
      const current = parsed.candidates.get(id);
      if (!current) throw new Error('Reflection candidate not found');
      const stateAllowed = decision === 'retain' ? current.candidate.state === 'proposed'
        : ['proposed', 'reviewed'].includes(current.candidate.state);
      if (current.candidateDigest !== expectedCandidateDigest || !stateAllowed) {
        const error = new Error('Reflection candidate changed after human review surface');
        error.code = 'reflection_review_version_changed'; throw error;
      }
      const materialization = parsed.materializations.get(id);
      let sourceProbeReceipt = null;
      if (decision === 'retain') {
        if (!input.currentEvidence || !input.sourceProbeReceipt) {
          const error = new Error('Reflection retain current evidence is unqualified');
          error.code = 'current_evidence_unqualified'; throw error;
        }
        sourceProbeReceipt = consumeReviewProbe(input.sourceProbeReceipt, current, materialization);
      } else if (input.currentEvidence !== null || input.sourceProbeReceipt !== null) {
        throw new TypeError('Reflection reject does not accept source evidence');
      }
      const transitioned = transitionReflectionCandidate(current, {
        to: decision === 'retain' ? 'reviewed' : 'rejected',
        currentEvidence: decision === 'retain' ? input.currentEvidence : null,
      });
      const sideEffects = { memoryWrites: 0, principleWrites: 0,
        managedCapabilityChanges: 0, externalWrites: 0 };
      const core = { schema: 't5.reflection-review-receipt.v1', requestId,
        requestFingerprint: fingerprint, reviewerKind: 'settings_runtime', decision,
        beforeCandidateDigest: current.candidateDigest,
        afterCandidateDigest: transitioned.candidateDigest,
        beforeState: current.candidate.state, afterState: transitioned.candidate.state,
        materializationDigest: materialization.materializationDigest,
        sourceFenceDigest: current.sourceFence.windowDigest,
        sourceProbeReceipt, sideEffects };
      const reviewReceipt = { ...core, receiptDigest: hash(core) };
      const event = this.#makeEvent('reflection_review_decided', { envelope: transitioned,
        materializationDigest: materialization.materializationDigest, review: reviewReceipt }, parsed.events);
      await this.#appendEvent(event, parsed.identity);
      return result(transitioned, materialization, { reviewDecisionRecorded: true, idempotent: false,
        reviewReceipt });
    });
  }
}
