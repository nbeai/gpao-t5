import { createHash } from 'node:crypto';

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

function recoveredExactOperation(receipts, index) {
  const failed = receipts[index];
  const prior = failed?.result?.receiptRecovery;
  const priorAction = failed?.requestedCall?.args?.action ?? failed?.actualCall?.args?.action;
  if (failed?.requestedCall?.name !== 'attachment'
    || priorAction !== 'finalize_executable_output'
    || prior?.kind !== 'exact_operation' || prior?.status !== 'open'
    || !String(prior.operationHandle ?? '')) return false;
  return receipts.slice(index + 1).some((receipt) => {
    const recovery = receipt?.result?.receiptRecovery;
    const action = receipt?.requestedCall?.args?.action ?? receipt?.actualCall?.args?.action;
    const artifactSha256 = receipt?.result?.artifact?.sha256;
    return receipt?.requestedCall?.name === 'attachment'
      && action === priorAction
      && receipt.outcome === 'succeeded'
      && receipt.result?.state === 'registered'
      && receipt.result?.qualification?.passed === true
      && receipt.result?.effectUnknown !== true
      && recovery?.kind === 'exact_operation'
      && recovery?.status === 'resolved'
      && recovery?.operationHandle === prior.operationHandle
      && typeof artifactSha256 === 'string'
      && /^[0-9a-f]{64}$/u.test(artifactSha256)
      && recovery.artifactSha256 === artifactSha256;
  });
}

function blockerForReceipt(receipt, index, receipts) {
  if (receipt?.outcome === 'failed') return recoveredFailure(receipts, index) ? null : 'failed';
  if (receipt?.outcome === 'unknown' || receipt?.result?.effectUnknown === true) return 'effect_unknown';
  if (receipt?.result?.state === 'approval_required') return 'approval_pending';
  if (['handoff_required', 'user_action_required', 'connection_required'].includes(receipt?.result?.state)) {
    return 'handoff_pending';
  }
  if (receipt?.result?.delivery?.sent === false || receipt?.result?.delivered === false) return 'delivery_missing';
  if (receipt?.result?.verificationMissing === true) {
    return recoveredExactOperation(receipts, index) ? null : 'requested_evidence_missing';
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
