import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_RUN_STATES,
  AUTOMATION_SCHEMA_VERSION,
  authorityWithin,
  childToolAllowlist,
  contentHash,
  markSkillStale,
  migrateAutomationJobV1,
  migrateAutomationStateV1,
  migrateSkillDefinitionV1,
  migrateSkillsStateV1,
  reviseSkillDefinition,
  rollbackSkillDefinition,
  reviewJobSkillBinding,
  transitionState,
  validateAgentProfile,
  validateAgentRun,
  validateAuthorityEnvelope,
  validateAutomationJob,
  validateSkillDefinition,
  validateTriggerSpec,
} from '../src/kernel/l5-growth/automation-contracts.js';

const now = 100;

const envelope = (patch = {}) => ({
  ceiling: 'A1',
  allowedKinds: ['local.file'],
  allowedTargets: [],
  workspaceRoots: ['/tmp/work'],
  expiresAt: null,
  maxRuns: 1,
  maxCost: null,
  requiresFreshApprovalFor: [],
  ...patch,
});

const skill = (patch = {}) => {
  const base = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'skill-1',
    name: '주간 보고 정리',
    purpose: '자료를 읽고 짧은 목록으로 정리',
    version: 1,
    contentHash: '',
    inputs: [],
    steps: [{ principle: '현재 자료를 먼저 확인' }],
    resultContract: { kind: 'summary' },
    requiredCapabilities: ['local.file'],
    authorityHints: ['read'],
    replayCases: [{ kind: 'positive' }, { kind: 'negative' }, { kind: 'boundary' }],
    source: { kind: 'user_proposal', sessionId: 's1', traceIds: ['t1'] },
    state: 'active',
    createdAt: now,
    updatedAt: now,
    previousVersion: null,
    ...patch,
  };
  base.contentHash ||= contentHash({
    name: base.name,
    purpose: base.purpose,
    inputs: base.inputs,
    steps: base.steps,
    resultContract: base.resultContract,
    requiredCapabilities: base.requiredCapabilities,
    authorityHints: base.authorityHints,
    replayCases: base.replayCases,
  });
  return base;
};

const trigger = (patch = {}) => ({
  kind: 'weekly',
  timezone: 'Asia/Seoul',
  weekdays: [1],
  localTime: '09:00',
  misfirePolicy: 'catch_up_once',
  nextRunAt: 200,
  ...patch,
});

const profile = (patch = {}) => ({
  schemaVersion: AUTOMATION_SCHEMA_VERSION,
  id: 'agent-1',
  name: '보고 담당',
  purpose: '보고 자료를 읽고 정리',
  modelRole: 'worker',
  toolAllowlist: ['local.file'],
  workspaceScope: ['/tmp/work'],
  defaultBudgets: { maxToolCalls: 8, timeoutMs: 60_000 },
  authorityCeiling: 'A1',
  state: 'active',
  createdAt: now,
  updatedAt: now,
  ...patch,
});

const job = (patch = {}) => ({
  schemaVersion: AUTOMATION_SCHEMA_VERSION,
  id: 'job-1',
  name: '월요일 보고',
  skillRef: { id: 'skill-1', version: 1, contentHash: skill().contentHash },
  trigger: trigger(),
  agentProfileId: 'agent-1',
  inputTemplate: {},
  authorityEnvelope: envelope(),
  deliveryPolicy: { mode: 'none' },
  state: 'scheduled',
  nextRunAt: 200,
  lastRunId: null,
  createdAt: now,
  updatedAt: now,
  ...patch,
});

const run = (patch = {}) => ({
  schemaVersion: AUTOMATION_SCHEMA_VERSION,
  id: 'run-1',
  jobId: 'job-1',
  scheduledFor: 200,
  idempotencyKey: 'job-1:200:1:hash',
  skillSnapshot: skill(),
  triggerSnapshot: trigger(),
  agentSnapshot: profile(),
  authorityEnvelope: envelope(),
  status: 'queued',
  owner: null,
  heartbeatAt: null,
  budgets: { maxToolCalls: 8, timeoutMs: 60_000 },
  receipts: [],
  result: null,
  deliveryState: { status: 'not_requested' },
  startedAt: null,
  finishedAt: null,
  ...patch,
});

