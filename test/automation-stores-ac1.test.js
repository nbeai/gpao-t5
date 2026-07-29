import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillDefinitionStore, SkillStore } from '../src/surface/skill-store.js';
import { AutomationJobStore, AutomationStore } from '../src/surface/automation-store.js';
import { AgentProfileStore } from '../src/surface/agent-profile-store.js';
import { AutomationRunLedger } from '../src/surface/automation-run-ledger.js';
import { migrateAutomationWorkspaceV1 } from '../src/surface/automation-workspace-migration.js';
import {
  AUTOMATION_SCHEMA_VERSION,
  agentRunIdempotencyKey,
  claimAgentRun,
  contentHash,
  migrateSkillDefinitionV1,
  transitionState,
  validateAutomationReferences,
} from '../src/kernel/l5-growth/automation-contracts.js';
import { canInfluence } from '../src/kernel/l5-growth/skill-learning.js';
import { tickAutomation } from '../src/runtime/automation-engine.js';
import { approveAutomation } from '../src/kernel/l5-growth/automation.js';

const privateMode = async (file) => (await stat(file)).mode & 0o777;

const legacySkill = {
  id: 'legacy-skill',
  state: 'admitted',
  label: '정산 정리',
  trigger: '정산 정리해줘',
  steps: ['자료 읽기'],
  tool: 'local.file',
  fromTraceIds: ['t1'],
  userConfirmed: true,
  replayPassed: true,
  createdAt: 1,
};

const legacyJob = {
  id: 'legacy-job',
  statement: '매일 자료 확인',
  action: { tool: 'local.file', args: { action: 'list', path: '/tmp/work' } },
  state: 'scheduled',
  createdAt: 1,
  nextRunAt: 2,
  intervalMs: 1000,
  grantScope: { kind: 'persist' },
  external: false,
  executions: [],
};

const authority = {
  ceiling: 'A1',
  allowedKinds: ['local.file'],
  allowedTargets: [],
  workspaceRoots: ['/tmp/work'],
  expiresAt: null,
  maxRuns: 1,
  maxCost: null,
  requiresFreshApprovalFor: [],
};

const profile = {
  schemaVersion: AUTOMATION_SCHEMA_VERSION,
  id: 'agent-1',
  name: '정리 담당',
  purpose: '자료 정리',
  modelRole: 'worker',
  toolAllowlist: ['local.file'],
  workspaceScope: ['/tmp/work'],
  defaultBudgets: { maxToolCalls: 4 },
  authorityCeiling: 'A1',
  state: 'active',
  createdAt: 1,
  updatedAt: 1,
};

function run(id = 'run-1') {
  const skill = migrateSkillDefinitionV1(legacySkill, 1);
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id,
    jobId: 'job-1',
    scheduledFor: 2,
    idempotencyKey: agentRunIdempotencyKey({
      jobId: 'job-1', scheduledFor: 2, skillVersion: skill.version, skillHash: skill.contentHash,
    }),
    skillSnapshot: skill,
    triggerSnapshot: {
      kind: 'once', timezone: 'UTC', at: 2, misfirePolicy: 'skip', nextRunAt: 2,
    },
    agentSnapshot: profile,
    authorityEnvelope: authority,
    status: 'queued',
    owner: null,
    heartbeatAt: null,
    budgets: { maxToolCalls: 4 },
    receipts: [],
    result: null,
    deliveryState: { status: 'not_requested' },
    startedAt: null,
    finishedAt: null,
  };
}

test('AC-1 stores migrate v1 files in place without dropping legacy bytes and write mode 0600', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-ac1-migrate-'));
  await writeFile(join(dir, 'skills.json'), JSON.stringify({ skills: [legacySkill] }), 'utf8');
  await writeFile(join(dir, 'automation.json'), JSON.stringify({ candidates: [{ candidateId: 'c1' }], jobs: [legacyJob] }), 'utf8');

  const skills = await new SkillDefinitionStore(dir).load();
  const automation = await new AutomationJobStore(dir).load();

  assert.equal(skills.schemaVersion, 2);
  assert.deepEqual(skills.skills[0].legacyV1, legacySkill);
  assert.equal(automation.schemaVersion, 2);
  assert.deepEqual(automation.candidates, [{ candidateId: 'c1' }]);
  assert.deepEqual(automation.jobs[0].legacyV1, legacyJob);
  assert.equal(await privateMode(join(dir, 'skills.json')), 0o600);
  assert.equal(await privateMode(join(dir, 'automation.json')), 0o600);

  const onDisk = JSON.parse(await readFile(join(dir, 'skills.json'), 'utf8'));
  assert.equal(onDisk.schemaVersion, 2, 'migration must persist before later writers see v1 again');
  const oldSkills = await new SkillStore(dir).load();
  assert.equal(canInfluence(oldSkills.skills[0]), true, 'old reader must preserve admitted influence during staged migration');
  const oldAutomation = await new AutomationStore(dir).load();
  assert.equal(oldAutomation.jobs[0].state, 'needs_review');
  assert.deepEqual(oldAutomation.jobs[0].action, legacyJob.action, 'safe stop must not lose the old action');
});

