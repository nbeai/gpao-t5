import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AUTOMATION_SCHEMA_VERSION,
  agentRunIdempotencyKey,
  claimAgentRun,
  contentHash,
  skillHashSource,
} from '../src/kernel/l5-growth/automation-contracts.js';
import { AutomationScheduler } from '../src/runtime/automation-scheduler.js';
import { CanonicalAutomationRuntime } from '../src/runtime/canonical-automation-runtime.js';
import { AutomationJobStore } from '../src/surface/automation-store.js';
import { AutomationRunLedger } from '../src/surface/automation-run-ledger.js';
import { MemoryStore } from '../src/surface/memory-store.js';
import { migrateAutomationWorkspaceV1 } from '../src/surface/automation-workspace-migration.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

function activeSkill(id = 'lifecycle-skill') {
  const skill = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id,
    name: 'Lifecycle skill',
    purpose: 'Exercise one durable automation occurrence',
    version: 1,
    contentHash: '',
    inputs: [],
    steps: [{ kind: 'read', instruction: 'Summarize the supplied input' }],
    resultContract: { kind: 'summary' },
    requiredCapabilities: [],
    authorityHints: [],
    replayCases: [],
    source: { kind: 'test', sessionId: null, traceIds: [] },
    state: 'active',
    createdAt: 1,
    updatedAt: 1,
    previousVersion: null,
  };
  skill.contentHash = contentHash(skillHashSource(skill));
  return skill;
}

function activeProfile(id = 'lifecycle-agent') {
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id,
    name: 'Lifecycle agent',
    purpose: 'Run bounded lifecycle checks',
    modelRole: 'worker',
    toolAllowlist: [],
    workspaceScope: [],
    defaultBudgets: {
      maxToolCalls: 2,
      timeoutMs: 30_000,
      maxCost: 1,
      maxConcurrency: 1,
    },
    authorityCeiling: 'A0',
    state: 'active',
    createdAt: 1,
    updatedAt: 1,
  };
}

function jobFor({
  id,
  skill,
  profile,
  trigger,
  nextRunAt = trigger.nextRunAt,
  lastRunId = null,
  updatedAt = 1,
} = {}) {
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id,
    name: `Job ${id}`,
    skillRef: { id: skill.id, version: skill.version, contentHash: skill.contentHash },
    trigger,
    agentProfileId: profile.id,
    inputTemplate: { subject: id },
    authorityEnvelope: {
      ceiling: 'A0',
      allowedKinds: [],
      allowedTools: [],
      allowedTargets: [],
      workspaceRoots: [],
      expiresAt: null,
      maxRuns: 1,
      maxCost: 1,
      requiresFreshApprovalFor: [],
    },
    deliveryPolicy: { mode: 'none' },
    state: 'scheduled',
    nextRunAt,
    lastRunId,
    createdAt: 1,
    updatedAt,
  };
}

function runtimeFor(dir, now) {
  return new CanonicalAutomationRuntime({
    dir,
    env: demoEnv(),
    tools: demoTools(),
    memStore: new MemoryStore(dir),
    withMemory: (task) => task(),
    now: () => now.value,
    modelFor: () => ({ async respond() { return 'done'; } }),
  });
}

async function seedRuntime(runtime, { skills, profiles, jobs }) {
  await runtime.ready();
  await runtime.skillStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills });
  await runtime.profileStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, profiles });
  await runtime.jobStore.save({
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    candidates: [],
    jobs,
  });
}

test('AC-7 restart preserves the terminal AgentRun and does not replay one occurrence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-ac7-restart-'));
  const now = { value: 100 };
  const skill = activeSkill();
  const profile = activeProfile();
  const trigger = {
    kind: 'once', timezone: 'UTC', at: 100,
    misfirePolicy: 'catch_up_once', nextRunAt: 100,
  };
  const first = runtimeFor(dir, now);
  await seedRuntime(first, {
    skills: [skill], profiles: [profile],
    jobs: [jobFor({ id: 'restart-job', skill, profile, trigger })],
  });

  const initial = await first.tick();
  assert.equal(initial.runs.length, 1);
  assert.equal(initial.runs[0].status, 'succeeded');

  now.value = 1_000;
  const restarted = runtimeFor(dir, now);
  await restarted.ready();
  const recovered = await restarted.tick({ recovering: true });
  assert.equal(recovered.runs.length, 0, 'restart must not replay the consumed occurrence');
  const ledger = await restarted.runLedger.load();
  assert.equal(ledger.runs.length, 1);
  assert.equal(ledger.runs[0].status, 'succeeded');
});

test('AC-7 restart resolves a stale claimed AgentRun instead of leaving a ghost owner', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-ac7-stale-claim-'));
  const skill = activeSkill('stale-skill');
  const profile = activeProfile('stale-agent');
  const trigger = {
    kind: 'once', timezone: 'UTC', at: 100,
    misfirePolicy: 'catch_up_once', nextRunAt: null,
  };
  const job = jobFor({
    id: 'stale-job', skill, profile, trigger,
    nextRunAt: null, lastRunId: 'run-stale', updatedAt: 100,
  });
  const queued = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'run-stale',
    jobId: job.id,
    scheduledFor: 100,
    idempotencyKey: agentRunIdempotencyKey({
      jobId: job.id,
      scheduledFor: 100,
      skillVersion: skill.version,
      skillHash: skill.contentHash,
    }),
    skillSnapshot: skill,
    triggerSnapshot: { ...trigger, nextRunAt: 100 },
    inputSnapshot: job.inputTemplate,
    agentSnapshot: profile,
    authorityEnvelope: job.authorityEnvelope,
    status: 'queued',
    owner: null,
    heartbeatAt: null,
    budgets: profile.defaultBudgets,
    receipts: [],
    result: null,
    deliveryState: { status: 'not_requested' },
    startedAt: null,
    finishedAt: null,
  };
  const claimed = claimAgentRun(
    queued,
    { pid: 999_999, ownerToken: 'dead-process-owner' },
    100,
  ).record;
  const ledger = new AutomationRunLedger(dir);
  await ledger.append(queued);
  await ledger.append(claimed);

  const now = { value: 10 * 60_000 };
  const restarted = runtimeFor(dir, now);
  await seedRuntime(restarted, { skills: [skill], profiles: [profile], jobs: [job] });
  await restarted.tick({ recovering: true });

  const durable = (await restarted.runLedger.load()).runs.find((run) => run.id === claimed.id);
  assert.equal(durable.status, 'unknown', 'a previous-process claim cannot remain active forever');
  assert.equal(durable.finishedAt, now.value);
});

