import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkStore } from '../src/work-store.js';
import { makeWorkCompletionTool } from '../src/work-completion-tool.js';
import { evaluateWorkCompletion } from '../src/work-completion-evaluator.js';

async function fixture() {
  const store = new WorkStore(await mkdtemp(join(tmpdir(), 't5-work-completion-')));
  const work = await store.create({ sessionId: 'session', sourceMessageId: 'message' });
  await store.claimExecution({ workId: work.workId, revision: 1, runId: 'run' });
  return { store, work, tool: makeWorkCompletionTool({ store, runId: 'run' }) };
}

test('모델이 명시적 achieved를 제안하고 blocker Receipt가 없을 때만 achieved 후보가 된다', async () => {
  const { store, tool } = await fixture();
  const result = await tool.execute({ outcome: 'achieved', inputSettlements: [] }, { priorReceipts: [] });
  assert.equal(result.verifiedOutcome, 'achieved');
  assert.equal((await store.proposalForRun('run')).verifiedOutcome, 'achieved');
});

test('effect unknown·미복구 failed Receipt가 있으면 모델 achieved 제안도 unresolved로 정산한다', async () => {
  for (const receipt of [
    { outcome: 'unknown', result: {} },
    { outcome: 'succeeded', result: { effectUnknown: true } },
    { outcome: 'failed', result: {} },
  ]) {
    const { tool } = await fixture();
    const result = await tool.execute({ outcome: 'achieved', inputSettlements: [] }, { priorReceipts: [receipt] });
    assert.equal(result.verifiedOutcome, 'unresolved');
  }
});

test('OpenAI strict function schema는 모든 property를 required로 선언하고 busy 없는 정본은 빈 배열이다', async () => {
  const { tool } = await fixture();
  assert.deepEqual(tool.parameters.required, ['outcome', 'inputSettlements']);
  assert.deepEqual(Object.keys(tool.parameters.properties).toSorted(),
    [...tool.parameters.required].toSorted());
  assert.equal(tool.parameters.properties.inputSettlements.minItems, 0);
  assert.equal(tool.parameters.properties.inputSettlements.maxItems, 0);
  assert.match(tool.description, /must be an empty array/u);
  const result = await tool.execute({ outcome: 'unresolved', inputSettlements: [] },
    { priorReceipts: [] });
  assert.equal(result.verifiedOutcome, 'unresolved');
  assert.deepEqual(result.inputSettlements, []);
});

test('work_completion schema는 현재 Run의 opaque busy handle 전량만 허용한다', async () => {
  const { store } = await fixture();
  const scope = { handles: () => ['busy_exact_0001', 'busy_exact_0002'],
    evaluate: async () => ({ settlements: [], blockers: [] }) };
  const tool = makeWorkCompletionTool({ store, runId: 'run', inputSettlementScope: scope });
  const array = tool.parameters.properties.inputSettlements;
  assert.equal(array.minItems, 2); assert.equal(array.maxItems, 2);
  assert.deepEqual(array.items.properties.handle.enum, ['busy_exact_0001', 'busy_exact_0002']);
  assert.doesNotMatch(tool.description, /inputId|attachmentId/u);
});

test('실패한 읽기 route 뒤 다른 Hand의 성공 Evidence도 과거 실패만으로 완료를 막지 않는다', () => {
  const evaluation = evaluateWorkCompletion({ proposedOutcome: 'achieved', receipts: [
    { requestedCall: { name: 'exec' }, outcome: 'failed', result: {} },
    { requestedCall: { name: 'exec' }, outcome: 'succeeded', result: { state: 'completed' } },
  ] });
  assert.equal(evaluation.verifiedOutcome, 'achieved'); assert.deepEqual(evaluation.blockers, []);
  const unrelated = evaluateWorkCompletion({ proposedOutcome: 'achieved', receipts: [
    { requestedCall: { name: 'web_read', args: { effect: { kind: 'observe' } } }, outcome: 'failed', result: {} },
    { requestedCall: { name: 'exec', args: { effect: { kind: 'observe' } } },
      outcome: 'succeeded', result: { state: 'completed' } },
  ] });
  assert.equal(unrelated.verifiedOutcome, 'achieved'); assert.deepEqual(unrelated.blockers, []);
  const mutating = evaluateWorkCompletion({ proposedOutcome: 'achieved', receipts: [
    { requestedCall: { name: 'exec', args: { effect: { kind: 'local_change' } } }, outcome: 'failed', result: {} },
    { requestedCall: { name: 'exec', args: { effect: { kind: 'local_change' } } }, outcome: 'succeeded', result: {} },
  ] });
  assert.equal(mutating.verifiedOutcome, 'unresolved'); assert.ok(mutating.blockers.includes('failed'));
  const unknown = evaluateWorkCompletion({ proposedOutcome: 'achieved', receipts: [
    { requestedCall: { name: 'web_read' }, outcome: 'unknown', result: { effectUnknown: true } },
    { requestedCall: { name: 'exec', args: { effect: { kind: 'observe' } } }, outcome: 'succeeded', result: {} },
  ] });
  assert.equal(unknown.verifiedOutcome, 'unresolved'); assert.ok(unknown.blockers.includes('effect_unknown'));
});

