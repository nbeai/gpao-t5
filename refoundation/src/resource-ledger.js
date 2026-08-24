import { randomUUID } from 'node:crypto';
import { NodeResourceEventStorage } from './resource-event-storage.js';

const SCHEMA = 't5.resource-event.v1';
const EVENT_TYPES = new Set([
  'ScopeCreated', 'ResourceObserved', 'RequestForecasted', 'ResourceReserved',
  'ReservationCommitted', 'ReservationReleased', 'UsageMarkedUnknown',
  'ControlActionRecorded', 'AnomalyRecorded', 'ScopeClosed',
]);
const TERMINAL_RESERVATIONS = new Set([
  'ReservationCommitted', 'ReservationReleased', 'UsageMarkedUnknown',
]);
const CONTENT_KEYS = new Set([
  'request', 'prompt', 'content', 'text', 'args', 'result', 'stdout', 'stderr',
  'url', 'path', 'error', 'secret', 'credential',
]);
const MAX_PAYLOAD_BYTES = 16 * 1024;

function clone(value) { return value == null ? value : structuredClone(value); }

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function fingerprint(value) { return JSON.stringify(canonical(value)); }

function identifier(value, label) {
  const id = String(value ?? '');
  if (!id || id.length > 240 || /[\r\n]/u.test(id)) throw new TypeError(`${label} is invalid`);
  return id;
}

function validateContentFree(value, location = 'payload') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateContentFree(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (CONTENT_KEYS.has(key)) throw new TypeError(`${location}.${key} is content-bearing`);
    validateContentFree(item, `${location}.${key}`);
  }
}

function normalizedPayload(payload) {
  const value = clone(payload ?? {});
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('resource payload must be an object');
  }
  validateContentFree(value);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new Error('resource payload is too large');
  }
  return value;
}

function parseEvents(raw) {
  if (!String(raw ?? '').trim()) return [];
  const events = String(raw).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  for (const [index, event] of events.entries()) {
    if (event.schema !== SCHEMA || event.sequence !== index + 1 || !EVENT_TYPES.has(event.type)
      || !event.eventId || !event.dedupeKey || !event.scopeId) {
      throw new Error('invalid resource ledger');
    }
  }
  return events;
}

export class ResourceLedger {
  constructor(directory, {
    now = () => new Date().toISOString(), makeId = randomUUID,
    storage = new NodeResourceEventStorage(directory),
  } = {}) {
    if (!directory) throw new TypeError('resource ledger directory is required');
    this.directory = directory;
    if (!storage || typeof storage.prepare !== 'function' || typeof storage.read !== 'function'
      || typeof storage.append !== 'function') throw new TypeError('resource storage is invalid');
    this.storage = storage;
    this.now = now;
    this.makeId = makeId;
    this.queue = Promise.resolve();
    this.loaded = null;
  }

  serialize(work) {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }

  async state() {
    if (this.loaded) return this.loaded;
    await this.storage.prepare();
    const raw = await this.storage.read();
    const events = parseEvents(raw);
    const byDedupe = new Map(events.map((event) => [event.dedupeKey, event]));
    const scopes = new Map();
    const reservations = new Map();
    const settlements = new Map();
    for (const event of events) {
      if (event.type === 'ScopeCreated') scopes.set(event.scopeId, event);
      if (event.type === 'ResourceReserved') reservations.set(event.payload.reservationId, event);
      if (TERMINAL_RESERVATIONS.has(event.type)) settlements.set(event.payload.reservationId, event);
    }
    this.loaded = { events, byDedupe, scopes, reservations, settlements };
    return this.loaded;
  }

  async append({ type, dedupeKey, scopeId, parentScopeId = null, payload = {} }) {
    if (!EVENT_TYPES.has(type)) throw new TypeError('invalid resource event type');
    const key = identifier(dedupeKey, 'dedupeKey');
    const scope = identifier(scopeId, 'scopeId');
    const parent = parentScopeId == null ? null : identifier(parentScopeId, 'parentScopeId');
    const body = normalizedPayload(payload);
    return this.serialize(async () => {
      const state = await this.state();
      const semantic = { type, scopeId: scope, parentScopeId: parent, payload: body };
      const existing = state.byDedupe.get(key);
      if (existing) {
        const prior = {
          type: existing.type, scopeId: existing.scopeId,
          parentScopeId: existing.parentScopeId ?? null, payload: existing.payload,
        };
        if (fingerprint(prior) !== fingerprint(semantic)) throw new Error(`resource dedupe conflict: ${key}`);
        return clone(existing);
      }
      if (type !== 'ScopeCreated' && !state.scopes.has(scope)) throw new Error(`resource scope not found: ${scope}`);
      if (type === 'ScopeCreated') {
        if (parent && !state.scopes.has(parent)) throw new Error(`parent resource scope not found: ${parent}`);
        if (state.scopes.has(scope)) throw new Error(`resource scope already exists: ${scope}`);
      }
      const reservationId = body.reservationId;
      if (type === 'ResourceReserved') {
        identifier(reservationId, 'reservationId');
        if (state.reservations.has(reservationId)) throw new Error(`resource reservation exists: ${reservationId}`);
      }
      if (TERMINAL_RESERVATIONS.has(type)) {
        identifier(reservationId, 'reservationId');
        const reserved = state.reservations.get(reservationId);
        if (!reserved) throw new Error(`resource reservation not found: ${reservationId}`);
        const settled = state.settlements.get(reservationId);
        if (settled) throw new Error(`resource reservation already settled: ${reservationId}`);
      }
      const event = {
        schema: SCHEMA, eventId: this.makeId(), sequence: state.events.length + 1,
        recordedAt: this.now(), type, dedupeKey: key, scopeId: scope,
        ...(parent ? { parentScopeId: parent } : {}), payload: body,
      };
      try {
        await this.storage.append(`${JSON.stringify(event)}\n`, {
          durable: type === 'ResourceReserved' || TERMINAL_RESERVATIONS.has(type),
        });
      } catch (error) {
        // A storage adapter may fail after publication but before confirming durability.
        // Drop resident indexes so the next operation re-reads physical truth instead of
        // appending a duplicate from stale memory.
        this.loaded = null;
        throw error;
      }
      state.events.push(event); state.byDedupe.set(key, event);
      if (type === 'ScopeCreated') state.scopes.set(scope, event);
      if (type === 'ResourceReserved') state.reservations.set(reservationId, event);
      if (TERMINAL_RESERVATIONS.has(type)) state.settlements.set(reservationId, event);
      return clone(event);
    });
  }