test('AC-1: six contracts accept complete records and reject missing facts', () => {
  assert.equal(validateSkillDefinition(skill()).ok, true);
  assert.equal(validateTriggerSpec(trigger()).ok, true);
  assert.equal(validateAgentProfile(profile()).ok, true);
  assert.equal(validateAutomationJob(job()).ok, true);
  assert.equal(validateAgentRun(run()).ok, true);
  assert.equal(validateAuthorityEnvelope(envelope()).ok, true);

  assert.equal(validateSkillDefinition(skill({ contentHash: 'guess' })).ok, false);
  assert.equal(validateTriggerSpec(trigger({ weekdays: [] })).ok, false);
  assert.equal(validateAgentProfile(profile({ authorityCeiling: 'A3' })).ok, false);
  assert.equal(validateAutomationJob(job({ skillRef: { id: 'skill-1', version: 1, contentHash: 'guess' } })).ok, false);
  assert.equal(validateAgentRun(run({ idempotencyKey: '' })).ok, false);
});

test('AC-1: authority never admits A3 or an unbounded repeated A2 grant', () => {
  assert.equal(validateAuthorityEnvelope(envelope({ ceiling: 'A3' })).ok, false);
  const unbounded = envelope({
    ceiling: 'A2',
    allowedKinds: ['send'],
    allowedTargets: [],
    maxRuns: 10,
    expiresAt: null,
  });
  const checked = validateAuthorityEnvelope(unbounded);
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.some((error) => error.includes('fixed allowedTargets')));
  assert.ok(checked.errors.some((error) => error.includes('expiresAt')));
});

test('AC-1: child tools are a strict subset and deny recursive, memory, automation, and send powers', () => {
  const parent = [
    'local.file', 'agent.delegate', 'automation.create',
    'memory.propose', 'telegram.send', 'send.message',
  ];
  assert.deepEqual(
    childToolAllowlist(parent, [...parent, 'not-owned']),
    ['local.file'],
  );
});

test('AC-1: one transition boundary rejects shortcuts and terminal resurrection', () => {
  assert.equal(transitionState('automationJob', job({ state: 'proposed' }), 'scheduled', 200).ok, false);
  assert.equal(transitionState('automationJob', job({ state: 'proposed' }), 'approved', 200).ok, true);
  assert.equal(transitionState('agentRun', run({ status: 'queued' }), 'running', 200).ok, false);
  const ended = run({ status: 'succeeded', finishedAt: 200 });
  assert.equal(transitionState('agentRun', ended, 'running', 300).ok, false);
  assert.ok(AGENT_RUN_STATES.includes('unknown'), 'unknown must remain distinct from failed');
});

test('AC-1: a run envelope cannot be wider than its parent approval', () => {
  const parent = envelope({
    ceiling: 'A2',
    allowedKinds: ['send', 'read'],
    allowedTargets: ['오너'],
    workspaceRoots: ['/tmp/work'],
    expiresAt: 500,
    maxRuns: 5,
    maxCost: 10,
    requiresFreshApprovalFor: ['delivery'],
  });
  const narrower = envelope({
    ceiling: 'A1',
    allowedKinds: ['read'],
    allowedTargets: [],
    workspaceRoots: ['/tmp/work'],
    expiresAt: 400,
    maxRuns: 1,
    maxCost: 2,
    requiresFreshApprovalFor: ['delivery'],
  });
  assert.equal(authorityWithin(parent, narrower), true);
  assert.equal(authorityWithin(parent, { ...narrower, ceiling: 'A2', allowedTargets: ['다른 사람'] }), false);
  assert.equal(authorityWithin(parent, { ...narrower, requiresFreshApprovalFor: [] }), false);
});

