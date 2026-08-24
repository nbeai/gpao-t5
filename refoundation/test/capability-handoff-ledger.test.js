import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CapabilityHandoffLedger } from '../src/capability-handoff-ledger.js';

const ids = {
  handoffId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  resumeRunId: '33333333-3333-4333-8333-333333333333',
};

test('capability handoff는 준비·실측·완료·claim·재개를 append-only로 한 번씩 지속한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-capability-ledger-'));
  const ledger = new CapabilityHandoffLedger(room);
  try {
    await ledger.ensure();
    await ledger.start({ ...ids, connectionId: 'workspace-fixture', mode: 'user_action' });
    await ledger.observeReady(ids.handoffId, 'ready');
    await ledger.recordCompletion(ids.handoffId);
    const firstClaim = await ledger.claimResume(ids.handoffId);
    const sameClaim = await ledger.claimResume(ids.handoffId);
    assert.equal(firstClaim.claimId, sameClaim.claimId);
    await ledger.markResumeCompletedPendingSurface(ids.handoffId, { resumeRunId: ids.resumeRunId,
      resultPointer: `work-result:${ids.resumeRunId}`, resultDigest: 'digest-333' });
    await assert.rejects(() => ledger.markResumed(ids.handoffId, {
      resumeRunId: ids.resumeRunId, surfaceReceipt: null,
    }), /surface receipt/u);
    await ledger.markResumed(ids.handoffId, { resumeRunId: ids.resumeRunId, surfaceReceipt: {
      surface: 'console_session', sessionId: ids.sessionId,
      runId: ids.resumeRunId, resultDigest: 'digest-333',
    } });
    const state = await ledger.read();
    assert.equal(state.handoffs[0].state, 'resumed');
    assert.equal(state.handoffs[0].resumeRunId, ids.resumeRunId);
    assert.deepEqual(state.events.map((event) => event.type), [
      'ledger_started', 'handoff_waiting', 'readiness_observed',
      'completion_recorded', 'resume_claimed', 'resume_completed_pending_surface', 'handoff_resumed',
    ]);
    assert.equal((await stat(join(room, 'capability-handoffs.jsonl'))).mode & 0o777, 0o600);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('완료 전 claim과 terminal handoff의 재실행은 원장 상태를 바꾸지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-capability-ledger-stop-'));
  const ledger = new CapabilityHandoffLedger(room);
  try {
    await ledger.ensure();
    await ledger.start({ ...ids, connectionId: 'workspace-fixture', mode: 'oauth' });
    await assert.rejects(() => ledger.claimResume(ids.handoffId), /not resumable/u);
    await ledger.cancel(ids.handoffId);
    await ledger.cancel(ids.handoffId);
    await assert.rejects(() => ledger.observeReady(ids.handoffId, 'ready'), /invalid capability handoff transition/u);
    assert.equal((await ledger.read()).handoffs[0].state, 'cancelled');
  } finally { await rm(room, { recursive: true, force: true }); }
});
