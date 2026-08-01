import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CanonicalAutomationRuntime, scopedAgentTools,
} from '../src/runtime/canonical-automation-runtime.js';
import { MemoryStore } from '../src/surface/memory-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import {
  AUTOMATION_SCHEMA_VERSION, contentHash, skillHashSource,
} from '../src/kernel/l5-growth/automation-contracts.js';

const cases = () => [
  { id: 'p1', kind: 'positive', inputFacts: ['one'], expectedFacts: [], forbiddenFacts: [] },
  { id: 'p2', kind: 'positive', inputFacts: ['two'], expectedFacts: [], forbiddenFacts: [] },
  { id: 'n1', kind: 'negative', inputFacts: ['other'], expectedFacts: [], forbiddenFacts: [] },
  { id: 'b1', kind: 'boundary', inputFacts: ['outside'], expectedFacts: [], forbiddenFacts: [] },
  { id: 'b2', kind: 'boundary', inputFacts: ['missing'], expectedFacts: [], forbiddenFacts: [] },
  { id: 'a1', kind: 'authority', inputFacts: ['send'], expectedFacts: [], forbiddenFacts: [] },
];

function identity() {
  return {
    selection: {
      connectionInstanceId: 'connection-1', credentialRef: 'credential-1',
      endpointOrigin: 'https://models.example', requestModelId: 'model-1',
    },
    actualEndpointOrigin: 'https://models.example',
    actualRequestModelId: 'model-1',
    responseModelId: 'model-1',
    responseIdentitySource: 'response_field',
  };
}

test('canonical runtime reuses durable T-cell replay evidence through the sole AgentRun runner', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-canonical-runtime-'));
  const memStore = new MemoryStore(dir);
  const model = {
    async respond(context, options = {}) {
      options.onCallIdentity?.(identity());
      if (context.currentRequest.includes('항목별로 판정')) {
        return JSON.stringify({ required: [], forbidden: [], rationale: 'ok' });
      }
      return '실제 replay 답';
    },
  };
  const runtime = new CanonicalAutomationRuntime({
    dir, env: demoEnv(), tools: demoTools(), memStore,
    withMemory: (task) => task(), modelFor: () => model,
  });
  await runtime.ready();
  const proposed = await runtime.skillService.propose({
    name: 'Settlement draft', purpose: 'Prepare a settlement draft',
    steps: ['Prepare the draft'], resultContract: { kind: 'draft' },
    requiredCapabilities: [], authorityHints: [], replayCases: cases(),
  }, { now: 1 });
  assert.equal(proposed.ok, true);

  const replay = await runtime.skillService.replay(proposed.skill.id, { now: 2 });
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.cases.length, 6);
  const memory = await memStore.load();
  assert.equal(memory.replayReceipts.length, 6);
  assert.equal(Object.keys(memory.replayOutputs).length, 6);
  const runs = await runtime.runLedger.load();
  assert.equal(runs.runs.length, 6);
  assert.ok(runs.runs.every((run) => run.status === 'succeeded'));

  const approval = {
    id: 'approval-1', decision: 'approved', skillId: proposed.skill.id,
    skillVersion: proposed.skill.version, skillHash: proposed.skill.contentHash,
    replayDigest: replay.replayDigest,
  };
  const approved = await runtime.skillService.approve(proposed.skill.id, { now: 3, approval });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  const activated = await runtime.skillService.activate(proposed.skill.id, { now: 4 });
  assert.equal(activated.ok, true, JSON.stringify(activated));
  assert.equal((await runtime.skillService.active()).length, 1);
});

