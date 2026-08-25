import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExecutableOperationAttemptRecovery } from '../src/executable-operation-attempt-recovery.js';
import { evaluateWorkCompletion } from '../src/work-completion-evaluator.js';

const H = 'operation-a'; const SHA = 'a'.repeat(64); const ROOT = '/tmp/t5-operation/source';
const begin = { toolCallId: 'begin', requestedCall: { name: 'attachment', args: {
  action: 'begin_executable_output',
} }, outcome: 'succeeded', result: { state: 'executable_output_started', operationHandle: H } };
function final(relation, overrides = {}) {
  return { toolCallId: 'final', requestedCall: { name: 'attachment', args: {
    action: 'finalize_executable_output', operationHandle: H,
  } }, outcome: 'succeeded', result: { state: 'registered', qualification: { passed: true },
    artifact: { attachmentId: overrides.attachmentId ?? 'artifact-a', sha256: overrides.sha ?? SHA },
    receiptRecovery: { kind: 'exact_operation', operationHandle: H, status: 'resolved',
      artifactSha256: overrides.sha ?? SHA },
    attemptRecovery: relation } };
}

test('runtime-owned begin→finalize relation만 같은 window의 실패와 exact pending approval을 회복한다', async () => {
  const failed = { toolCallId: 'failed', requestedCall: { name: 'exec', args: {
    effect: { kind: 'local_change', targets: [`${ROOT}/app.js`] },
  } }, actualCall: { name: 'exec', args: { effect: {
    kind: 'local_change', targets: [`${ROOT}/app.js`],
  } } }, outcome: 'failed', result: {} };
  const approval = { toolCallId: 'approval', requestedCall: { name: 'exec', args: {
    effect: { kind: 'destructive', targets: [`${ROOT}/old.txt`] },
  } }, actualCall: null, outcome: 'not_executed', result: {
    state: 'approval_required', pendingId: 'pending-a',
  } };
  const withdrawn = [];
  const relation = await buildExecutableOperationAttemptRecovery({
    priorReceipts: [begin, failed, approval], operationHandle: H, finalizeToolCallId: 'final',
    artifact: { attachmentId: 'artifact-a', sha256: SHA }, qualification: { passed: true },
    sourceDirectory: ROOT, withdrawPendingApproval: async (id) => {
      withdrawn.push(id); return { withdrawn: true };
    },
  });
  assert.deepEqual(withdrawn, ['pending-a']);
  const result = evaluateWorkCompletion({ proposedOutcome: 'achieved',
    receipts: [begin, failed, approval, final(relation)] });
  assert.equal(result.verifiedOutcome, 'achieved'); assert.deepEqual(result.blockers, []);
});

test('다른 handle·artifact mismatch·unknown·external effect·scope 밖 approval은 회복하지 않는다', async () => {
  const fixtures = [
    { toolCallId: 'unknown', outcome: 'unknown', result: { effectUnknown: true } },
    { toolCallId: 'external', requestedCall: { name: 'exec', args: { effect: {
      kind: 'external_send', targets: ['recipient'],
    } } }, actualCall: { name: 'exec', args: { effect: {
      kind: 'external_send', targets: ['recipient'],
    } } }, outcome: 'failed', result: {} },
    { toolCallId: 'outside-approval', requestedCall: { name: 'exec', args: { effect: {
      kind: 'destructive', targets: ['/tmp/outside.txt'],
    } } }, actualCall: null, outcome: 'not_executed', result: {
      state: 'approval_required', pendingId: 'pending-outside',
    } },
  ];
  let withdrawalCalls = 0;
  const relation = await buildExecutableOperationAttemptRecovery({
    priorReceipts: [begin, ...fixtures], operationHandle: H, finalizeToolCallId: 'final',
    artifact: { attachmentId: 'artifact-a', sha256: SHA }, qualification: { passed: true },
    sourceDirectory: ROOT, withdrawPendingApproval: async () => {
      withdrawalCalls += 1; return { withdrawn: true };
    },
  });
  assert.equal(withdrawalCalls, 0);
  const result = evaluateWorkCompletion({ proposedOutcome: 'achieved',
    receipts: [begin, ...fixtures, final(relation)] });
  assert.equal(result.verifiedOutcome, 'unresolved');
  assert.ok(result.blockers.includes('effect_unknown'));
  assert.ok(result.blockers.includes('failed'));
  assert.ok(result.blockers.includes('approval_pending'));

  const mismatched = structuredClone(relation); mismatched.operationHandle = 'operation-b';
  const failed = { toolCallId: 'failed', requestedCall: { name: 'exec', args: {
    effect: { kind: 'local_change', targets: [`${ROOT}/x`] },
  } }, outcome: 'failed', result: {} };
  mismatched.supersededAttemptRange.attempts.push({ toolCallId: 'failed', kind: 'operation_attempt_failure' });
  assert.equal(evaluateWorkCompletion({ proposedOutcome: 'achieved',
    receipts: [begin, failed, final(mismatched)] }).verifiedOutcome, 'unresolved');
  assert.equal(evaluateWorkCompletion({ proposedOutcome: 'achieved',
    receipts: [begin, failed, final(relation, { sha: 'b'.repeat(64) })] }).verifiedOutcome, 'unresolved');
});
