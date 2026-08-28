import { lstat, rm } from 'node:fs/promises';
import { assertAuthoringVerification } from './authoring-verify.js';

const SETTLED = new WeakSet();

export async function settleAuthoringTransaction({ verification: rawVerification,
  coordinator, removeScratch = rm } = {}) {
  const verification = assertAuthoringVerification(rawVerification);
  const transaction = verification.transaction; const admission = transaction.admission;
  const released = await coordinator.release(admission);
  if (released.released !== admission.claims.length) {
    transaction.state = 'partial_effect_unknown';
    return { settlement: null, receipt: { state: 'partial_effect_unknown',
      planId: admission.prepared.plan.planId, reason: 'target_lock_release_unconfirmed' } };
  }
  try {
    await removeScratch(admission.prepared.directory, { recursive: true, force: true });
    const remains = await lstat(admission.prepared.directory).then(() => true).catch((error) => (
      error?.code === 'ENOENT' ? false : Promise.reject(error)
    ));
    if (remains) throw new Error('authoring scratch cleanup incomplete');
  } catch {
    transaction.state = 'partial_effect_unknown';
    return { settlement: null, receipt: { state: 'partial_effect_unknown',
      planId: admission.prepared.plan.planId, reason: 'scratch_cleanup_unconfirmed',
      targetLocksReleased: true } };
  }
  const settlement = { schema: 't5.authoring-settlement.v1', verification,
    rollbackPointers: transaction.pointers, state: 'published_verified',
    settledAt: new Date().toISOString() };
  SETTLED.add(settlement); transaction.state = 'settled'; verification.state = 'settled';
  return { settlement, receipt: { state: 'published_verified',
    planId: admission.prepared.plan.planId, verifiedTargets: verification.targets.length,
    undoAvailableTargets: transaction.pointers.size, targetLocksReleased: true,
    scratchCleaned: true } };
}

export function assertAuthoringSettlement(value) {
  if (!SETTLED.has(value) || value.state !== 'published_verified') {
    throw new TypeError('published verified authoring settlement required');
  }
  return value;
}