test('변경 0인 sandbox probe는 exact non-observe 재실행 성공 뒤에만 완료 blocker에서 내려간다', () => {
  const probe = {
    outcome: 'failed', requestedCall: { name: 'exec', args: {
      command: 'printf x > result.txt', cwd: null, effect: null,
    } }, actualCall: { name: 'exec', args: {
      command: 'printf x > result.txt', cwd: null, effect: null,
    } }, result: { state: 'effect_declaration_required', probeChangedNothing: true },
  };
  const applied = {
    outcome: 'succeeded', requestedCall: { name: 'exec', args: {
      command: 'printf x > result.txt', cwd: null,
      effect: { kind: 'local_change', targets: ['result.txt'] },
    } }, actualCall: { name: 'exec', args: {
      command: 'printf x > result.txt', cwd: null,
      effect: { kind: 'local_change', targets: ['result.txt'] },
    } }, result: { state: 'completed', effectUnknown: false },
  };
  assert.equal(evaluateWorkCompletion({ proposedOutcome: 'achieved', receipts: [probe] }).verifiedOutcome,
    'unresolved');
  assert.equal(evaluateWorkCompletion({ proposedOutcome: 'achieved', receipts: [probe, {
    ...applied, actualCall: { ...applied.actualCall, args: { ...applied.actualCall.args, command: 'other' } },
  }] }).verifiedOutcome, 'unresolved');
  assert.equal(evaluateWorkCompletion({ proposedOutcome: 'achieved', receipts: [probe, applied] }).verifiedOutcome,
    'achieved');
});

test('approval·handoff·delivery 미달은 proposal과 final이 공유하는 blocker digest로 unresolved가 된다', () => {
  const cases = [
    { receipts: [{ outcome: 'succeeded', result: { state: 'approval_required' } }], blocker: 'approval_pending' },
    { receipts: [{ outcome: 'succeeded', result: { state: 'handoff_required' } }], blocker: 'handoff_pending' },
    { receipts: [{ outcome: 'succeeded', result: { delivered: false } }], blocker: 'delivery_missing' },
    { facts: { approvalPending: true, handoffPending: true, deliveryMissing: true }, blocker: 'approval_pending' },
  ];
  for (const fixture of cases) {
    const first = evaluateWorkCompletion({ proposedOutcome: 'achieved',
      receipts: fixture.receipts ?? [], facts: fixture.facts ?? {} });
    const second = evaluateWorkCompletion({ proposedOutcome: 'achieved',
      receipts: fixture.receipts ?? [], facts: fixture.facts ?? {} });
    assert.equal(first.verifiedOutcome, 'unresolved'); assert.ok(first.blockers.includes(fixture.blocker));
    assert.equal(first.blockerDigest, second.blockerDigest);
  }
});

function operationReceipt(operationHandle, status, overrides = {}) {
  const sha256 = overrides.sha256 ?? 'a'.repeat(64);
  return {
    toolCallId: overrides.toolCallId ?? (status === 'open' ? 'attempt' : 'final'),
    requestedCall: { name: 'attachment', args: {
      action: 'finalize_executable_output', operationHandle,
    } },
    outcome: overrides.outcome ?? 'succeeded',
    result: status === 'open' ? {
      state: 'executable_output_incomplete', verificationMissing: true,
      receiptRecovery: { kind: 'exact_operation', operationHandle, status: 'open' },
    } : {
      state: 'registered', artifact: { attachmentId: 'artifact-a', sha256 }, qualification: { passed: true },
      receiptRecovery: { kind: 'exact_operation', operationHandle,
        status: 'resolved', artifactSha256: overrides.recoverySha256 ?? sha256 },
      ...(overrides.attemptRecovery ? { attemptRecovery: overrides.attemptRecovery } : {}),
    },
  };
}