test('AC-7 recovery applies skip and catch_up_once misfire policies through AgentRun', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-ac7-misfire-'));
  const now = { value: 550 };
  const skill = activeSkill('misfire-skill');
  const profile = activeProfile('misfire-agent');
  const trigger = (misfirePolicy) => ({
    kind: 'interval', timezone: 'UTC', intervalMs: 100,
    misfirePolicy, nextRunAt: 100,
  });
  const runtime = runtimeFor(dir, now);
  await seedRuntime(runtime, {
    skills: [skill], profiles: [profile],
    jobs: [
      jobFor({ id: 'catch-up-job', skill, profile, trigger: trigger('catch_up_once') }),
      jobFor({ id: 'skip-job', skill, profile, trigger: trigger('skip') }),
    ],
  });

  const result = await runtime.tick({ recovering: true });
  assert.deepEqual(result.runs.map((run) => run.jobId), ['catch-up-job']);
  assert.equal(result.runs[0].scheduledFor, 500, 'catch-up is bounded to the latest missed occurrence');
  const jobs = (await runtime.jobStore.load()).jobs;
  assert.equal(jobs.find((job) => job.id === 'catch-up-job').nextRunAt, 600);
  assert.equal(jobs.find((job) => job.id === 'skip-job').nextRunAt, 600);
  assert.equal(jobs.find((job) => job.id === 'skip-job').lastRunId, null);
  assert.equal((await runtime.runLedger.load()).runs.length, 1);
});

test('AC-7 canonical update and workspace migration preserve both writers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-ac7-migration-race-'));
  const legacyJob = {
    id: 'legacy-job',
    statement: 'Read a durable file',
    action: { tool: 'local.file', args: { action: 'read', path: '/tmp/input.txt' } },
    state: 'scheduled',
    createdAt: 1,
    nextRunAt: 2,
    intervalMs: 1_000,
    grantScope: { kind: 'persist' },
    external: false,
    executions: [],
  };
  await writeFile(join(dir, 'automation.json'), JSON.stringify({
    candidates: [], jobs: [legacyJob],
  }), 'utf8');
  const store = new AutomationJobStore(dir);
  const partial = await store.load();
  assert.equal(partial.jobs[0].state, 'needs_review');

  let releaseUpdate;
  let updateLoaded;
  const updateGate = new Promise((resolve) => { releaseUpdate = resolve; });
  const loaded = new Promise((resolve) => { updateLoaded = resolve; });
  const updating = store.update(async (state) => {
    updateLoaded();
    await updateGate;
    return {
      ...state,
      candidates: [...state.candidates, { candidateId: 'during-migration' }],
    };
  });
  await loaded;
  const migrating = migrateAutomationWorkspaceV1(dir, 20);
  releaseUpdate();
  await Promise.all([updating, migrating]);

  const finalState = await store.load();
  assert.equal(finalState.candidates.some((entry) => entry.candidateId === 'during-migration'), true);
  assert.equal(finalState.jobs[0].state, 'scheduled', 'migration repair must survive a concurrent canonical update');
  assert.equal(finalState.jobs[0].agentProfileId, 'legacy-default-agent');
});

test('AC-7 stopping during startup leaves no scheduler timer or process listener', async () => {
  let releaseReconcile;
  let reconcileStarted;
  const gate = new Promise((resolve) => { releaseReconcile = resolve; });
  const started = new Promise((resolve) => { reconcileStarted = resolve; });
  const listenerCounts = Object.fromEntries(
    ['beforeExit', 'exit', 'SIGINT', 'SIGTERM'].map((name) => [name, process.listenerCount(name)]),
  );
  const scheduler = new AutomationScheduler({
    stateSource: async () => { reconcileStarted(); await gate; return { jobs: [], skills: [], profiles: [] }; },
    runLedger: new AutomationRunLedger(await mkdtemp(join(tmpdir(), 't5-ac7-shutdown-'))),
    jobStore: new AutomationJobStore(await mkdtemp(join(tmpdir(), 't5-ac7-shutdown-jobs-'))),
    applyJobDeltas: async () => ({ ok: true, applied: 0 }),
    recordHeartbeat: async () => ({ ok: true }),
    owner: { pid: process.pid, ownerToken: 'shutdown-owner' },
    intervalMs: 5,
  });

  scheduler.start();
  await started;
  scheduler.stop();
  releaseReconcile();
  await scheduler.ready();

  assert.equal(scheduler._timer, null, 'startup completion must not resurrect a stopped interval');
  assert.equal(scheduler._active, false);
  for (const [name, count] of Object.entries(listenerCounts)) {
    assert.equal(process.listenerCount(name), count, `scheduler must not leak ${name} listeners`);
  }
});