test('replay cannot pass when the judge says pass but stored answer violates an exact fact', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-canonical-replay-negative-'));
  const memStore = new MemoryStore(dir);
  const model = {
    async respond(context, options = {}) {
      options.onCallIdentity?.(identity());
      if (context.currentRequest.includes('항목별로 판정')) {
        return JSON.stringify({ required: [], forbidden: [], rationale: 'pass' });
      }
      return '계약 문구가 없는 답';
    },
  };
  const runtime = new CanonicalAutomationRuntime({
    dir, env: demoEnv(), tools: demoTools(), memStore,
    withMemory: (task) => task(), modelFor: () => model,
  });
  const suite = cases();
  suite[0] = { ...suite[0], exactFacts: ['반드시 포함'] };
  const proposed = await runtime.skillService.propose({
    name: 'Exact replay', purpose: 'Keep an exact phrase', steps: ['Answer'],
    resultContract: { kind: 'text' }, requiredCapabilities: [], authorityHints: [], replayCases: suite,
  }, { now: 1 });
  const replay = await runtime.skillService.replay(proposed.skill.id, { now: 2 });
  assert.equal(replay.ok, false);
  assert.ok(replay.cases.some((entry) => entry.verdict?.pass === false));
});

test('agent tool boundary enforces kind, target, workspace, and declared cost before handler call', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-agent-scope-'));
  let calls = 0;
  const base = new ToolRunner({
    'local.file': {
      estimatedCost: 0.25,
      async handler() { calls++; return { result: { ok: true } }; },
    },
  });
  const spent = [];
  const scope = {
    toolAllowlist: ['local.file'], workspaceRoots: [root],
    authorityEnvelope: {
      allowedKinds: ['organize'], allowedTargets: ['owner'],
    },
  };
  const controller = new AbortController();
  const wrapped = scopedAgentTools(
    base, scope, { consumeStep: (value) => spent.push(value) }, controller.signal,
    async () => {}, { connectedTools: [{ id: 'local.file', toolKind: 'organize' }] },
  );

  await assert.rejects(
    wrapped.run('local.file', { path: '/tmp/outside.txt' }, { connectedTools: [] }),
    /scope/,
  );
  await assert.rejects(
    wrapped.run('local.file', { path: join(root, 'a.txt'), target: 'stranger' }, { connectedTools: [] }),
    /target_outside_scope/,
  );
  assert.equal(calls, 0, '범위 밖이면 handler 호출 전 차단');

  await wrapped.run(
    'local.file', { path: join(root, 'a.txt'), target: 'owner' },
    { connectedTools: [{ id: 'local.file', status: 'usable', executable: true }] },
  );
  assert.equal(calls, 1);
  assert.deepEqual(spent, [{ cost: 0.25 }]);
});

function activeSkill() {
  const record = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'cancel-skill', name: '취소 경합 검사', purpose: '취소 전에만 실행한다',
    version: 1, contentHash: '', inputs: [],
    steps: [{ kind: 'organize', instruction: '파일을 확인한다' }],
    resultContract: { kind: 'summary' }, requiredCapabilities: ['local.file'],
    authorityHints: ['organize'], replayCases: [],
    source: { kind: 'test', sessionId: null, traceIds: [] }, state: 'active',
    createdAt: 0, updatedAt: 0, previousVersion: null,
  };
  record.contentHash = contentHash(skillHashSource(record));
  return record;
}

function activeProfile() {
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'cancel-agent', name: '취소 검사 담당', purpose: '취소 경합을 검사한다',
    modelRole: 'worker', toolAllowlist: ['local.file'], workspaceScope: ['/tmp'],
    defaultBudgets: { maxToolCalls: 2, timeoutMs: 30_000, maxCost: 1, maxConcurrency: 1 },
    authorityCeiling: 'A1', state: 'active', createdAt: 0, updatedAt: 0,
  };
}