test('AC-1 stores reject invalid records before replacing valid state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-ac1-reject-'));
  const store = new SkillDefinitionStore(dir);
  const valid = migrateSkillDefinitionV1(legacySkill, 1);
  await store.save({ schemaVersion: 2, skills: [valid] });
  const before = await readFile(join(dir, 'skills.json'), 'utf8');

  const invalid = { ...valid, state: 'teleporting' };
  await assert.rejects(
    store.save({ schemaVersion: 2, skills: [invalid] }),
    /skill definition invalid/,
  );
  assert.equal(await readFile(join(dir, 'skills.json'), 'utf8'), before);
});

test('AC-1 corrupted state is preserved in quarantine and reported instead of becoming silent empty history', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-ac1-corrupt-'));
  const file = join(dir, 'skills.json');
  const broken = '{"skills":[{"id":';
  await writeFile(file, broken, 'utf8');

  const loaded = await new SkillDefinitionStore(dir).load();
  assert.equal(loaded.skills.length, 0);
  assert.equal(loaded.recovery.corrupted, true);
  assert.equal(await readFile(loaded.recovery.quarantinedFile, 'utf8'), broken);
  assert.equal(await privateMode(loaded.recovery.quarantinedFile), 0o600);
});

test('AC-1 agent profiles are validated and private on disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-ac1-agent-'));
  const store = new AgentProfileStore(dir);
  await store.save({ schemaVersion: 2, profiles: [profile] });
  assert.deepEqual((await store.load()).profiles, [profile]);
  assert.equal(await privateMode(join(dir, 'agent-profiles.json')), 0o600);
  await assert.rejects(
    store.save({ schemaVersion: 2, profiles: [{ ...profile, authorityCeiling: 'A3' }] }),
    /agent profile invalid/,
  );
});

test('AC-1 run ledger records lifecycle events and maintains a separate current snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-ac1-runs-'));
  const ledger = new AutomationRunLedger(dir);
  const queued = run();
  await ledger.append(queued);
  const claimed = claimAgentRun(queued, { pid: 42, ownerToken: 'owner-token' }, 3).record;
  await ledger.append(claimed);
  const running = transitionState('agentRun', claimed, 'running', 4, { heartbeatAt: 4 }).record;
  await ledger.append(running);
  const succeeded = transitionState('agentRun', running, 'succeeded', 5, { finishedAt: 5 }).record;
  await ledger.append(succeeded);
  const loaded = await ledger.load();
  assert.equal(loaded.runs.length, 1);
  assert.equal(loaded.runs[0].status, 'succeeded');
  assert.deepEqual(loaded.events.map((event) => event.to), ['queued', 'claimed', 'running', 'succeeded']);
  const snapshot = JSON.parse(await readFile(join(dir, 'automation-run-state.json'), 'utf8'));
  assert.equal(snapshot.runs[0].status, 'succeeded');
  assert.equal(await privateMode(join(dir, 'automation-runs.jsonl')), 0o600);
  assert.equal(await privateMode(join(dir, 'automation-run-state.json')), 0o600);
  await assert.rejects(ledger.append({ ...run('run-2'), authorityEnvelope: { ...authority, ceiling: 'A3' } }), /agent run invalid/);
});

