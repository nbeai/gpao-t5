import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AutomationStore, nextAutomationRun, normalizeAutomationSchedule,
} from '../src/automation-store.js';

test('cron·간격·일회 예약은 시간대와 다음 실행을 검증된 parser로 계산한다', () => {
  const now = Date.parse('2026-08-21T00:00:00Z');
  const cron = normalizeAutomationSchedule({ kind: 'cron', value: '0 9 * * *', timezone: 'Asia/Seoul' }, now);
  assert.equal(new Date(cron.nextRunAt).toISOString(), '2026-08-22T00:00:00.000Z');
  assert.equal(nextAutomationRun(cron, now), cron.nextRunAt);
  assert.equal(normalizeAutomationSchedule({ kind: 'every', value: '15m', timezone: 'Asia/Seoul' }, now).nextRunAt, now + 900_000);
  assert.throws(() => normalizeAutomationSchedule({ kind: 'cron', value: 'bad', timezone: 'Asia/Seoul' }, now), /five fields/u);
});

test('원장은 실행 전 claim을 먼저 기록하고 crash 뒤 일회 작업을 자동 반복하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-automation-store-')); let now = Date.parse('2026-08-21T00:00:00Z');
  try {
    const store = new AutomationStore(join(room, 'automation.json'), { now: () => now });
    const job = await store.create({ name: '한 번', prompt: '보고서 확인', sessionId: 's1', scheduleKind: 'at',
      schedule: new Date(now + 1_000).toISOString(), timezone: 'Asia/Seoul' });
    now += 2_000;
    const [claim] = await store.claimDue({ owner: { runtimeId: 'test-runtime', generation: 1 } });
    assert.equal(claim.job.id, job.id); assert.equal(claim.run.status, 'claimed');
    assert.deepEqual(await store.claimDue({ owner: { runtimeId: 'other-runtime', generation: 1 } }), []);
    now += 120_001;
    const recovered = await store.recoverInterrupted({ leaseMs: 120_000,
      inspectOwner: async () => 'definitely_dead' });
    assert.deepEqual(recovered, [job.id]);
    const state = await store.list();
    assert.equal(state.jobs[0].state, 'needs_review');
    assert.equal(state.runs[0].status, 'unknown');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('계약 필드가 없던 기존 예약은 실행 전에 needs_review로 격리한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-automation-legacy-')); const now = Date.parse('2026-08-21T00:00:00Z');
  try {
    const file = join(room, 'automation.json');
    const store = new AutomationStore(file, { now: () => now });
    const job = await store.create({ name: '기존', prompt: '게시', sessionId: 's', scheduleKind: 'every',
      schedule: '1h', timezone: 'Asia/Seoul' });
    const state = await store.read(); delete state.jobs[0].requirements; delete state.jobs[0].delivery;
    await store.write(state);
    assert.deepEqual(await store.quarantineUnqualified(), [job.id]);
    const quarantined = await store.inspect(job.id);
    assert.equal(quarantined.state, 'needs_review');
    assert.equal(quarantined.nextRunAt, null);
    assert.equal(quarantined.lastError, 'automation_contract_missing');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('제품에서 제거된 도구를 요구하는 기존 예약은 실행 전에 격리한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-automation-unavailable-')); const now = Date.parse('2026-08-21T00:00:00Z');
  try {
    const store = new AutomationStore(join(room, 'automation.json'), { now: () => now });
    const job = await store.create({ name: '브라우저 게시', prompt: '게시해', sessionId: 's',
      scheduleKind: 'every', schedule: '1h', timezone: 'Asia/Seoul',
      requirements: { requiredTools: ['browser'], requiredEffect: 'external_send', requireResultUrl: true },
      delivery: { kind: 'origin_session', sessionId: null } });
    assert.deepEqual(await store.quarantineUnavailableTools(['browser']), [job.id]);
    const quarantined = await store.inspect(job.id);
    assert.equal(quarantined.state, 'needs_review');
    assert.equal(quarantined.lastError, 'required_tool_unavailable');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('자동화 보관과 삭제는 실행 상태와 분리된 복구 가능한 정리 상태다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-automation-organize-')); const now = Date.parse('2026-08-21T00:00:00Z');
  try {
    const store = new AutomationStore(join(room, 'automation.json'), { now: () => now });
    const job = await store.create({ name: '매일 보고', prompt: '보고', sessionId: 's',
      scheduleKind: 'every', schedule: '1d', timezone: 'Asia/Seoul' });
    await assert.rejects(() => store.archive(job.id), /pause or turn off/u);
    await store.pause(job.id); await store.archive(job.id);
    let surface = await store.publicList(); assert.equal(surface.jobs.length, 0); assert.equal(surface.archivedJobs[0].id, job.id);
    await store.restoreArchived(job.id); assert.equal((await store.publicList()).jobs[0].state, 'paused');
    await store.trash(job.id); surface = await store.publicList(); assert.equal(surface.jobs.length, 0); assert.equal(surface.trashedJobs[0].id, job.id);
    await store.restoreTrashed(job.id); assert.equal((await store.publicList()).jobs[0].id, job.id);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('occurrence claim은 owner·fence·Work·Resource identity를 고정하고 stale worker 정산을 거부한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-automation-occurrence-'));
  let now = Date.parse('2026-08-21T00:00:00Z');
  try {
    const store = new AutomationStore(join(room, 'automation.json'), { now: () => now });
    const job = await store.create({ name: '현재 보고', prompt: '보고서를 확인해', sessionId: 's1',
      scheduleKind: 'at', schedule: new Date(now + 1_000).toISOString(), timezone: 'Asia/Seoul',
      workBinding: { workId: 'source-work', revision: 3 } });
    now += 2_000;
    const [claim] = await store.claimDue({ owner: { runtimeId: 'runtime-a', generation: 1 } });
    assert.equal(claim.run.occurrenceId, claim.run.id);
    assert.equal(claim.run.sourceWorkId, 'source-work'); assert.equal(claim.run.sourceWorkRevision, 3);
    assert.ok(claim.run.resourceScopeId); assert.ok(claim.run.fenceToken);
    assert.equal(claim.run.executionStatus, 'not_started');
    assert.equal(claim.run.objectiveStatus, 'unassessed');
    assert.equal(claim.run.deliveryStatus, 'pending');
    await store.markRunning(job.id, claim.run.id, claim.claim);
    now += 500;
    await store.heartbeat(job.id, claim.run.id, claim.claim);
    await assert.rejects(() => store.complete({ jobId: job.id, runId: claim.run.id,
      claim: { ...claim.claim, fenceToken: 'stale-fence' }, executionStatus: 'completed',
      objectiveStatus: 'achieved', deliveryStatus: 'failed' }), /claim is stale/u);
    await store.complete({ jobId: job.id, runId: claim.run.id, claim: claim.claim,
      sourceRunId: 'model-run', executionWorkId: 'execution-work', executionWorkRevision: 1,
      executionStatus: 'completed', objectiveStatus: 'achieved',
      surfaceStatus: 'persisted', deliveryStatus: 'failed', error: 'delivery_failed' });
    const state = await store.list(); const occurrence = state.runs[0];
    assert.equal(occurrence.status, 'failed'); assert.equal(occurrence.executionStatus, 'completed');
    assert.equal(occurrence.objectiveStatus, 'achieved'); assert.equal(occurrence.deliveryStatus, 'failed');
    assert.equal(occurrence.executionWorkId, 'execution-work');
    assert.equal(occurrence.executionWorkRevision, 1);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('같은 state file을 연 두 scheduler store도 한 occurrence를 둘 다 claim하지 못한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-automation-cross-store-'));
  let now = Date.parse('2026-08-21T00:00:00Z'); const file = join(room, 'automation.json');
  try {
    const first = new AutomationStore(file, { now: () => now });
    await first.create({ name: '하나', prompt: '한 번만', sessionId: 's', scheduleKind: 'at',
      schedule: new Date(now + 1_000).toISOString(), timezone: 'Asia/Seoul' });
    now += 2_000; const second = new AutomationStore(file, { now: () => now });
    const claims = (await Promise.all([
      first.claimDue({ owner: { runtimeId: 'a', generation: 1 } }),
      second.claimDue({ owner: { runtimeId: 'b', generation: 1 } }),
    ])).flat();
    assert.equal(claims.length, 1); assert.equal((await first.list()).runs.length, 1);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('recovery는 heartbeat 시간만으로 live owner를 죽이지 않고 stale non-live owner만 unknown으로 fencing한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-automation-owner-recovery-'));
  let now = Date.parse('2026-08-21T00:00:00Z');
  try {
    const store = new AutomationStore(join(room, 'automation.json'), { now: () => now });
    const job = await store.create({ name: '긴 확인', prompt: '계속 확인해', sessionId: 's1',
      scheduleKind: 'every', schedule: '1h', timezone: 'Asia/Seoul' });
    now += 3_600_000;
    const [claim] = await store.claimDue({ owner: { runtimeId: 'runtime-a', generation: 7 } });
    await store.markRunning(job.id, claim.run.id, claim.claim);
    now += 120_001;
    assert.deepEqual(await store.recoverInterrupted({ leaseMs: 120_000,
      inspectOwner: async () => 'live' }), []);
    assert.equal((await store.list()).runs[0].status, 'running');
    const recovered = await store.recoverInterrupted({ leaseMs: 120_000,
      inspectOwner: async () => 'definitely_dead' });
    assert.deepEqual(recovered, [job.id]);
    const state = await store.list(); assert.equal(state.runs[0].status, 'unknown');
    assert.equal(state.runs[0].executionStatus, 'unknown');
    assert.equal(state.runs[0].objectiveStatus, 'unassessed');
    assert.equal(state.runs[0].deliveryStatus, 'unknown');
    await assert.rejects(() => store.complete({ jobId: job.id, runId: claim.run.id,
      claim: claim.claim, executionStatus: 'completed', objectiveStatus: 'achieved',
      deliveryStatus: 'succeeded' }), /claim is stale/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('result surface와 외부 delivery는 각각 prepare 뒤 exact receipt로만 terminal된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-automation-publication-'));
  let now = Date.parse('2026-08-21T00:00:00Z');
  try {
    const store = new AutomationStore(join(room, 'automation.json'), { now: () => now });
    const job = await store.create({ name: '전달', prompt: '결과를 보내', sessionId: 'origin',
      scheduleKind: 'at', schedule: new Date(now + 1_000).toISOString(), timezone: 'Asia/Seoul',
      delivery: { kind: 'telegram', sessionId: 'telegram-owner' } });
    now += 2_000; const [claimed] = await store.claimDue({ owner: { runtimeId: 'a', generation: 1 } });
    await store.markRunning(job.id, claimed.run.id, claimed.claim);
    await store.prepareResult({ jobId: job.id, runId: claimed.run.id, claim: claimed.claim,
      sourceRunId: 'model-run', objectiveStatus: 'achieved', resultPointer: 'work-result:model-run',
      resultDigest: 'digest-1' });
    await assert.rejects(() => store.markSurfacePersisted({ jobId: job.id, runId: claimed.run.id,
      claim: claimed.claim, surfaceReceipt: { sessionId: 'origin', runId: 'wrong', resultDigest: 'digest-1' } }),
    /surface receipt/u);
    await store.markSurfacePersisted({ jobId: job.id, runId: claimed.run.id, claim: claimed.claim,
      surfaceReceipt: { surface: 'console_session', sessionId: 'origin',
        runId: 'model-run', resultDigest: 'digest-1' } });
    await store.claimDelivery({ jobId: job.id, runId: claimed.run.id, claim: claimed.claim,
      deliveryId: 'delivery-1', provider: 'telegram' });
    assert.equal((await store.list()).runs[0].deliveryStatus, 'dispatch_claimed');
    await assert.rejects(() => store.settleDelivery({ jobId: job.id, runId: claimed.run.id,
      claim: claimed.claim, deliveryId: 'other', status: 'succeeded' }), /delivery claim/u);
    await store.settleDelivery({ jobId: job.id, runId: claimed.run.id, claim: claimed.claim,
      deliveryId: 'delivery-1', status: 'unknown', receipt: { state: 'ack_missing' } });
    await store.complete({ jobId: job.id, runId: claimed.run.id, claim: claimed.claim,
      error: 'delivery_ack_unknown' });
    const occurrence = (await store.list()).runs[0]; assert.equal(occurrence.status, 'unknown');
    assert.equal(occurrence.objectiveStatus, 'achieved'); assert.equal(occurrence.surfaceStatus, 'persisted');
    assert.equal(occurrence.deliveryStatus, 'unknown');
  } finally { await rm(room, { recursive: true, force: true }); }
});