  createScope({ scopeId, parentScopeId = null, kind, dedupeKey, facts = {} }) {
    return this.append({
      type: 'ScopeCreated', scopeId, parentScopeId, dedupeKey,
      payload: { kind: identifier(kind, 'scope kind'), ...normalizedPayload(facts) },
    });
  }

  forecast({ scopeId, dedupeKey, requestId, attempt, resources }) {
    return this.append({
      type: 'RequestForecasted', scopeId, dedupeKey,
      payload: { requestId: identifier(requestId, 'requestId'), attempt, resources: normalizedPayload(resources) },
    });
  }

  reserve({ scopeId, dedupeKey, reservationId, requestId, attempt, resources }) {
    return this.append({
      type: 'ResourceReserved', scopeId, dedupeKey,
      payload: {
        reservationId: identifier(reservationId, 'reservationId'),
        requestId: identifier(requestId, 'requestId'), attempt,
        resources: normalizedPayload(resources),
      },
    });
  }

  commit({ scopeId, dedupeKey, reservationId, responseId = null, resources }) {
    return this.append({
      type: 'ReservationCommitted', scopeId, dedupeKey,
      payload: {
        reservationId: identifier(reservationId, 'reservationId'),
        ...(responseId ? { responseId: identifier(responseId, 'responseId') } : {}),
        resources: normalizedPayload(resources),
      },
    });
  }

  release({ scopeId, dedupeKey, reservationId, reason }) {
    return this.append({
      type: 'ReservationReleased', scopeId, dedupeKey,
      payload: { reservationId: identifier(reservationId, 'reservationId'), reason: identifier(reason, 'reason') },
    });
  }

  markUnknown({ scopeId, dedupeKey, reservationId, reason, facts = {} }) {
    return this.append({
      type: 'UsageMarkedUnknown', scopeId, dedupeKey,
      payload: {
        reservationId: identifier(reservationId, 'reservationId'), reason: identifier(reason, 'reason'),
        ...normalizedPayload(facts),
      },
    });
  }

  observe({ scopeId, dedupeKey, resources, facts = {} }) {
    return this.append({
      type: 'ResourceObserved', scopeId, dedupeKey,
      payload: { resources: normalizedPayload(resources), ...normalizedPayload(facts) },
    });
  }

  recordAnomaly({ scopeId, dedupeKey, category, signals, metrics, shadow = true }) {
    return this.append({
      type: 'AnomalyRecorded', scopeId, dedupeKey,
      payload: {
        category: identifier(category, 'anomaly category'),
        signals: Array.isArray(signals) ? signals.map((value) => identifier(value, 'anomaly signal')) : [],
        metrics: normalizedPayload(metrics), shadow: shadow === true, intervention: false,
      },
    });
  }

  closeScope({ scopeId, dedupeKey, status }) {
    return this.append({
      type: 'ScopeClosed', scopeId, dedupeKey,
      payload: { status: identifier(status, 'scope status') },
    });
  }

  async recoverOpenReservations({ reason = 'runtime_restarted' } = {}) {
    const state = await this.state();
    const open = [...state.reservations.entries()].filter(([id]) => !state.settlements.has(id));
    const recovered = [];
    for (const [reservationId, event] of open) {
      recovered.push(await this.markUnknown({
        scopeId: event.scopeId,
        dedupeKey: `recover:${reservationId}`,
        reservationId,
        reason,
      }));
      await this.closeScope({
        scopeId: event.scopeId,
        dedupeKey: `recover-close:${event.scopeId}`,
        status: 'unknown',
      });
    }
    return recovered;
  }

  async read() { return clone((await this.state()).events); }
}

export const RESOURCE_EVENT_SCHEMA = SCHEMA;