test('AC-1 run ledger independently rejects snapshot, authority, and budget expansion', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-ac1-run-envelope-'));
  const ledger = new AutomationRunLedger(dir);
  const queued = run();
  await ledger.append(queued);
  const claimed = claimAgentRun(queued, { pid: 42, ownerToken: 'owner-token' }, 3).record;
  const attempts = [
    {
      ...claimed,
      authorityEnvelope: {
        ...claimed.authorityEnvelope,
        ceiling: 'A2',
        allowedKinds: [...claimed.authorityEnvelope.allowedKinds, 'send'],
      },
    },
    {
      ...claimed,
      skillSnapshot: migrateSkillDefinitionV1({
        ...legacySkill,
        id: 'changed-skill',
      }, 1),
    },
    {
      ...claimed,
      triggerSnapshot: {
        ...claimed.triggerSnapshot,
        at: 99,
        nextRunAt: 99,
      },
    },
    {
      ...claimed,
      agentSnapshot: {
        ...claimed.agentSnapshot,
        toolAllowlist: [...claimed.agentSnapshot.toolAllowlist, 'slack.post'],
      },
    },
    {
      ...claimed,
      budgets: { ...claimed.budgets, maxToolCalls: 999 },
    },
  ];
  for (const attempt of attempts) {
    await assert.rejects(ledger.append(attempt), /immutable snapshots, authority, or budgets changed/);
  }
  assert.equal((await ledger.load()).events.length, 1);
});

test('AC-1 run ledger rejects owner theft, time rollback, and receipt rewriting', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-ac1-run-identity-'));
  const ledger = new AutomationRunLedger(dir);
  const queued = run();
  await ledger.append(queued);
  const claimed = claimAgentRun(queued, { pid: 42, ownerToken: 'owner-A' }, 3).record;
  await ledger.append(claimed);
  const receipt = { id: 'receipt-1', lifecycle: 'executed' };
  const running = transitionState('agentRun', claimed, 'running', 4, {
    heartbeatAt: 4,
    receipts: [receipt],
  }).record;
  await ledger.append(running);

  const attempts = [
    { ...running, status: 'waiting_approval', updatedAt: 5, heartbeatAt: 5,
      owner: { pid: 99, ownerToken: 'owner-B' } },
    { ...running, status: 'waiting_approval', updatedAt: 5, heartbeatAt: 5, startedAt: 999 },
    { ...running, status: 'waiting_approval', updatedAt: 5, heartbeatAt: 2 },
    { ...running, status: 'waiting_approval', updatedAt: 2, heartbeatAt: 5 },
    { ...running, status: 'waiting_approval', updatedAt: 5, heartbeatAt: 5, receipts: [] },
    { ...running, status: 'waiting_approval', updatedAt: 5, heartbeatAt: 5,
      receipts: [{ ...receipt, lifecycle: 'changed' }] },
  ];
  for (const attempt of attempts) {
    await assert.rejects(ledger.append(attempt));
  }
  const loaded = await ledger.load();
  assert.equal(loaded.events.length, 3);
  assert.deepEqual(loaded.runs[0].owner, { pid: 42, ownerToken: 'owner-A' });
  assert.deepEqual(loaded.runs[0].receipts, [receipt]);
});

test('AC-1 run events remain truth when snapshot projection fails and rebuild idempotently', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-ac1-run-projection-'));
  const stateFile = join(dir, 'automation-run-state.json');
  const eventFile = join(dir, 'automation-runs.jsonl');
  await mkdir(stateFile);
  const ledger = new AutomationRunLedger(dir);
  const queued = run();

  const first = await ledger.append(queued);
  assert.equal(first.eventWritten, true);
  assert.equal(first.snapshotWritten, false);
  assert.equal((await ledger.load()).runs[0].status, 'queued');
  assert.equal((await ledger.load()).snapshotProjection.written, false);
  assert.equal((await readFile(eventFile, 'utf8')).trim().split('\n').length, 1);

  await rm(stateFile, { recursive: true });
  const retried = await ledger.append(queued);
  assert.equal(retried.idempotent, true);
  assert.equal(retried.snapshotWritten, true);
  assert.equal((await readFile(eventFile, 'utf8')).trim().split('\n').length, 1);
  assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).runs[0].status, 'queued');

  await writeFile(stateFile, JSON.stringify({ schemaVersion: 2, runs: [] }), 'utf8');
  const rebuilt = await ledger.load();
  assert.equal(rebuilt.snapshotProjection.repaired, true);
  assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).runs[0].id, queued.id);
});

