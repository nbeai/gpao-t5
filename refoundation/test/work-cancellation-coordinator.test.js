import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { RunLedger } from '../src/run-ledger.js';
import { WorkCancellationCoordinator } from '../src/work-cancellation-coordinator.js';
import { WorkStore } from '../src/work-store.js';

async function setup(name) {
  const room = await mkdtemp(join(tmpdir(), `t5-work-cancel-${name}-`));
  const workStore = new WorkStore(join(room, 'work'), { makeId: () => 'work-safe' });
  const runLedger = new RunLedger(join(room, 'runs')); const run = await runLedger.start({
    sessionId: 'session-safe', request: '긴 작업' });
  const work = await workStore.create({ sessionId: 'session-safe', sourceMessageId: 'message-safe' });
  await workStore.claimExecution({ workId: work.workId, revision: work.revision, runId: run.runId });
  const stopped = [];
  const coordinator = new WorkCancellationCoordinator({ workStore, runLedger,
    processRegistry: { async stopOwner(owner, reason) { stopped.push({ owner, reason }); return []; } },
    makeId: () => `cancel-${name}` });
  return { room, workStore, run, coordinator, stopped };
}

test('cancel admission은 durable이고 Run terminal 뒤 claim release를 cancellation terminal보다 먼저 남긴다', async () => {
  const fixture = await setup('order');
  try {
    const admission = await fixture.coordinator.admit({ sessionId: 'session-safe', runId: fixture.run.runId });
    const controller = new AbortController(); const childSettlementReceipt = await fixture.coordinator.requestStop({ admission, controller });
    assert.equal(controller.signal.aborted, true); assert.equal(fixture.stopped.length, 1);
    await fixture.run.finish('cancelled', { reason: 'user_cancelled' });
    const receipt = await fixture.coordinator.settle({ admission, childSettlementReceipt });
    assert.equal(receipt.claimReleased, true); assert.equal(receipt.disposition, 'interrupted_resumable');
    const state = await fixture.workStore.read();
    const release = state.events.find((event) => event.type === 'execution_released');
    const terminal = state.events.find((event) => event.type === 'work_cancellation_settled');
    assert.ok(release.sequence < terminal.sequence);
    assert.equal(state.claims[0].state, 'released'); assert.equal(state.works[0].revision, 2);
    assert.equal(state.works[0].status, 'paused');
    await assert.rejects(fixture.workStore.claimExecution({ workId: 'work-safe', revision: 2,
      runId: 'too-early' }), /stale work|claimed|active/u);
    const resultDigest = 'a'.repeat(64);
    await fixture.workStore.recordResultReady({ runId: admission.runId, sessionId: admission.sessionId,
      workId: admission.workId, revision: admission.revision, objectiveOutcome: 'cancelled',
      resultDigest, surfaceResult: { kind: 'cancelled', reply: '멈췄어요.' } });
    await fixture.workStore.markResultSurfacePersisted(admission.runId);
    await fixture.workStore.markCancellationSurfacePersisted({ requestId: admission.requestId,
      runId: admission.runId, nextRevision: 2, resultDigest });
    assert.equal((await fixture.workStore.read()).works[0].status, 'active');
    await fixture.workStore.claimExecution({ workId: 'work-safe', revision: 2, runId: 'next-run-safe' });
  } finally { await rm(fixture.room, { recursive: true, force: true }); }
});

test('hard cancel은 Work를 terminal cancelled로 두고 unknown effect를 잃지 않는다', async () => {
  const fixture = await setup('hard');
  try {
    const admission = await fixture.coordinator.admit({ sessionId: 'session-safe', runId: fixture.run.runId,
      disposition: 'hard_cancelled' });
    await fixture.run.append({ type: 'tool_completed', payload: { receipt: {
      outcome: 'unknown', result: { effectUnknown: true } } } });
    await fixture.run.finish('cancelled');
    const childSettlementReceipt = await fixture.coordinator.requestStop({ admission,
      controller: new AbortController() });
    const receipt = await fixture.coordinator.settle({ admission, childSettlementReceipt,
      unknownEffect: false });
    assert.equal(receipt.unknownEffect, true); assert.equal(receipt.disposition, 'hard_cancelled');
    assert.equal((await fixture.workStore.read()).works[0].status, 'cancelled');
  } finally { await rm(fixture.room, { recursive: true, force: true }); }
});

