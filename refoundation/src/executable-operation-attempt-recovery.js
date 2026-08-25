import { isAbsolute, relative, resolve } from 'node:path';

const SCHEMA = 't5.executable-operation-attempt-recovery.v1';

function callName(receipt) { return receipt?.requestedCall?.name ?? receipt?.actualCall?.name ?? null; }
function callAction(receipt) {
  return receipt?.requestedCall?.args?.action ?? receipt?.actualCall?.args?.action ?? null;
}
function effect(receipt) {
  return receipt?.actualCall?.args?.effect ?? receipt?.requestedCall?.args?.effect ?? null;
}
function inside(root, candidate) {
  if (!root || !isAbsolute(String(candidate ?? ''))) return false;
  const rel = relative(resolve(root), resolve(String(candidate)));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
function forbidden(receipt) {
  if (receipt?.outcome === 'unknown' || receipt?.result?.effectUnknown === true) return true;
  if (['handoff_required', 'user_action_required', 'connection_required'].includes(receipt?.result?.state)) return true;
  if (receipt?.result?.delivery || receipt?.result?.delivered === false) return true;
  return ['external_send', 'external_change', 'payment', 'secret_input'].includes(effect(receipt)?.kind);
}
function exactBegin(receipt, operationHandle) {
  return receipt?.outcome === 'succeeded'
    && callName(receipt) === 'attachment'
    && callAction(receipt) === 'begin_executable_output'
    && receipt?.result?.operationHandle === operationHandle
    && receipt?.result?.state === 'executable_output_started';
}

export async function buildExecutableOperationAttemptRecovery({
  priorReceipts = [], operationHandle, finalizeToolCallId, artifact, qualification,
  sourceDirectory, withdrawPendingApproval,
} = {}) {
  if (!operationHandle || !finalizeToolCallId || qualification?.passed !== true
    || !artifact?.attachmentId || !/^[0-9a-f]{64}$/u.test(String(artifact?.sha256 ?? ''))) return null;
  const beginIndex = priorReceipts.findLastIndex((receipt) => exactBegin(receipt, operationHandle));
  if (beginIndex < 0) return null;
  const begin = priorReceipts[beginIndex]; const attempts = []; const withdrawnApprovalIds = [];
  if (!begin.toolCallId) return null;
  for (const receipt of priorReceipts.slice(beginIndex + 1)) {
    if (!receipt?.toolCallId || forbidden(receipt)) continue;
    const sameVerification = callName(receipt) === 'attachment'
      && callAction(receipt) === 'finalize_executable_output'
      && receipt?.result?.receiptRecovery?.kind === 'exact_operation'
      && receipt.result.receiptRecovery.operationHandle === operationHandle
      && receipt.result.receiptRecovery.status === 'open'
      && receipt.result.verificationMissing === true;
    if (sameVerification) {
      attempts.push({ toolCallId: receipt.toolCallId, kind: 'same_operation_verification' });
      continue;
    }
    if (receipt.outcome === 'failed') {
      attempts.push({ toolCallId: receipt.toolCallId, kind: 'operation_attempt_failure' });
      continue;
    }
    const approval = receipt.outcome === 'not_executed'
      && receipt.actualCall == null && receipt.result?.state === 'approval_required';
    if (!approval || typeof withdrawPendingApproval !== 'function') continue;
    const targets = effect(receipt)?.targets;
    if (!Array.isArray(targets) || !targets.length
      || !targets.every((target) => inside(sourceDirectory, target))) continue;
    const withdrawn = await withdrawPendingApproval(receipt.result.pendingId);
    if (withdrawn?.withdrawn !== true) continue;
    withdrawnApprovalIds.push(receipt.result.pendingId);
    attempts.push({ toolCallId: receipt.toolCallId, kind: 'withdrawn_managed_scratch_approval',
      pendingId: receipt.result.pendingId });
  }
  return {
    schema: SCHEMA, operationHandle, beginToolCallId: begin.toolCallId, finalizeToolCallId,
    artifact: { attachmentId: artifact.attachmentId, sha256: artifact.sha256 },
    supersededAttemptRange: { attempts, withdrawnApprovalIds },
  };
}

export function validExecutableOperationRecovery(receipts, finalIndex, attemptIndex) {
  const final = receipts[finalIndex]; const attempt = receipts[attemptIndex];
  const relation = final?.result?.attemptRecovery;
  if (relation?.schema !== SCHEMA || finalIndex <= attemptIndex
    || final?.outcome !== 'succeeded' || final?.result?.state !== 'registered'
    || final?.result?.qualification?.passed !== true
    || callName(final) !== 'attachment' || callAction(final) !== 'finalize_executable_output'
    || final?.requestedCall?.args?.operationHandle !== relation.operationHandle
    || final?.result?.receiptRecovery?.status !== 'resolved'
    || final?.result?.receiptRecovery?.operationHandle !== relation.operationHandle
    || relation.finalizeToolCallId !== final.toolCallId
    || relation.artifact?.attachmentId !== final?.result?.artifact?.attachmentId
    || relation.artifact?.sha256 !== final?.result?.artifact?.sha256
    || !/^[0-9a-f]{64}$/u.test(String(relation.artifact?.sha256 ?? ''))) return false;
  const beginIndex = receipts.findIndex((receipt) => receipt?.toolCallId === relation.beginToolCallId);
  if (beginIndex < 0 || beginIndex >= attemptIndex || !exactBegin(receipts[beginIndex], relation.operationHandle)) return false;
  const record = relation.supersededAttemptRange?.attempts?.find(
    (item) => item?.toolCallId === attempt?.toolCallId,
  );
  if (!record || forbidden(attempt)) return false;
  if (record.kind === 'same_operation_verification') {
    return callName(attempt) === 'attachment'
      && callAction(attempt) === 'finalize_executable_output'
      && attempt?.result?.receiptRecovery?.operationHandle === relation.operationHandle
      && attempt?.result?.verificationMissing === true;
  }
  if (record.kind === 'operation_attempt_failure') return attempt?.outcome === 'failed';
  return record.kind === 'withdrawn_managed_scratch_approval'
    && attempt?.outcome === 'not_executed' && attempt?.result?.state === 'approval_required'
    && record.pendingId === attempt?.result?.pendingId
    && relation.supersededAttemptRange.withdrawnApprovalIds?.includes(record.pendingId);
}
