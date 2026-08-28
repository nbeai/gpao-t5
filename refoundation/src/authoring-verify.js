import { readFile } from 'node:fs/promises';
import { assertPublishedAuthoring } from './authoring-publish.js';
import { observePublicationPreimage } from './atomic-file-publication.js';
import { restoreExactTargetRollback } from './exact-target-rollback.js';
import { validateAuthoringFormat } from './authoring-prepare.js';

const VERIFIED = new WeakSet();
async function rollback(transaction, coordinator, restore) {
  let restored = 0; let unknown = false;
  for (const item of [...transaction.applied].reverse()) {
    try {
      const result = await restore({ pointer: item.pointer, expectedPostimage: item.expectedPostimage });
      if (!['restored', 'removed_created_target'].includes(result.state)) unknown = true; else restored += 1;
    } catch { unknown = true; }
  }
  await coordinator.release(transaction.admission);
  transaction.state = unknown ? 'partial_effect_unknown' : 'rolled_back_verified';
  return { state: transaction.state, restoredTargets: restored, targetLocksReleased: true };
}

export async function verifyAuthoringTransaction({ transaction: rawTransaction, coordinator,
  relationVerifier = async () => ({ state: 'not_required' }),
  restore = restoreExactTargetRollback } = {}) {
  const transaction = assertPublishedAuthoring(rawTransaction); const plan = transaction.admission.prepared.plan;
  const candidates = new Map(transaction.admission.prepared.candidates.map((item) => [item.operationIndex, item]));
  const targets = [];
  try {
    for (let index = 0; index < plan.operations.length; index += 1) {
      const operation = plan.operations[index];
      if (['create', 'modify'].includes(operation.type)) {
        const actual = await observePublicationPreimage(operation.path); const candidate = candidates.get(index);
        if (!actual || actual.sha256 !== candidate.sha256) throw new Error('authoring target hash mismatch');
        const validation = await validateAuthoringFormat(operation, await readFile(operation.path));
        targets.push({ type: operation.type, path: operation.path, state: 'verified',
          sha256: actual.sha256, validation });
      } else if (operation.type === 'delete') {
        if (await observePublicationPreimage(operation.path) !== null) throw new Error('authoring deleted target remains');
        targets.push({ type: 'delete', path: operation.path, state: 'verified_absent' });
      } else if (operation.type === 'move') {
        if (await observePublicationPreimage(operation.path) !== null) throw new Error('authoring move source remains');
        const actual = await observePublicationPreimage(operation.to);
        if (!actual || actual.sha256 !== operation.preimage.sha256) throw new Error('authoring move target mismatch');
        targets.push({ type: 'move', path: operation.path, to: operation.to,
          state: 'verified', sha256: actual.sha256 });
      }
    }
    const relation = await relationVerifier({ planId: plan.planId,
      targets: targets.map((item) => ({ type: item.type, state: item.state, sha256: item.sha256 ?? null })) });
    if (!relation || !['verified', 'not_required'].includes(relation.state)) {
      throw new Error('authoring cross-file relation failed');
    }
    const verification = { schema: 't5.authoring-verification.v1', transaction,
      state: 'verified', targets, relation, verifiedAt: new Date().toISOString() };
    VERIFIED.add(verification); transaction.state = 'verified';
    return { verification, receipt: { state: 'published_verified_pending_settlement',
      planId: plan.planId, verifiedTargets: targets.length, relation: relation.state } };
  } catch (error) {
    const settled = await rollback(transaction, coordinator, restore);
    return { verification: null, receipt: { ...settled, planId: plan.planId,
      verificationError: error?.message ?? 'verification_failed' } };
  }
}

export function assertAuthoringVerification(value) {
  if (!VERIFIED.has(value) || value.state !== 'verified') throw new TypeError('verified authoring required');
  return value;
}