test('AC-1: a job never drifts to a changed skill version or hash', () => {
  const currentJob = job();
  assert.equal(reviewJobSkillBinding(currentJob, skill(), 200).changed, false);
  const changedSkill = reviseSkillDefinition(skill(), { purpose: '달라진 방법' }, 200);
  const reviewed = reviewJobSkillBinding(currentJob, changedSkill, 300);
  assert.equal(reviewed.ok, true);
  assert.equal(reviewed.record.state, 'needs_review');
  assert.equal(reviewed.reason, 'skill_binding_changed');
});

test('AC-1: skill revision is version/hash bound, stale is explicit, and rollback restores the snapshot', () => {
  const first = skill();
  const revised = reviseSkillDefinition(first, { purpose: '이번 자료에 맞춰 보고를 다시 정리' }, 200);
  assert.equal(revised.version, 2);
  assert.notEqual(revised.contentHash, first.contentHash);
  assert.equal(revised.state, 'proposed');
  assert.equal(revised.previousVersion.contentHash, first.contentHash);

  const ready = { ...revised, state: 'active' };
  const stale = markSkillStale(ready, 250);
  assert.equal(stale.ok, true);
  assert.equal(stale.record.state, 'stale');
  assert.equal(stale.record.staleFromHash, revised.contentHash);

  const rolled = rollbackSkillDefinition(revised, 300);
  assert.equal(rolled.ok, true);
  assert.equal(rolled.record.version, 1);
  assert.equal(rolled.record.contentHash, first.contentHash);
  assert.equal(rolled.record.rolledBackFrom.version, 2);
});

test('AC-1: legacy skill migration is lossless and does not turn approval into execution authority', () => {
  const legacy = {
    id: 'old-skill',
    state: 'admitted',
    label: '지난 보고 방식',
    trigger: '주간 보고 정리',
    steps: ['자료 읽기', '목록 정리'],
    tool: 'local.file',
    fromTraceIds: ['trace-1'],
    userConfirmed: true,
    replayPassed: true,
    createdAt: 10,
    unknownField: { preserved: true },
  };
  const migrated = migrateSkillDefinitionV1(legacy, 20);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.state, 'active');
  assert.deepEqual(migrated.legacyV1, legacy);
  assert.deepEqual(migrated.requiredCapabilities, ['local.file']);
  assert.deepEqual(migrated.authorityHints, [], 'skill migration must not invent an execution grant');
  assert.equal(validateSkillDefinition(migrated).ok, true);

  const state = migrateSkillsStateV1({ skills: [legacy] }, 20);
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.skills.length, 1);
});

test('AC-1: legacy jobs migrate without losing action or receipts and bind a stable skill snapshot', () => {
  const legacy = {
    id: 'old-job',
    statement: '매주 보고 폴더 읽기',
    action: { tool: 'local.file', args: { action: 'list', path: '/tmp/work' } },
    state: 'scheduled',
    createdAt: 10,
    nextRunAt: 20,
    intervalMs: 60_000,
    grantScope: { kind: 'persist' },
    external: false,
    executions: [{ failureState: 'none' }],
    extra: 'preserve-me',
  };
  const migrated = migrateAutomationJobV1(legacy, 30);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.state, 'scheduled');
  assert.equal(migrated.trigger.kind, 'interval');
  assert.equal(migrated.skillRef.version, 1);
  assert.equal(migrated.skillRef.contentHash.length, 64);
  assert.deepEqual(migrated.legacyV1, legacy);
  assert.equal(validateAutomationJob(migrated).ok, true);

  const state = migrateAutomationStateV1({ candidates: [{ id: 'c1' }], jobs: [legacy] }, 30);
  assert.deepEqual(state.candidates, [{ id: 'c1' }], 'unapproved candidates are not dropped');
  assert.deepEqual(state.jobs[0].legacyV1.executions, legacy.executions, 'run history remains available for audit');
});