test('cancel between durable claim and runner start yields cancelled run and zero execution', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-canonical-cancel-'));
  const memStore = new MemoryStore(dir);
  let release;
  let reached;
  const gate = new Promise((resolve) => { release = resolve; });
  const claimed = new Promise((resolve) => { reached = resolve; });
  let modelCalls = 0;
  let toolCalls = 0;
  const tools = new ToolRunner({
    'local.file': { async handler() { toolCalls++; return { result: {} }; } },
  });
  const runtime = new CanonicalAutomationRuntime({
    dir, env: demoEnv(), tools, memStore, withMemory: (task) => task(),
    modelFor: () => ({ async respond() { modelCalls++; return '실행'; } }),
    beforeRun: async () => { reached(); await gate; },
  });
  await runtime.ready();
  const skill = activeSkill();
  const profile = activeProfile();
  const now = Date.now();
  await runtime.skillStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [skill] });
  await runtime.profileStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, profiles: [profile] });
  await runtime.jobStore.save({
    schemaVersion: AUTOMATION_SCHEMA_VERSION, candidates: [], jobs: [{
      schemaVersion: AUTOMATION_SCHEMA_VERSION, id: 'cancel-job', name: '취소할 작업',
      skillRef: { id: skill.id, version: skill.version, contentHash: skill.contentHash },
      trigger: { kind: 'once', timezone: 'UTC', at: now, nextRunAt: now, misfirePolicy: 'catch_up_once' },
      agentProfileId: profile.id, inputTemplate: { path: '/tmp/input.txt' },
      authorityEnvelope: {
        ceiling: 'A1', allowedKinds: ['organize'], allowedTools: ['local.file'],
        allowedTargets: [], workspaceRoots: ['/tmp'], expiresAt: null,
        maxRuns: 1, maxCost: 1, requiresFreshApprovalFor: [],
      },
      deliveryPolicy: { mode: 'none' }, state: 'scheduled', nextRunAt: now,
      lastRunId: null, createdAt: now, updatedAt: now,
    }],
  });

  const ticking = runtime.tick();
  await claimed;
  const cancelled = await runtime.cancelJob('cancel-job');
  assert.equal(cancelled.ok, true);
  release();
  const result = await ticking;
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].status, 'cancelled');
  assert.equal(modelCalls, 0);
  assert.equal(toolCalls, 0);
});

test('a canonical job cancellation written by another owner is rechecked after claim', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-canonical-external-cancel-'));
  const memStore = new MemoryStore(dir);
  let release;
  let reached;
  const gate = new Promise((resolve) => { release = resolve; });
  const claimed = new Promise((resolve) => { reached = resolve; });
  let modelCalls = 0;
  const runtime = new CanonicalAutomationRuntime({
    dir, env: demoEnv(), tools: new ToolRunner({}), memStore,
    withMemory: (task) => task(),
    modelFor: () => ({ async respond() { modelCalls++; return '실행'; } }),
    beforeRun: async () => { reached(); await gate; },
  });
  await runtime.ready();
  const skill = activeSkill();
  const profile = activeProfile();
  const now = Date.now();
  await runtime.skillStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [skill] });
  await runtime.profileStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, profiles: [profile] });
  await runtime.jobStore.save({
    schemaVersion: AUTOMATION_SCHEMA_VERSION, candidates: [], jobs: [{
      schemaVersion: AUTOMATION_SCHEMA_VERSION, id: 'external-cancel-job', name: '외부 취소 작업',
      skillRef: { id: skill.id, version: skill.version, contentHash: skill.contentHash },
      trigger: { kind: 'once', timezone: 'UTC', at: now, nextRunAt: now, misfirePolicy: 'catch_up_once' },
      agentProfileId: profile.id, inputTemplate: {},
      authorityEnvelope: {
        ceiling: 'A1', allowedKinds: ['organize'], allowedTools: [], allowedTargets: [],
        workspaceRoots: ['/tmp'], expiresAt: null, maxRuns: 1, maxCost: 1,
        requiresFreshApprovalFor: [],
      },
      deliveryPolicy: { mode: 'none' }, state: 'scheduled', nextRunAt: now,
      lastRunId: null, createdAt: now, updatedAt: now,
    }],
  });

  const ticking = runtime.tick();
  await claimed;
  await runtime.jobStore.update((state) => ({
    ...state,
    jobs: state.jobs.map((job) => job.id === 'external-cancel-job'
      ? { ...job, state: 'cancelled', updatedAt: now + 1 }
      : job),
  }));
  release();
  const result = await ticking;
  assert.equal(result.runs[0].status, 'cancelled');
  assert.equal(modelCalls, 0);
});
