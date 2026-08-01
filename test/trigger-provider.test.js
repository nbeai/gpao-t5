import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AUTOMATION_SCHEMA_VERSION,
  contentHash,
  validateAgentRun,
} from '../src/kernel/l5-growth/automation-contracts.js';
import {
  automationCandidateAddDelta,
  makeGrowthCandidate,
} from '../src/kernel/l5-growth/automation.js';
import {
  MAX_CATCH_UP_OCCURRENCES,
  nextTriggerOccurrence,
} from '../src/kernel/l5-growth/trigger-spec.js';
import { BuiltinTriggerProvider } from '../src/runtime/trigger-provider.js';
import { prepareAutomationRuns } from '../src/runtime/automation-engine.js';
import { AutomationScheduler } from '../src/runtime/automation-scheduler.js';
import { AutomationRunLedger } from '../src/surface/automation-run-ledger.js';

const HOUR = 60 * 60 * 1000;

function envelope() {
  return {
    ceiling: 'A1',
    allowedKinds: ['read'],
    allowedTools: ['local.file'],
    allowedTargets: [],
    workspaceRoots: ['/tmp/work'],
    expiresAt: null,
    maxRuns: 100,
    maxCost: null,
    requiresFreshApprovalFor: [],
  };
}

function skill() {
  const record = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'skill-1',
    name: 'Report skill',
    purpose: 'Read current files and summarize them',
    version: 1,
    contentHash: '',
    inputs: [],
    steps: [{ principle: 'Read current state first' }],
    resultContract: { kind: 'summary' },
    requiredCapabilities: ['local.file'],
    authorityHints: ['read'],
    replayCases: [],
    source: { kind: 'test', sessionId: 'session-1', traceIds: [] },
    state: 'active',
    createdAt: 0,
    updatedAt: 0,
    previousVersion: null,
  };
  record.contentHash = contentHash({
    name: record.name,
    purpose: record.purpose,
    inputs: record.inputs,
    steps: record.steps,
    resultContract: record.resultContract,
    requiredCapabilities: record.requiredCapabilities,
    authorityHints: record.authorityHints,
    replayCases: record.replayCases,
  });
  return record;
}

function profile() {
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'agent-1',
    name: 'Report agent',
    purpose: 'Prepare reports',
    modelRole: 'worker',
    toolAllowlist: ['local.file'],
    workspaceScope: ['/tmp/work'],
    defaultBudgets: { maxToolCalls: 4, timeoutMs: 30_000 },
    authorityCeiling: 'A1',
    state: 'active',
    createdAt: 0,
    updatedAt: 0,
  };
}

function intervalJob(patch = {}) {
  const nextRunAt = patch.nextRunAt ?? HOUR;
  const trigger = {
    kind: 'interval',
    timezone: 'UTC',
    intervalMs: HOUR,
    misfirePolicy: 'catch_up_once',
    nextRunAt,
    ...patch.trigger,
  };
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'job-1',
    name: 'Hourly report',
    skillRef: { id: 'skill-1', version: 1, contentHash: skill().contentHash },
    trigger,
    agentProfileId: 'agent-1',
    inputTemplate: {},
    authorityEnvelope: envelope(),
    deliveryPolicy: { mode: 'none' },
    state: 'scheduled',
    nextRunAt,
    lastRunId: null,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
    trigger,
  };
}

test('calendar triggers preserve local wall-clock time across DST gaps and overlaps', () => {
  const spring = {
    kind: 'daily',
    timezone: 'America/New_York',
    localTime: '02:30',
    misfirePolicy: 'catch_up_once',
    nextRunAt: null,
  };
  assert.equal(
    nextTriggerOccurrence(spring, Date.parse('2026-03-07T08:00:00Z')),
    Date.parse('2026-03-08T07:00:00Z'),
    'a nonexistent 02:30 uses the first valid local minute after the DST gap',
  );

  const fall = { ...spring, localTime: '01:30' };
  const first = nextTriggerOccurrence(fall, Date.parse('2026-10-31T06:00:00Z'));
  assert.equal(first, Date.parse('2026-11-01T05:30:00Z'), 'an overlap has one stable earliest occurrence');
  assert.equal(
    nextTriggerOccurrence(fall, first),
    Date.parse('2026-11-02T06:30:00Z'),
    'the repeated wall-clock minute is not emitted twice',
  );
});

