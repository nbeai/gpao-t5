import { createHash } from 'node:crypto';

function blockerForReceipt(receipt) {
  if (receipt?.outcome === 'failed') return 'failed';
  if (receipt?.outcome === 'unknown' || receipt?.result?.effectUnknown === true) return 'effect_unknown';
  if (receipt?.result?.state === 'approval_required') return 'approval_pending';
  if (['handoff_required', 'user_action_required', 'connection_required'].includes(receipt?.result?.state)) {
    return 'handoff_pending';
  }
  if (receipt?.result?.delivery?.sent === false || receipt?.result?.delivered === false) return 'delivery_missing';
  if (receipt?.result?.verificationMissing === true) return 'requested_evidence_missing';
  return null;
}

export function evaluateWorkCompletion({ proposedOutcome, receipts = [], facts = {} } = {}) {
  const blockers = receipts.map(blockerForReceipt).filter(Boolean);
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