function operationBegin(operationHandle) {
  return { toolCallId: 'begin', requestedCall: { name: 'attachment', args: {
    action: 'begin_executable_output',
  } }, outcome: 'succeeded', result: {
    state: 'executable_output_started', operationHandle,
  } };
}

function operationRecovery(operationHandle, sha256 = 'a'.repeat(64)) {
  return { schema: 't5.executable-operation-attempt-recovery.v1', operationHandle,
    beginToolCallId: 'begin', finalizeToolCallId: 'final',
    artifact: { attachmentId: 'artifact-a', sha256 },
    supersededAttemptRange: { attempts: [
      { toolCallId: 'attempt', kind: 'same_operation_verification' },
    ], withdrawnApprovalIds: [] } };
}

test('같은 executable operation의 exact registered artifact만 앞선 verification 미달을 회복한다', () => {
  const recovered = evaluateWorkCompletion({ proposedOutcome: 'achieved', receipts: [
    operationBegin('operation-a'), operationReceipt('operation-a', 'open'),
    operationReceipt('operation-a', 'resolved', { attemptRecovery: operationRecovery('operation-a') }),
  ] });
  assert.equal(recovered.verifiedOutcome, 'achieved'); assert.deepEqual(recovered.blockers, []);

  for (const later of [
    operationReceipt('operation-b', 'resolved'),
    operationReceipt('operation-a', 'resolved', { recoverySha256: 'b'.repeat(64) }),
    operationReceipt('operation-a', 'resolved', { outcome: 'failed' }),
  ]) {
    const blocked = evaluateWorkCompletion({ proposedOutcome: 'achieved', receipts: [
      operationBegin('operation-a'), operationReceipt('operation-a', 'open'), later,
    ] });
    assert.equal(blocked.verifiedOutcome, 'unresolved');
    assert.ok(blocked.blockers.includes('requested_evidence_missing'));
  }
});

test('visual 후보를 사용한 achieved는 선택 이미지 exact reopen과 delivery 뒤에만 성립한다', () => {
  const visual = { outcome: 'succeeded', requestedCall: { name: 'file_reality', args: {
    action: 'visual_candidates' } }, result: { state: 'observed', verificationMissing: true,
    requiredEvidence: 'selected_visual_exact_reopen' } };
  const blocked = evaluateWorkCompletion({ proposedOutcome: 'achieved', receipts: [visual] });
  assert.equal(blocked.verifiedOutcome, 'unresolved');
  const selected = { outcome: 'succeeded', requestedCall: { name: 'file_reality', args: {
    action: 'inspect' } }, result: { state: 'observed', delivery: { state: 'registered_selected_visual' } } };
  const recovered = evaluateWorkCompletion({ proposedOutcome: 'achieved', receipts: [visual, selected] });
  assert.equal(recovered.verifiedOutcome, 'achieved');
  const attachmentSelected = { outcome: 'succeeded', requestedCall: { name: 'attachment', args: {
    action: 'register_existing_file' } }, result: { state: 'registered', artifact: { mimeType: 'image/png' } } };
  assert.equal(evaluateWorkCompletion({ proposedOutcome: 'achieved', receipts: [visual, attachmentSelected] })
    .verifiedOutcome, 'achieved');
});

test('같은 operation이 회복돼도 approval·unknown·handoff blocker는 절대 회복하지 않는다', () => {
  const base = [operationBegin('operation-a'), operationReceipt('operation-a', 'open'),
    { outcome: 'succeeded', result: { state: 'approval_required' } },
    operationReceipt('operation-a', 'resolved', { attemptRecovery: operationRecovery('operation-a') })];
  const approval = evaluateWorkCompletion({ proposedOutcome: 'achieved', receipts: base });
  assert.equal(approval.verifiedOutcome, 'unresolved'); assert.deepEqual(approval.blockers, ['approval_pending']);

  for (const extra of [
    { outcome: 'unknown', result: { effectUnknown: true } },
    { outcome: 'succeeded', result: { state: 'handoff_required' } },
  ]) {
    const result = evaluateWorkCompletion({ proposedOutcome: 'achieved', receipts: [
      operationBegin('operation-a'), operationReceipt('operation-a', 'open'), extra,
      operationReceipt('operation-a', 'resolved', { attemptRecovery: operationRecovery('operation-a') }),
    ] });
    assert.equal(result.verifiedOutcome, 'unresolved');
  }
});