test('legacy settled active cancel claim은 restart repair에서 exact release된다', async () => {
  const fixture = await setup('legacy');
  try {
    await fixture.workStore.settle({ workId: 'work-safe', revision: 1,
      outcome: 'cancelled', runId: fixture.run.runId });
    await fixture.run.finish('cancelled');
    assert.equal((await fixture.workStore.read()).claims[0].state, 'active');
    assert.deepEqual(await fixture.coordinator.repairLegacySettledClaims(), [fixture.run.runId]);
    assert.equal((await fixture.workStore.read()).claims[0].state, 'released');
  } finally { await rm(fixture.room, { recursive: true, force: true }); }
});

test('forged admission·fake child receipt·second disposition은 stop이나 terminal을 만들지 않는다', async () => {
  const fixture = await setup('forged');
  try {
    const admission = await fixture.coordinator.admit({ sessionId: 'session-safe', runId: fixture.run.runId });
    await assert.rejects(fixture.coordinator.requestStop({ admission: { ...admission, workId: 'foreign' },
      controller: new AbortController() }), (error) => error.code === 'work_cancel_admission_mismatch');
    assert.equal(fixture.stopped.length, 0);
    await assert.rejects(fixture.coordinator.admit({ sessionId: 'session-safe', runId: fixture.run.runId,
      disposition: 'hard_cancelled' }), (error) => error.code === 'work_cancel_request_conflict');
    await fixture.run.finish('cancelled');
    await assert.rejects(fixture.coordinator.settle({ admission,
      childSettlementReceipt: { requestId: admission.requestId, childrenTerminal: true } }), /fresh child/u);
    assert.equal((await fixture.workStore.read()).cancellations[0].state, 'stopping');
  } finally { await rm(fixture.room, { recursive: true, force: true }); }
});

test('failed settle은 child proof를 소비하지 않고 authoritative unknown은 caller false로 지우지 못한다', async () => {
  const fixture = await setup('retry-proof');
  try {
    const admission = await fixture.coordinator.admit({ sessionId: 'session-safe', runId: fixture.run.runId });
    const child = await fixture.coordinator.requestStop({ admission, controller: new AbortController() });
    await assert.rejects(fixture.coordinator.settle({ admission, childSettlementReceipt: child }),
      (error) => error.code === 'work_cancel_run_not_terminal');
    await fixture.run.append({ type: 'tool_started', payload: { toolCallId: 'effect-started',
      args: { effect: { kind: 'local_change' } } } });
    await fixture.run.finish('cancelled');
    const receipt = await fixture.coordinator.settle({ admission, childSettlementReceipt: child,
      unknownEffect: false });
    assert.equal(receipt.unknownEffect, true);
    const retry = await fixture.coordinator.settle({ admission, childSettlementReceipt: child,
      unknownEffect: false });
    assert.equal(retry.requestId, receipt.requestId);
  } finally { await rm(fixture.room, { recursive: true, force: true }); }
});

test('orphan 또는 잘못된 nextRevision cancellation terminal은 projection에서 fail closed한다', async () => {
  const fixture = await setup('orphan');
  try {
    await fixture.workStore.append('work_cancellation_settled', { requestId: 'orphan',
      sessionId: 'session-safe', runId: fixture.run.runId, workId: 'work-safe', revision: 1,
      nextRevision: 9, disposition: 'interrupted_resumable', fingerprint: 'forged',
      unknownEffect: false, claimReleased: true });
    await assert.rejects(fixture.workStore.read(), /orphan, duplicate, or mismatched/u);
  } finally { await rm(fixture.room, { recursive: true, force: true }); }
});

