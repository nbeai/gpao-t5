// L4 · Delivery 원장 저장소(P6-14) — 파일 기반. {deliveries}. 의존성 0.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { atomicWritePrivate, serializeByFile } from './versioned-json-store.js';

export function defaultDeliveryDir() {
  return process.env.GPAO_T5_DATA_DIR ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions');
}

function deliveryIdentity(entry) {
  return createHash('sha256').update(JSON.stringify({
    runRef: entry.runRef, jobRef: entry.jobRef, target: entry.target,
    contentDigest: entry.contentDigest,
  })).digest('hex');
}

function validateAutomationDelivery(entry) {
  if (entry?.kind !== 'automation_local_delivery') return;
  if (typeof entry.deliveryRef !== 'string' || entry.deliveryRef !== deliveryIdentity(entry)
    || typeof entry.runRef !== 'string' || typeof entry.jobRef !== 'string'
    || !/^[a-f0-9]{64}$/.test(entry.contentDigest ?? '')
    || entry.target?.kind !== 'local_conversation'
    || typeof entry.target.conversationRef !== 'string'
    || typeof entry.target.principalRef !== 'string'
    || !Number.isFinite(entry.target.conversationCreatedAt)
    || !Array.isArray(entry.attempts)
    || !entry.attempts.every((attempt) => typeof attempt?.attemptRef === 'string' && Number.isFinite(attempt.at))
    || new Set(entry.attempts.map((attempt) => attempt.attemptRef)).size !== entry.attempts.length
    || !['attempting', 'delivered', 'failed'].includes(entry.state)) {
    throw new Error('automation delivery record invalid');
  }
  if (entry.state === 'delivered'
    && (entry.receipt?.deliveryRef !== entry.deliveryRef
      || entry.receipt?.contentDigest !== entry.contentDigest
      || entry.receipt?.conversationRef !== entry.target.conversationRef
      || entry.receipt?.exactCount !== 1)) {
    throw new Error('automation delivery receipt invalid');
  }
}

function validateDeliveries(deliveries) {
  if (!Array.isArray(deliveries)) throw new Error('delivery records must be an array');
  const refs = new Set();
  for (const entry of deliveries) {
    validateAutomationDelivery(entry);
    if (entry?.kind !== 'automation_local_delivery') continue;
    if (refs.has(entry.deliveryRef)) throw new Error('automation delivery ref duplicated');
    refs.add(entry.deliveryRef);
  }
}

function assertAppendOnly(previous, next) {
  const nextByRef = new Map(next.filter((entry) => entry?.kind === 'automation_local_delivery')
    .map((entry) => [entry.deliveryRef, entry]));
  for (const before of previous.filter((entry) => entry?.kind === 'automation_local_delivery')) {
    const after = nextByRef.get(before.deliveryRef);
    if (!after) throw new Error('automation delivery record removed');
    for (const key of ['deliveryRef', 'runRef', 'jobRef', 'target', 'contentDigest', 'createdAt']) {
      if (JSON.stringify(after[key]) !== JSON.stringify(before[key])) {
        throw new Error('automation delivery identity changed');
      }
    }
    if (JSON.stringify(after.attempts.slice(0, before.attempts.length)) !== JSON.stringify(before.attempts)) {
      throw new Error('automation delivery attempts are not append-only');
    }
    if (before.state === 'delivered' && JSON.stringify(after) !== JSON.stringify(before)) {
      throw new Error('automation delivery terminal record changed');
    }
  }
}

export class DeliveryStore {
  constructor(dir = defaultDeliveryDir()) {
    this.dir = dir;
    this.file = join(dir, 'deliveries.json');
  }

  async load() {
    try {
      const a = JSON.parse(await readFile(this.file, 'utf8'));
      validateDeliveries(a.deliveries);
      return { deliveries: a.deliveries };
    } catch (error) {
      if (error?.code === 'ENOENT') return { deliveries: [] };
      let corruptBytes = null;
      try { corruptBytes = Buffer.byteLength(await readFile(this.file, 'utf8')); } catch {}
      return { deliveries: [], recovery: {
        corrupted: true, preservedFile: this.file, corruptBytes,
        reason: 'delivery_store_invalid',
      } };
    }
  }

  async save(a) {
    return serializeByFile(this.file, async () => {
      validateDeliveries(a.deliveries);
      await atomicWritePrivate(this.file, { deliveries: a.deliveries });
      const readback = await this.load();
      if (readback.recovery || JSON.stringify(readback.deliveries) !== JSON.stringify(a.deliveries)) {
        throw new Error('automation delivery readback mismatch');
      }
      return a;
    });
  }

  async update(mutator) {
    return serializeByFile(this.file, async () => {
      const current = await this.load();
      if (current.recovery) return current;
      const changed = await mutator(structuredClone(current)) ?? current;
      validateDeliveries(changed.deliveries);
      assertAppendOnly(current.deliveries, changed.deliveries);
      await atomicWritePrivate(this.file, { deliveries: changed.deliveries });
      const readback = await this.load();
      if (readback.recovery || JSON.stringify(readback.deliveries) !== JSON.stringify(changed.deliveries)) {
        throw new Error('automation delivery readback mismatch');
      }
      return readback;
    });
  }
}
