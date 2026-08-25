import { createHash } from 'node:crypto';
import { validExecutableOperationRecovery } from './executable-operation-attempt-recovery.js';

function recoveredFailure(receipts, index) {
  const failed = receipts[index];
  const effectKind = failed?.actualCall?.args?.effect?.kind ?? failed?.requestedCall?.args?.effect?.kind ?? null;
  if (effectKind && effectKind !== 'observe') return false;
  const finalEvidence = receipts.slice(index + 1).findLast((receipt) => (
    !['work_completion', 'tool_search', 'learning_trial'].includes(
      receipt?.requestedCall?.name ?? receipt?.actualCall?.name,
    )
  ));
  return finalEvidence?.outcome === 'succeeded'
    && finalEvidence?.result?.effectUnknown !== true
    && !['approval_required', 'handoff_required', 'user_action_required',
      'connection_required'].includes(finalEvidence?.result?.state)
    && (finalEvidence?.actualCall?.args?.effect?.kind
      ?? finalEvidence?.requestedCall?.args?.effect?.kind ?? 'observe') === 'observe';
}

function blockerForReceipt(receipt, index, receipts) {
  const recoveredAttempt = receipts.slice(index + 1).some((candidate, offset) => (
    validExecutableOperationRecovery(receipts, index + 1 + offset, index)
  ));
  if (recoveredAttempt) return null;
  if (receipt?.outcome === 'failed') return recoveredFailure(receipts, index) ? null : 'failed';
  if (receipt?.outcome === 'unknown' || receipt?.result?.effectUnknown === true) return 'effect_unknown';
  if (receipt?.result?.state === 'approval_required') return 'approval_pending';
  if (['handoff_required', 'user_action_required', 'connection_required'].includes(receipt?.result?.state)) {
    return 'handoff_pending';
  }
  if (receipt?.result?.delivery?.sent === false || receipt?.result?.delivered === false) return 'delivery_missing';
  if (receipt?.result?.verificationMissing === true) {
    return 'requested_evidence_missing';
  }
  return null;
}

export function evaluateWorkCompletion({ proposedOutcome, receipts = [], facts = {} } = {}) {
  const blockers = receipts.map((receipt, index) => blockerForReceipt(receipt, index, receipts)).filter(Boolean);
  for (const blocker of facts.inputSettlementBlockers ?? []) blockers.push(blocker);
  if (facts.staleRevision) blockers.push('stale_revision');
  if (facts.claimMismatch) blockers.push('execution_claim_mismatch');
  if (facts.approvalPending) blockers.push('approval_pending');
  if (facts.handoffPending) blockers.push('handoff_pending');
  if (facts.deliveryMissing) blockers.push('delivery_missing');
  if (facts.requestedEvidenceMissing) blockers.push('requested_evidence_missing');
  const unique = [...new Set(blockers)].toSorted();
  const verifiedOutcome = proposedOutcome === 'achieved' && unique.length === 0 ? 'achieved' : 'unresolved';
  const blockerDigest = createHash('sha256').update(JSON.stringify(unique)).digest('hex');
  return { proposedOutcome, verifiedOutcome, blockers: unique, blockerDigest };
}