test('restart는 terminal Run의 미정산 child를 unknown으로 보존하고 surface 뒤에도 R+1을 잠근다', async () => {
  const fixture = await setup('restart-window');
  try {
    const admission = await fixture.coordinator.admit({ sessionId: 'session-safe', runId: fixture.run.runId });
    await fixture.run.finish('cancelled');
    const recovered = await fixture.coordinator.reconcileAfterRestart();
    assert.equal(recovered.length, 1); assert.equal(recovered[0].receipt.unknownEffect, true);
    assert.equal(recovered[0].receipt.childrenTerminal, null);
    let state = await fixture.workStore.read();
    assert.equal(state.claims[0].state, 'released'); assert.equal(state.works[0].status, 'paused');
    assert.equal(state.results.length, 0); assert.equal(state.cancellations[0].surfacePersisted, false);
    const resultDigest = 'b'.repeat(64);
    await fixture.workStore.recordResultReady({ runId: admission.runId, sessionId: admission.sessionId,
      workId: admission.workId, revision: admission.revision, objectiveOutcome: 'cancelled',
      resultDigest, surfaceResult: { kind: 'cancelled', reply: recovered[0].receipt.userSafeSummary } });
    assert.equal((await fixture.workStore.read()).results[0].state, 'pending_surface');
    await fixture.workStore.markResultSurfacePersisted(admission.runId);
    assert.equal((await fixture.workStore.read()).works[0].status, 'paused');
    await fixture.workStore.markCancellationSurfacePersisted({ requestId: admission.requestId,
      runId: admission.runId, nextRevision: 2, resultDigest });
    state = await fixture.workStore.read(); assert.equal(state.works[0].status, 'paused');
    await assert.rejects(fixture.workStore.claimExecution({ workId: admission.workId,
      revision: 2, runId: 'restart-too-early' }), /active work/u);
    await assert.rejects(fixture.workStore.setStatus({ workId: admission.workId,
      expectedRevision: 2, status: 'active' }), /children are not terminal/u);
  } finally { await rm(fixture.room, { recursive: true, force: true }); }
});

test('restart에서 Run 원장이 없으면 release나 거짓 terminal 없이 paused unknown으로 남긴다', async () => {
  const fixture = await setup('missing-run');
  try {
    await fixture.coordinator.admit({ sessionId: 'session-safe', runId: fixture.run.runId });
    await rm(join(fixture.room, 'runs', `${fixture.run.runId}.jsonl`));
    assert.deepEqual(await fixture.coordinator.reconcileAfterRestart(), []);
    const state = await fixture.workStore.read();
    assert.equal(state.claims[0].state, 'active'); assert.equal(state.works[0].status, 'paused');
    assert.equal(state.cancellations[0].state, 'stopping');
  } finally { await rm(fixture.room, { recursive: true, force: true }); }
});

test('cancel admission 뒤 completion proposal·settlement가 cancellation을 추월하지 못한다', async () => {
  const fixture = await setup('completion-race');
  try {
    await fixture.coordinator.admit({ sessionId: 'session-safe', runId: fixture.run.runId });
    await assert.rejects(fixture.workStore.proposeCompletion({ workId: 'work-safe', revision: 1,
      runId: fixture.run.runId, proposedOutcome: 'achieved', verifiedOutcome: 'achieved' }),
    /active work/u);
    await assert.rejects(fixture.workStore.settle({ workId: 'work-safe', revision: 1,
      runId: fixture.run.runId, outcome: 'achieved' }), /active work/u);
    const state = await fixture.workStore.read();
    assert.equal(state.works[0].status, 'paused'); assert.equal(state.proposals.length, 0);
  } finally { await rm(fixture.room, { recursive: true, force: true }); }
});