test('weekly trigger uses the requested timezone and weekday', () => {
  const weekly = {
    kind: 'weekly',
    timezone: 'Asia/Seoul',
    weekdays: [1],
    localTime: '09:00',
    misfirePolicy: 'catch_up_once',
    nextRunAt: null,
  };
  assert.equal(
    nextTriggerOccurrence(weekly, Date.parse('2026-08-02T12:00:00Z')),
    Date.parse('2026-08-03T00:00:00Z'),
  );
});

test('restart reconciliation applies skip or one bounded catch-up and advances the durable cursor', () => {
  const provider = new BuiltinTriggerProvider();
  const catchUp = provider.plan(intervalJob(), { now: 3 * HOUR, recovering: true });
  assert.deepEqual(catchUp.occurrences, [3 * HOUR]);
  assert.equal(catchUp.nextRunAt, 4 * HOUR);
  assert.equal(catchUp.skippedCount, 2);
  assert.equal(catchUp.occurrences.length, MAX_CATCH_UP_OCCURRENCES);

  const skipJob = intervalJob({ trigger: { misfirePolicy: 'skip' } });
  const current = provider.plan(skipJob, { now: 3 * HOUR, recovering: true });
  assert.deepEqual(current.occurrences, [3 * HOUR], 'the occurrence due now is not a misfire');
  assert.equal(current.skippedCount, 2);
  const skipped = provider.plan(skipJob, { now: (3 * HOUR) + 1, recovering: true });
  assert.deepEqual(skipped.occurrences, []);
  assert.equal(skipped.nextRunAt, 4 * HOUR);
  assert.equal(skipped.skippedCount, 3);
});

test('catch-up stays bounded after a multi-year interval backlog', () => {
  const provider = new BuiltinTriggerProvider();
  const tenYears = 10 * 366 * 24 * HOUR;
  const plan = provider.plan(intervalJob({ nextRunAt: 0 }), { now: tenYears, recovering: true });
  assert.equal(plan.occurrences.length, 1);
  assert.equal(plan.occurrences[0], tenYears);
  assert.equal(plan.nextRunAt, tenYears + HOUR);
});

test('once restart misfires obey policy without inventing a second occurrence', () => {
  const provider = new BuiltinTriggerProvider();
  const base = intervalJob({
    nextRunAt: 100,
    trigger: {
      kind: 'once', timezone: 'UTC', at: 100, misfirePolicy: 'catch_up_once', nextRunAt: 100,
    },
  });
  assert.deepEqual(provider.plan(base, { now: 500, recovering: true }).occurrences, [100]);
  assert.equal(provider.plan(base, { now: 500, recovering: true }).nextRunAt, null);
  assert.deepEqual(
    provider.plan({ ...base, trigger: { ...base.trigger, misfirePolicy: 'skip' } }, { now: 500, recovering: true }).occurrences,
    [],
  );
  assert.deepEqual(
    provider.plan({ ...base, trigger: { ...base.trigger, misfirePolicy: 'skip' } }, { now: 100, recovering: true }).occurrences,
    [100],
    'startup exactly on the due instant is scheduled work, not a misfire',
  );
});

test('AgentRun preparation is immutable, deterministic across restart, and ledger-only', () => {
  const input = {
    jobs: [intervalJob()],
    skills: [skill()],
    profiles: [profile()],
    now: 3 * HOUR,
    recovering: true,
  };
  const original = structuredClone(input);
  const first = prepareAutomationRuns(input);
  const restarted = prepareAutomationRuns(structuredClone(input));

  assert.equal(first.entries.length, 1);
  assert.equal(first.entries[0].run.status, 'queued');
  assert.equal(validateAgentRun(first.entries[0].run).ok, true);
  assert.equal(first.entries[0].run.scheduledFor, 3 * HOUR);
  assert.equal(first.entries[0].run.id, restarted.entries[0].run.id);
  assert.equal(first.entries[0].run.idempotencyKey, restarted.entries[0].run.idempotencyKey);
  assert.equal(first.entries[0].jobDelta.changes.nextRunAt, 4 * HOUR);
  assert.equal('jobs' in first.entries[0].jobDelta, false);
  assert.equal('executions' in first.entries[0].jobDelta.changes, false);
  assert.deepEqual(input, original, 'preparation does not mutate a store snapshot');
});

