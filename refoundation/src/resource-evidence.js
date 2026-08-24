import { createHash } from 'node:crypto';

const VOLATILE_KEYS = new Set([
  'toolCallId', 'messageId', 'runId', 'receiptId', 'idempotencyKey',
  'timestamp', 'recordedAt', 'createdAt', 'updatedAt', 'sentAt', 'deliveredAt',
  'startedAt', 'endedAt', 'durationMs', 'wallMs',
]);

function updateFingerprint(hash, value) {
  if (value === null) { hash.update('null;'); return; }
  if (Array.isArray(value)) {
    hash.update(`array:${value.length}[`);
    for (const item of value) updateFingerprint(hash, item);
    hash.update(']'); return;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).filter((key) => !VOLATILE_KEYS.has(key)).sort();
    hash.update(`object:${keys.length}{`);
    for (const key of keys) {
      hash.update(`key:${Buffer.byteLength(key, 'utf8')}:`); hash.update(key);
      updateFingerprint(hash, value[key]);
    }
    hash.update('}'); return;
  }
  const serialized = typeof value === 'string' ? value : String(value);
  hash.update(`${typeof value}:${Buffer.byteLength(serialized, 'utf8')}:`); hash.update(serialized);
}

/** Returns a transient digest. The digest itself is never persisted in ResourceLedger. */
export function evidenceFingerprint(receipt) {
  if (receipt?.outcome !== 'succeeded' || !receipt?.actualCall) return null;
  const evidence = {
    name: receipt.actualCall.name ?? receipt.requestedCall?.name ?? 'unknown',
    result: receipt.result ?? null,
  };
  const hash = createHash('sha256'); updateFingerprint(hash, evidence); return hash.digest('hex');
}