test('AC-1 run append is serialized: distinct runs are lossless and one occurrence is claimed once', async () => {
  for (let i = 0; i < 30; i++) {
    const dir = await mkdtemp(join(tmpdir(), 't5-ac1-run-race-'));
    const ledger = new AutomationRunLedger(dir);
    const a = run(`a-${i}`);
    const b = {
      ...run(`b-${i}`),
      scheduledFor: 10 + i,
    };
    b.idempotencyKey = agentRunIdempotencyKey({
      jobId: b.jobId,
      scheduledFor: b.scheduledFor,
      skillVersion: b.skillSnapshot.version,
      skillHash: b.skillSnapshot.contentHash,
    });
    const distinct = await Promise.allSettled([ledger.append(a), ledger.append(b)]);
    assert.deepEqual(distinct.map((item) => item.status), ['fulfilled', 'fulfilled']);
    assert.equal((await ledger.load()).runs.length, 2);
  }

  for (let i = 0; i < 30; i++) {
    const dir = await mkdtemp(join(tmpdir(), 't5-ac1-claim-race-'));
    const ledger = new AutomationRunLedger(dir);
    const a = run(`claim-a-${i}`);
    const b = { ...run(`claim-b-${i}`) };
    const same = await Promise.allSettled([ledger.append(a), ledger.append(b)]);
    assert.equal(same.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(same.filter((item) => item.status === 'rejected').length, 1);
    assert.equal((await ledger.load()).runs.length, 1);
  }
});

test('AC-1 run ledger quarantines a torn line and does not append across unreviewed corruption', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-ac1-run-corrupt-'));
  const file = join(dir, 'automation-runs.jsonl');
  const broken = `${JSON.stringify(run())}\n{"schemaVersion":2`;
  await writeFile(file, broken, 'utf8');
  const ledger = new AutomationRunLedger(dir);
  await assert.rejects(ledger.append(run('run-2')), /corrupted/, 'append must stop on the first corrupt read');
  const quarantined = (await import('node:fs/promises')).readdir(dir);
  assert.ok((await quarantined).some((name) => name.startsWith('automation-runs.jsonl.corrupt-')));
  await writeFile(file, broken, 'utf8');
  const loaded = await ledger.load();
  assert.equal(loaded.recovery.corrupted, true);
  assert.equal(await readFile(loaded.recovery.quarantinedFile, 'utf8'), broken);
  assert.equal(await privateMode(loaded.recovery.quarantinedFile), 0o600);
  assert.equal((await ledger.load()).runs.length, 0);
});

test('AC-1 workspace migration preserves old admitted influence and scheduled action consumption', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-ac1-compat-'));
  await writeFile(join(dir, 'skills.json'), JSON.stringify({ skills: [legacySkill] }), 'utf8');
  await writeFile(join(dir, 'automation.json'), JSON.stringify({ candidates: [], jobs: [legacyJob] }), 'utf8');

  const migrated = await migrateAutomationWorkspaceV1(dir, 10);
  assert.equal(migrated.skills.skills.some((entry) => entry.id === 'legacy-action:legacy-job'), true);
  assert.equal(migrated.profiles.profiles.some((entry) => entry.id === 'legacy-default-agent'), true);
  assert.equal(migrated.automation.jobs[0].state, 'scheduled');
  assert.equal(validateAutomationReferences({
    skills: migrated.skills.skills,
    profiles: migrated.profiles.profiles,
    jobs: migrated.automation.jobs,
  }).ok, true);

  const oldSkills = await new SkillStore(dir).load();
  assert.equal(oldSkills.schemaVersion, 2);
  assert.equal(oldSkills.skills[0].state, 'admitted');
  assert.equal(canInfluence(oldSkills.skills[0]), true);
  oldSkills.skills[0].state = 'rejected';
  await new SkillStore(dir).save(oldSkills);
  assert.equal((await new SkillDefinitionStore(dir).load()).skills
    .find((entry) => entry.id === legacySkill.id).state, 'rejected',
  'old skill writer must preserve the v2 envelope and lifecycle meaning');

  const oldAutomation = await new AutomationStore(dir).load();
  assert.equal(oldAutomation.schemaVersion, 2);
  assert.equal(oldAutomation.jobs[0].state, 'scheduled');
  assert.deepEqual(oldAutomation.jobs[0].action, legacyJob.action);
  let calls = 0;
  const receipt = {
    intended: 'legacy read',
    actualCall: { tool: 'local.file', args: legacyJob.action.args },
    result: {},
    userSafeSummary: '읽었어요.',
    failureState: 'none',
    diagnosticTrace: [],
    lifecycle: 'executed',
  };
  await tickAutomation(oldAutomation.jobs, {
    tools: { run: async () => { calls += 1; return receipt; } },
    selfState: { connectedTools: [{ id: 'local.file', toolKind: 'read' }] },
    now: 20,
  });
  assert.equal(calls, 1);
  await new AutomationStore(dir).save(oldAutomation);
  const reloaded = await new AutomationStore(dir).load();
  assert.equal(reloaded.jobs[0].executions.length, 1);
  const canonical = await new AutomationJobStore(dir).load();
  assert.equal(canonical.jobs[0].legacyV1.executions.length, 1, 'old writer must save back without collapsing v2');
  reloaded.jobs[0].state = 'cancelled';
  await new AutomationStore(dir).save(reloaded);
  assert.equal((await new AutomationJobStore(dir).load()).jobs[0].state, 'cancelled',
    'old cancel path must remain effective after migration');
});

