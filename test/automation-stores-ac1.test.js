import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillDefinitionStore } from '../src/surface/skill-store.js';
import { AutomationJobStore } from '../src/surface/automation-store.js';
import { AgentProfileStore } from '../src/surface/agent-profile-store.js';
import { AutomationRunLedger } from '../src/surface/automation-run-ledger.js';
import {
  AUTOMATION_SCHEMA_VERSION,
  contentHash,
  migrateSkillDefinitionV1,
} from '../src/kernel/l5-growth/automation-contracts.js';

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
    idempotencyKey: `job-1:2:1:${skill.contentHash}`,
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

test('AC-1 run ledger atomically appends validated snapshots and refuses duplicate run identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-ac1-runs-'));
  const ledger = new AutomationRunLedger(dir);
  await ledger.append(run());
  assert.equal((await ledger.load()).runs.length, 1);
  assert.equal(await privateMode(join(dir, 'automation-runs.jsonl')), 0o600);
  await assert.rejects(ledger.append(run()), /already exists/);
  await assert.rejects(ledger.append({ ...run('run-same-occurrence') }), /idempotency key already exists/);
  await assert.rejects(ledger.append({ ...run('run-2'), authorityEnvelope: { ...authority, ceiling: 'A3' } }), /agent run invalid/);
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
  assert.equal((await ledger.load()).runs.length, 0);
});

test('AC-1 deterministic content hashes do not depend on object key order', () => {
  assert.equal(contentHash({ a: 1, b: { c: 2 } }), contentHash({ b: { c: 2 }, a: 1 }));
});