test('paused and cancelled jobs derive no occurrence or write delta', () => {
  const prepared = prepareAutomationRuns({
    jobs: [
      intervalJob({ state: 'paused' }),
      intervalJob({ id: 'job-2', state: 'cancelled' }),
    ],
    skills: [skill()],
    profiles: [profile()],
    now: 3 * HOUR,
  });
  assert.equal(prepared.entries.length, 0);
  assert.deepEqual(prepared.ignored.map((entry) => entry.reason), ['job_paused', 'job_cancelled']);
});

test('candidate persistence is a guarded one-record delta, not an array replacement', () => {
  const candidate = makeGrowthCandidate({
    candidateId: 'candidate-1',
    statement: '매주 파일 목록 정리해줘',
    action: { tool: 'local.file', args: { action: 'list', path: '.' } },
    dedupKey: 'weekly-file-list',
  });
  const delta = automationCandidateAddDelta(candidate);
  assert.equal(delta.kind, 'automation_candidate.add');
  assert.deepEqual(delta.expected, {
    candidateIdAbsent: true,
    dedupKeyAbsent: 'weekly-file-list',
  });
  assert.equal('candidates' in delta, false);
  assert.equal('jobs' in delta, false);
});

test('concurrent schedulers persist one queued occurrence, and restart cannot duplicate it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-ac3-ledger-'));
  let toolCalls = 0;
  const heartbeats = [];
  const stateSource = async () => ({
    jobs: [intervalJob()],
    skills: [skill()],
    profiles: [profile()],
    tools: { run() { toolCalls += 1; } },
  });
  const applyJobDeltas = async () => ({ ok: true });
  const recordHeartbeat = async (delta) => {
    heartbeats.push(delta);
    return { ok: true };
  };
  const scheduler = (ownerToken, runLedger = new AutomationRunLedger(dir)) => new AutomationScheduler({
    stateSource,
    runLedger,
    applyJobDeltas,
    recordHeartbeat,
    owner: { pid: process.pid, ownerToken },
    clock: () => HOUR,
  });

  const [first, second] = await Promise.all([
    scheduler('owner-a').reconcile(),
    scheduler('owner-b').reconcile(),
  ]);
  assert.equal(first.claimed.length + second.claimed.length, 1);
  assert.equal(first.duplicates.length + second.duplicates.length, 1);

  const afterRace = await new AutomationRunLedger(dir).load();
  assert.equal(afterRace.runs.length, 1, 'one occurrence has one durable run owner');
  assert.equal(afterRace.events.filter((event) => event.type === 'queued').length, 1,
    'the JSONL truth has exactly one queued event');
  assert.equal(afterRace.runs[0].status, 'claimed');
  assert.equal(afterRace.runs[0].receipts.length, 0);
  assert.equal(toolCalls, 0, 'scheduler claim preparation never invokes a tool');

  const restarted = await scheduler('owner-after-restart', new AutomationRunLedger(dir)).reconcile();
  assert.equal(restarted.claimed.length, 0);
  assert.equal(restarted.duplicates.length, 1);
  const afterRestart = await new AutomationRunLedger(dir).load();
  assert.equal(afterRestart.runs.length, 1);
  assert.equal(afterRestart.events.filter((event) => event.type === 'queued').length, 1,
    'a fresh ledger instance did not append a duplicate occurrence');
  assert.equal(heartbeats.length, 3);
  assert.ok(heartbeats.every((heartbeat) => heartbeat.at === HOUR
    && heartbeat.kind === 'automation_scheduler.heartbeat'));
});