test('AC-1 paused skill stays inactive for old readers and resumes without semantic drift', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-ac1-paused-compat-'));
  const paused = migrateSkillDefinitionV1(legacySkill, 1);
  paused.state = 'paused';
  await new SkillDefinitionStore(dir).save({ schemaVersion: 2, skills: [paused] });

  const old = await new SkillStore(dir).load();
  assert.equal(old.skills[0].state, 'paused');
  assert.equal(canInfluence(old.skills[0]), false);
  old.skills[0].state = 'admitted';
  await new SkillStore(dir).save(old);
  assert.equal((await new SkillDefinitionStore(dir).load()).skills[0].state, 'active');
});

test('AC-1 workspace migration repairs a standalone partial job migration', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-ac1-partial-order-'));
  await writeFile(join(dir, 'automation.json'), JSON.stringify({
    candidates: [],
    jobs: [legacyJob],
  }), 'utf8');

  const partial = await new AutomationJobStore(dir).load();
  assert.equal(partial.jobs[0].state, 'needs_review');
  const migrated = await migrateAutomationWorkspaceV1(dir, 20);
  assert.equal(migrated.automation.jobs[0].state, 'scheduled');
  assert.equal(migrated.skills.skills.some((entry) => entry.id === 'legacy-action:legacy-job'), true);
  assert.equal(migrated.profiles.profiles.some((entry) => entry.id === 'legacy-default-agent'), true);
  assert.equal(validateAutomationReferences({
    skills: migrated.skills.skills,
    profiles: migrated.profiles.profiles,
    jobs: migrated.automation.jobs,
  }).ok, true);
});

test('AC-1 old approval after migration persists the same runnable meaning', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-ac1-approval-compat-'));
  await writeFile(join(dir, 'skills.json'), JSON.stringify({ skills: [legacySkill] }), 'utf8');
  await writeFile(join(dir, 'automation.json'), JSON.stringify({
    candidates: [],
    jobs: [legacyJob],
  }), 'utf8');
  await migrateAutomationWorkspaceV1(dir, 10);

  const store = new AutomationStore(dir);
  const old = await store.load();
  const approved = approveAutomation({
    statement: '새 자료를 정기 확인',
    action: { tool: 'local.process', args: { action: 'list' } },
  }, {
    id: 'approved-after-v2',
    grantScope: { kind: 'persist' },
    external: false,
    now: 30,
    nextRunAt: 31,
    intervalMs: 1000,
  });
  old.jobs.push(approved);
  const saved = await store.save(old);
  assert.equal(saved.jobs.find((entry) => entry.id === approved.id).state, 'scheduled');

  const reloaded = await store.load();
  const same = reloaded.jobs.find((entry) => entry.id === approved.id);
  assert.equal(same.state, 'scheduled');
  const canonical = await new AutomationJobStore(dir).load();
  const canonicalJob = canonical.jobs.find((entry) => entry.id === approved.id);
  assert.equal(canonicalJob.state, 'scheduled');
  assert.equal(validateAutomationReferences({
    skills: (await new SkillDefinitionStore(dir).load()).skills,
    profiles: (await new AgentProfileStore(dir).load()).profiles,
    jobs: canonical.jobs,
  }).ok, true);
  assert.equal((await new AgentProfileStore(dir).load()).profiles
    .find((entry) => entry.id === 'legacy-default-agent').toolAllowlist.includes('local.process'), true);

  let calls = 0;
  await tickAutomation([same], {
    tools: {
      run: async () => {
        calls += 1;
        return {
          intended: 'legacy approved read',
          actualCall: { tool: approved.action.tool, args: approved.action.args },
          result: {},
          userSafeSummary: '읽었어요.',
          failureState: 'none',
          diagnosticTrace: [],
          lifecycle: 'executed',
        };
      },
    },
    selfState: { connectedTools: [{ id: 'local.process', toolKind: 'read' }] },
    now: 40,
  });
  assert.equal(calls, 1);
});

test('AC-1 deterministic content hashes do not depend on object key order', () => {
  assert.equal(contentHash({ a: 1, b: { c: 2 } }), contentHash({ b: { c: 2 }, a: 1 }));
});
