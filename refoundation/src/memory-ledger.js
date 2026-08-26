import { randomUUID } from 'node:crypto';
import { appendFile, chmod, mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { validateRecordReference } from './record-reference.js';
import { makeMemoryClaim } from './temporal-memory.js';

const SCHEMA = 't5.memory-event.v1';
const KINDS = new Set(['user', 'work']);

function clone(value) { return value == null ? value : structuredClone(value); }
function bytes(value) { return Buffer.byteLength(String(value ?? ''), 'utf8'); }
function primarySubject(subjects, memoryId = '') { return subjects?.[0] ? String(subjects[0]) : `memory:${memoryId}`; }

function normalizedContent(content) {
  const value = String(content ?? '').trim();
  if (!value) throw new TypeError('memory content is required');
  return value;
}

function normalizedKind(kind) {
  const value = String(kind ?? '');
  if (!KINDS.has(value)) throw new TypeError('memory kind must be user or work');
  return value;
}

function claimFromEvent(event) {
  if (!event.temporal) return null;
  return makeMemoryClaim({
    memoryId: event.memoryId,
    kind: event.temporal.claimKind,
    subjectKey: event.temporal.subjectKey,
    value: event.content,
    scope: event.temporal.scope,
    sources: event.recordRefs,
    recordedAt: event.recordedAt,
    validFrom: event.temporal.validFrom,
    validTo: event.temporal.validTo,
    subjectRevision: event.subjectRevision,
    sourceOrder: event.sourceOrder,
    status: event.temporal.status,
    supersedes: event.temporal.supersedes,
    conflictsWith: event.temporal.conflictsWith,
    sensitivity: event.temporal.sensitivity,
    alwaysRelevant: event.alwaysRelevant === true,
  });
}

function parseEvents(text) {
  const events = String(text ?? '').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  if (!events.length || events[0].type !== 'memory_started') throw new Error('invalid memory ledger');
  for (const [index, event] of events.entries()) {
    if (event.schema !== SCHEMA || event.sequence !== index + 1) {
      throw new Error('invalid memory event sequence');
    }
    if (event.type !== 'memory_started' && !event.memoryId) throw new Error('invalid memory event');
    if (['memory_added', 'memory_replaced'].includes(event.type)) {
      normalizedKind(event.kind);
      normalizedContent(event.content);
      claimFromEvent(event);
    }
    if (event.type === 'memory_removed' && event.recordRefs !== undefined) {
      if (!Array.isArray(event.recordRefs) || !event.recordRefs.length) {
        throw new Error('invalid memory retraction RecordRef');
      }
      event.recordRefs.forEach(validateRecordReference);
    }
  }
  return events;
}

function project(events) {
  const current = new Map();
  for (const event of events) {
    if (event.type === 'memory_added') {
      for (const superseded of event.temporal?.supersedes ?? []) current.delete(superseded);
      current.set(event.memoryId, {
        memoryId: event.memoryId, kind: event.kind, content: event.content,
        subjects: clone(event.subjects ?? []), alwaysRelevant: event.alwaysRelevant === true,
        subjectRevision: Number(event.subjectRevision ?? 1), sourceOrder: Number(event.sourceOrder ?? event.sequence),
        source: clone(event.source ?? null), createdAt: event.recordedAt, updatedAt: event.recordedAt,
        ...(event.temporal ? { temporal: clone(event.temporal), recordRefs: clone(event.recordRefs) } : {}),
      });
    } else if (event.type === 'memory_replaced') {
      const previous = current.get(event.memoryId);
      if (!previous) throw new Error('memory replacement target is missing');
      current.set(event.memoryId, {
        ...previous, kind: event.kind, content: event.content,
        subjects: clone(event.subjects ?? previous.subjects ?? []),
        alwaysRelevant: event.alwaysRelevant === true,
        subjectRevision: Number(event.subjectRevision ?? (previous.subjectRevision + 1)),
        sourceOrder: Number(event.sourceOrder ?? event.sequence),
        source: clone(event.source ?? null), updatedAt: event.recordedAt,
        ...(event.temporal ? { temporal: clone(event.temporal), recordRefs: clone(event.recordRefs) } : {}),
      });
    } else if (event.type === 'memory_removed') {
      if (!current.has(event.memoryId)) throw new Error('memory removal target is missing');
      current.delete(event.memoryId);
    }
  }
  return [...current.values()];
}

function projectClaims(events) {
  const claims = new Map();
  for (const event of events) {
    if (event.type === 'memory_added' && event.temporal) {
      const claim = claimFromEvent(event);
      for (const targetId of claim.supersedes) {
        const target = claims.get(targetId);
        if (target) claims.set(targetId, { ...target, status: 'superseded' });
      }
      claims.set(claim.memoryId, claim);
    } else if (event.type === 'memory_removed') {
      const target = claims.get(event.memoryId);
      if (target) claims.set(event.memoryId, { ...target, status: 'retracted' });
    }
  }
  return [...claims.values()];
}

function projectTombstones(events) {
  const tombstones = new Map();
  for (const event of events) {
    if (event.type === 'memory_removed' && event.tombstone) {
      tombstones.set(event.memoryId, clone(event.tombstone));
    } else if (event.type === 'memory_added' && event.temporal?.restoresForgetRequestId) {
      const current = tombstones.get(event.memoryId);
      if (current?.requestId === event.temporal.restoresForgetRequestId) tombstones.delete(event.memoryId);
    }
  }
  return [...tombstones.values()];
}

export class MemoryLedger {
  constructor(directory, { maxEntryBytes = 2_000, maxActiveBytes = 16_000, maxItems = 100 } = {}) {
    if (!directory) throw new TypeError('memory ledger directory is required');
    this.directory = directory;
    this.path = join(directory, 'memory.jsonl');
    this.maxEntryBytes = maxEntryBytes;
    this.maxActiveBytes = maxActiveBytes;
    this.maxItems = maxItems;
    this.queue = Promise.resolve();
  }

  serialize(work) {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }

  async ensure() {
    return this.serialize(async () => {
      try { return await this.read(); }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await chmod(this.directory, 0o700);
      const handle = await open(this.path, 'ax', 0o600);
      await handle.close();
      await chmod(this.path, 0o600);
      const event = {
        schema: SCHEMA, sequence: 1, recordedAt: new Date().toISOString(), type: 'memory_started',
      };
      await appendFile(this.path, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
      return this.read();
    });
  }

  async read() {
    const events = parseEvents(await readFile(this.path, 'utf8'));
    return { events: clone(events), items: project(events), claims: projectClaims(events),
      tombstones: projectTombstones(events) };
  }

  validateCapacity(items) {
    if (items.length > this.maxItems) throw new Error('memory capacity exceeded');
    const total = items.reduce((sum, item) => sum + bytes(item.content), 0);
    if (total > this.maxActiveBytes) throw new Error('memory capacity exceeded');
  }

  async append(type, fields) {
    const current = await this.read();
    const event = {
      schema: SCHEMA, sequence: current.events.length + 1,
      recordedAt: new Date().toISOString(), type, ...clone(fields),
    };
    await appendFile(this.path, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    return event;
  }

  async add({ kind, content, source = null, subjects = [], alwaysRelevant = false } = {}) {
    const nextKind = normalizedKind(kind);
    const nextContent = normalizedContent(content);
    if (bytes(nextContent) > this.maxEntryBytes) throw new Error('memory entry is too large');
    return this.serialize(async () => {
      const current = await this.read();
      const duplicate = current.items.find((item) => item.kind === nextKind && item.content === nextContent);
      if (duplicate) return clone(duplicate);
      this.validateCapacity([...current.items, { kind: nextKind, content: nextContent }]);
      const memoryId = randomUUID();
      const normalizedSubjects = [...subjects].map(String).slice(0, 8);
      const key = primarySubject(normalizedSubjects, memoryId);
      const subjectRevision = Math.max(0, ...current.items.filter((item) => (
        primarySubject(item.subjects, item.memoryId) === key
      )).map((item) => Number(item.subjectRevision ?? 0))) + 1;
      const event = await this.append('memory_added', {
        memoryId, kind: nextKind, content: nextContent, source,
        subjects: normalizedSubjects, alwaysRelevant: alwaysRelevant === true,
        subjectRevision, sourceOrder: current.events.length + 1,
      });
      return {
        memoryId, kind: nextKind, content: nextContent, source: clone(source),
        subjects: normalizedSubjects, alwaysRelevant: alwaysRelevant === true,
        subjectRevision, sourceOrder: event.sourceOrder,
        createdAt: event.recordedAt, updatedAt: event.recordedAt,
      };
    });
  }

  async replace({ memoryId, kind, content, source = null, subjects = null, alwaysRelevant = null } = {}) {
    const id = String(memoryId ?? '');
    const nextContent = normalizedContent(content);
    if (bytes(nextContent) > this.maxEntryBytes) throw new Error('memory entry is too large');
    return this.serialize(async () => {
      const current = await this.read();
      const previous = current.items.find((item) => item.memoryId === id);
      if (!previous) throw new Error('memory not found');
      const nextKind = kind == null ? previous.kind : normalizedKind(kind);
      if (previous.kind === nextKind && previous.content === nextContent) return clone(previous);
      const nextItems = current.items.map((item) => item.memoryId === id
        ? { ...item, kind: nextKind, content: nextContent } : item);
      this.validateCapacity(nextItems);
      const normalizedSubjects = subjects == null ? previous.subjects : [...subjects].map(String).slice(0, 8);
      const key = primarySubject(normalizedSubjects, id);
      const subjectRevision = Math.max(Number(previous.subjectRevision ?? 0),
        ...current.items.filter((item) => item.memoryId !== id
          && primarySubject(item.subjects, item.memoryId) === key)
          .map((item) => Number(item.subjectRevision ?? 0))) + 1;
      const event = await this.append('memory_replaced', {
        memoryId: id, kind: nextKind, content: nextContent, source,
        subjects: normalizedSubjects,
        alwaysRelevant: alwaysRelevant == null ? previous.alwaysRelevant === true : alwaysRelevant === true,
        subjectRevision, sourceOrder: current.events.length + 1,
      });
      return { ...previous, kind: nextKind, content: nextContent, source: clone(source),
        subjects: clone(event.subjects), alwaysRelevant: event.alwaysRelevant,
        subjectRevision, sourceOrder: event.sourceOrder, updatedAt: event.recordedAt };
    });
  }

  async remove({ memoryId, source = null } = {}) {
    const id = String(memoryId ?? '');
    return this.serialize(async () => {
      const current = await this.read();
      const previous = current.items.find((item) => item.memoryId === id);
      if (!previous) throw new Error('memory not found');
      await this.append('memory_removed', { memoryId: id, source });
      return clone(previous);
    });
  }

  async commitClaim({ claim: input } = {}) {
    const candidate = makeMemoryClaim(input);
    return this.serialize(async () => {
      const current = await this.read();
      const blockingTombstone = current.tombstones.find((tombstone) => (
        tombstone.subjectKey === candidate.subjectKey
      ));
      if (blockingTombstone) throw new Error('MemoryClaim subject is fenced by active forget tombstone');
      if (current.items.some((item) => item.memoryId === candidate.memoryId)) {
        throw new Error('MemoryClaim memoryId already exists');
      }
      const sameSubject = current.items.filter((item) => (
        (item.temporal?.subjectKey ?? primarySubject(item.subjects, item.memoryId)) === candidate.subjectKey
      ));
      const expectedRevision = Math.max(0, ...sameSubject.map((item) => Number(item.subjectRevision ?? 0))) + 1;
      if (candidate.subjectRevision !== expectedRevision) {
        throw new Error(`MemoryClaim subjectRevision must be ${expectedRevision}`);
      }
      const expectedOrder = current.events.length + 1;
      if (candidate.sourceOrder !== expectedOrder) {
        throw new Error(`MemoryClaim sourceOrder must be ${expectedOrder}`);
      }
      for (const targetId of candidate.supersedes) {
        const target = current.items.find((item) => item.memoryId === targetId);
        if (!target) throw new Error(`MemoryClaim supersedes target not found: ${targetId}`);
        const targetSubject = target.temporal?.subjectKey ?? primarySubject(target.subjects, target.memoryId);
        if (targetSubject !== candidate.subjectKey) throw new Error('MemoryClaim supersedes target subject mismatch');
      }
      const legacyKind = candidate.scope.workId || candidate.scope.projectId ? 'work' : 'user';
      const nextItem = { kind: legacyKind, content: candidate.value };
      this.validateCapacity([
        ...current.items.filter((item) => !candidate.supersedes.includes(item.memoryId)), nextItem,
      ]);
      const firstSource = candidate.sources[0];
      await this.append('memory_added', {
        recordedAt: candidate.recordedAt,
        memoryId: candidate.memoryId,
        kind: legacyKind,
        content: candidate.value,
        source: {
          recordId: firstSource.recordId,
          sourceKind: firstSource.sourceKind,
          sourceStore: firstSource.sourceStore,
          sourceId: firstSource.sourceId,
          sourceRevision: firstSource.sourceRevision,
        },
        subjects: [candidate.subjectKey],
        alwaysRelevant: candidate.alwaysRelevant,
        subjectRevision: candidate.subjectRevision,
        sourceOrder: candidate.sourceOrder,
        temporal: {
          claimKind: candidate.kind,
          subjectKey: candidate.subjectKey,
          scope: clone(candidate.scope),
          validFrom: candidate.validFrom,
          validTo: candidate.validTo,
          status: candidate.status,
          supersedes: clone(candidate.supersedes),
          conflictsWith: clone(candidate.conflictsWith),
          sensitivity: candidate.sensitivity,
        },
        recordRefs: clone(candidate.sources),
      });
      return clone((await this.read()).items.find((item) => item.memoryId === candidate.memoryId));
    });
  }

  async retractClaim({ memoryId, recordRefs } = {}) {
    const id = String(memoryId ?? '');
    if (!Array.isArray(recordRefs) || !recordRefs.length) {
      throw new TypeError('MemoryClaim retraction requires RecordRef');
    }
    const references = recordRefs.map(validateRecordReference);
    return this.serialize(async () => {
      const current = await this.read();
      const previous = current.items.find((item) => item.memoryId === id);
      if (!previous) throw new Error('memory not found');
      await this.append('memory_removed', {
        memoryId: id,
        source: { recordId: references[0].recordId },
        recordRefs: references,
      });
      return clone(previous);
    });
  }

  async forgetClaim({ requestId, memoryId, expectedRevision, recordRefs, reversibleUntil, recordedAt } = {}) {
    const id = String(memoryId ?? ''); const request = String(requestId ?? '');
    if (!request || !Array.isArray(recordRefs) || !recordRefs.length) {
      throw new TypeError('forget claim requires request identity and RecordRef');
    }
    const references = recordRefs.map(validateRecordReference);
    return this.serialize(async () => {
      const current = await this.read();
      const claim = current.claims.find((item) => item.memoryId === id && item.status === 'active');
      if (!claim) throw new Error('active MemoryClaim not found');
      if (claim.subjectRevision !== expectedRevision) throw new Error('MemoryClaim revision changed after preview');
      await this.append('memory_removed', {
        ...(recordedAt ? { recordedAt } : {}),
        memoryId: id, source: { recordId: references[0].recordId }, recordRefs: references,
        tombstone: {
          requestId: request, memoryId: id, subjectKey: claim.subjectKey,
          targetRevision: claim.subjectRevision, reversibleUntil: reversibleUntil ?? null,
        },
      });
      return clone(claim);
    });
  }

  async restoreForgottenClaim({ requestId, memoryId, recordRefs, recordedAt } = {}) {
    const id = String(memoryId ?? ''); const request = String(requestId ?? '');
    if (!request || !Array.isArray(recordRefs) || !recordRefs.length) {
      throw new TypeError('restore claim requires request identity and RecordRef');
    }
    const references = recordRefs.map(validateRecordReference);
    return this.serialize(async () => {
      const current = await this.read();
      const tombstone = current.tombstones.find((item) => item.memoryId === id && item.requestId === request);
      if (!tombstone) throw new Error('forget tombstone not found');
      const prior = current.claims.find((item) => item.memoryId === id);
      if (!prior || prior.status !== 'retracted') throw new Error('retracted MemoryClaim not found');
      const sourceOrder = current.events.length + 1;
      const subjectRevision = Math.max(0, ...current.claims.filter((item) => item.subjectKey === prior.subjectKey)
        .map((item) => Number(item.subjectRevision))) + 1;
      const restored = makeMemoryClaim({
        ...prior, status: 'active', subjectRevision, sourceOrder,
        recordedAt: recordedAt ?? new Date().toISOString(),
        sources: [...prior.sources, ...references], supersedes: [], conflictsWith: [],
      });
      const legacyKind = restored.scope.workId || restored.scope.projectId ? 'work' : 'user';
      await this.append('memory_added', {
        recordedAt: restored.recordedAt, memoryId: restored.memoryId, kind: legacyKind,
        content: restored.value,
        source: { recordId: restored.sources[0].recordId, sourceKind: restored.sources[0].sourceKind,
          sourceStore: restored.sources[0].sourceStore, sourceId: restored.sources[0].sourceId,
          sourceRevision: restored.sources[0].sourceRevision },
        subjects: [restored.subjectKey], alwaysRelevant: restored.alwaysRelevant,
        subjectRevision, sourceOrder,
        temporal: { claimKind: restored.kind, subjectKey: restored.subjectKey, scope: clone(restored.scope),
          validFrom: restored.validFrom, validTo: restored.validTo, status: 'active', supersedes: [],
          conflictsWith: [], sensitivity: restored.sensitivity, restoresForgetRequestId: request },
        recordRefs: clone(restored.sources),
      });
      return clone((await this.read()).claims.find((item) => item.memoryId === id));
    });
  }
}
