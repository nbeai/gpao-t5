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
  const result = await tool.execute({ outcome: 'achieved' }, { priorReceipts: [] });
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
    const result = await tool.execute({ outcome: 'achieved' }, { priorReceipts: [receipt] });
    assert.equal(result.verifiedOutcome, 'unresolved');
  }
});

test('실패한 route 뒤 같은 Hand의 성공 Evidence가 있으면 과거 실패만으로 완료를 막지 않는다', () => {
  const evaluation = evaluateWorkCompletion({ proposedOutcome: 'achieved', receipts: [
    { requestedCall: { name: 'exec' }, outcome: 'failed', result: {} },
    { requestedCall: { name: 'exec' }, outcome: 'succeeded', result: { state: 'completed' } },
  ] });
  assert.equal(evaluation.verifiedOutcome, 'achieved'); assert.deepEqual(evaluation.blockers, []);
  const unrelated = evaluateWorkCompletion({ proposedOutcome: 'achieved', receipts: [
    { requestedCall: { name: 'web_read' }, outcome: 'failed', result: {} },
    { requestedCall: { name: 'exec' }, outcome: 'succeeded', result: { state: 'completed' } },
  ] });
  assert.equal(unrelated.verifiedOutcome, 'unresolved'); assert.ok(unrelated.blockers.includes('failed'));
  const mutating = evaluateWorkCompletion({ proposedOutcome: 'achieved', receipts: [
    { requestedCall: { name: 'exec', args: { effect: { kind: 'local_change' } } }, outcome: 'failed', result: {} },
    { requestedCall: { name: 'exec', args: { effect: { kind: 'local_change' } } }, outcome: 'succeeded', result: {} },
  ] });
  assert.equal(mutating.verifiedOutcome, 'unresolved'); assert.ok(mutating.blockers.includes('failed'));
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
