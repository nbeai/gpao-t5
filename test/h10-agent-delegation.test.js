import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AUTOMATION_SCHEMA_VERSION,
  agentRunIdempotencyKey,
  claimAgentRun,
  contentHash,
  skillHashSource,
} from '../src/kernel/l5-growth/automation-contracts.js';
import { AgentRunRegistry } from '../src/runtime/agent-run-registry.js';
import { AgentRunRunner } from '../src/runtime/agent-runner.js';
import { CanonicalAutomationRuntime } from '../src/runtime/canonical-automation-runtime.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { demoEnv } from '../src/surface/demo-context.js';
import { MemoryStore } from '../src/surface/memory-store.js';

const owner = { pid: 42, ownerToken: 'h10-parent-owner' };

const budgets = (patch = {}) => ({
  maxToolCalls: 2,
  timeoutMs: 5_000,
  maxCost: 1,
  maxConcurrency: 2,
  ...patch,
});

const authority = (patch = {}) => ({
  ceiling: 'A1',
  allowedKinds: ['read'],
  allowedTools: ['local.file'],
  allowedTargets: [],
  workspaceRoots: ['/tmp/h10'],
  expiresAt: null,
  maxRuns: 2,
  maxCost: 2,
  requiresFreshApprovalFor: [],
  ...patch,
});

function skill(id) {
  const record = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: `skill-${id}`,
    name: `폴더 ${id} 조사`,
    purpose: `폴더 ${id}만 조사해 독립 결과를 만든다`,
    version: 1,
    contentHash: '',
    inputs: [],
    steps: [{ kind: 'read', instruction: `폴더 ${id}를 읽는다` }],
    resultContract: { kind: 'folder_finding' },
    requiredCapabilities: ['local.file'],
    authorityHints: ['read'],
    replayCases: [],
    source: { kind: 'test', sessionId: 'h10-session', traceIds: ['h10-turn-1'] },
    state: 'active',
    createdAt: 1,
    updatedAt: 1,
    previousVersion: null,
  };
  record.contentHash = contentHash(skillHashSource(record));
  return record;
}

const profile = (id) => ({
  schemaVersion: AUTOMATION_SCHEMA_VERSION,
  id: `agent-${id}`,
  name: `조사 담당 ${id}`,
  purpose: `한 폴더만 조사한다`,
  modelRole: 'worker',
  toolAllowlist: ['local.file'],
  workspaceScope: ['/tmp/h10'],
  defaultBudgets: budgets(),
  authorityCeiling: 'A1',
  state: 'active',
  createdAt: 1,
  updatedAt: 1,
});

function queuedRun(id, scheduledFor = 100) {
  const skillSnapshot = skill(id);
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: `run-${id}`,
    jobId: `h10-child-${id}`,
    scheduledFor,
    idempotencyKey: agentRunIdempotencyKey({
      jobId: `h10-child-${id}`,
      scheduledFor,
      skillVersion: skillSnapshot.version,
      skillHash: skillSnapshot.contentHash,
    }),
    skillSnapshot,
    triggerSnapshot: {
      kind: 'once', timezone: 'UTC', at: scheduledFor,
      misfirePolicy: 'skip', nextRunAt: scheduledFor,
    },
    inputSnapshot: { parentRequestId: 'h10-turn-1', folder: id },
    agentSnapshot: profile(id),
    authorityEnvelope: authority({ maxRuns: 1, maxCost: 1 }),
    status: 'queued',
    owner: null,
    heartbeatAt: null,
    budgets: budgets(),
    receipts: [],
    result: null,
    deliveryState: { status: 'not_requested' },
    startedAt: null,
    finishedAt: null,
  };
}

function claimedRun(id, scheduledFor = 100) {
  const claimed = claimAgentRun(queuedRun(id, scheduledFor), owner, 150);
  if (!claimed.ok) throw new Error(`test claim failed: ${claimed.reason}`);
  return claimed.record;
}

class RecordingLedger {
  records = [];

  async append(run) {
    this.records.push(structuredClone(run));
    return { record: run, eventWritten: true, snapshotWritten: true };
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function runnerFixture({ executePlan } = {}) {
  const ledger = new RecordingLedger();
  const registry = new AgentRunRegistry();
  const modelCalls = [];
  const toolCalls = [];
  const model = {
    async respond(request) {
      modelCalls.push(request);
      return `조사 결과: ${request.folder}`;
    },
  };
  const tools = {
    async read(folder) {
      toolCalls.push(folder);
      return { folder, files: [`${folder}.txt`] };
    },
  };
  const runner = new AgentRunRunner({
    ledger,
    registry,
    now: (() => { let at = 200; return () => ++at; })(),
    getRuntimeReality: async () => ({
      connectedTools: [{ id: 'local.file', toolKind: 'read', status: 'usable', executable: true }],
    }),
    createContext: async ({ run }) => ({ folder: run.inputSnapshot.folder }),
    modelFor: () => model,
    executePlan: executePlan ?? (async (request) => {
      request.budget.consumeStep({ cost: 0.25 });
      const evidence = await tools.read(request.context.folder);
      const answer = await request.model.respond(evidence);
      return {
        kind: 'reply',
        result: { folder: request.context.folder, answer },
        receipts: [{
          id: `receipt-${request.run.id}`,
          runId: request.run.id,
          parentRequestId: request.run.inputSnapshot.parentRequestId,
          lifecycle: 'executed',
        }],
      };
    }),
  });
  return { runner, registry, ledger, modelCalls, toolCalls };
}

const startOptions = () => ({
  owner,
  parentAuthority: authority(),
  parentBudgets: budgets({ maxToolCalls: 4, maxCost: 2 }),
  parentToolAllowlist: ['local.file'],
  concurrencyKey: 'h10-parent-request',
});

test('H10 product path decomposes one user request into bounded child AgentRuns', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-h10-product-'));
  const runtime = new CanonicalAutomationRuntime({
    dir,
    env: demoEnv(),
    tools: new ToolRunner({}),
    memStore: new MemoryStore(dir),
    withMemory: (task) => task(),
    modelFor: () => ({ async respond() { return 'unused'; } }),
    migrate: false,
  });

  assert.equal(
    typeof runtime.delegateUserRequest,
    'function',
    'H10 product entry is missing: a user turn cannot create bounded child AgentRuns',
  );

  const delegated = await runtime.delegateUserRequest({
    requestId: 'h10-turn-1',
    text: '여러 폴더를 조사해서 차이를 한 보고서로 정리해줘',
    partitions: [{ folder: 'A' }, { folder: 'B' }],
    authorityEnvelope: authority(),
    budgets: budgets({ maxToolCalls: 4, maxCost: 2 }),
  });
  assert.deepEqual(delegated.children.map((run) => run.inputSnapshot.folder), ['A', 'B']);
  assert.ok(delegated.children.every(
    (run) => run.inputSnapshot.parentRequestId === delegated.parent.id,
  ));
  assert.ok(delegated.children.every((run) => run.authorityEnvelope.maxRuns <= 1));
  assert.ok(delegated.children.every((run) => run.budgets.maxConcurrency <= 2));
});

test('H10 product path durably claims, executes, and integrates every delegated child', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-h10-integrate-'));
  const runtime = new CanonicalAutomationRuntime({
    dir,
    env: demoEnv(),
    tools: new ToolRunner({}),
    memStore: new MemoryStore(dir),
    withMemory: (task) => task(),
    modelFor: () => ({ async respond() { return 'unused'; } }),
    migrate: false,
    owner,
    now: (() => { let at = 500; return () => ++at; })(),
  });
  runtime.runner = new AgentRunRunner({
    ledger: runtime.runLedger,
    now: (() => { let at = 600; return () => ++at; })(),
    getRuntimeReality: async () => ({
      connectedTools: [{ id: 'local.file', toolKind: 'read', status: 'usable', executable: true }],
    }),
    createContext: async ({ run }) => ({ folder: run.inputSnapshot.folder }),
    modelFor: () => ({ async respond() { return 'unused'; } }),
    executePlan: async (request) => ({
      kind: 'reply',
      result: { folder: request.context.folder },
      receipts: [{ id: `receipt-${request.run.id}`, runId: request.run.id }],
    }),
  });
  const delegated = await runtime.delegateUserRequest({
    requestId: 'h10-turn-integrate',
    text: '두 폴더를 조사해서 합친다',
    partitions: [{ folder: 'A' }, { folder: 'B' }],
    authorityEnvelope: authority(),
    budgets: budgets({ maxToolCalls: 4, maxCost: 2 }),
  });

  const integrated = await runtime.executeDelegation(delegated);
  assert.equal(integrated.ready, true);
  assert.equal(integrated.status, 'succeeded');
  assert.deepEqual(integrated.results.map((run) => run.result.folder).sort(), ['A', 'B']);
  const durable = await runtime.runLedger.load();
  assert.deepEqual(
    durable.runs.filter((run) => delegated.parent.childRunIds.includes(run.id)).map((run) => run.status).sort(),
    ['succeeded', 'succeeded'],
  );
});

test('H10 child runs preserve independent results and receipts', async () => {
  const { runner, ledger, modelCalls, toolCalls } = runnerFixture();
  const [left, right] = await Promise.all([
    runner.run(claimedRun('A', 101), startOptions()),
    runner.run(claimedRun('B', 102), startOptions()),
  ]);

  assert.equal(left.status, 'succeeded');
  assert.equal(right.status, 'succeeded');
  assert.deepEqual(left.result, { folder: 'A', answer: '조사 결과: A' });
  assert.deepEqual(right.result, { folder: 'B', answer: '조사 결과: B' });
  assert.deepEqual(left.receipts.map((receipt) => receipt.id), ['receipt-run-A']);
  assert.deepEqual(right.receipts.map((receipt) => receipt.id), ['receipt-run-B']);
  assert.notEqual(left.receipts[0].runId, right.receipts[0].runId);
  assert.deepEqual(toolCalls.sort(), ['A', 'B']);
  assert.equal(modelCalls.length, 2);
  assert.equal(ledger.records.filter((run) => run.status === 'succeeded').length, 2);
});

test('H10 cancelling one child does not cancel or erase its sibling', async () => {
  const leftEntered = deferred();
  const releaseLeft = deferred();
  const { runner } = runnerFixture({
    executePlan: async (request) => {
      if (request.run.id === 'run-A') {
        leftEntered.resolve();
        await releaseLeft.promise;
      }
      return {
        kind: 'reply',
        result: { folder: request.context.folder },
        receipts: [{ id: `receipt-${request.run.id}`, runId: request.run.id }],
      };
    },
  });

  const leftPromise = runner.run(claimedRun('A', 101), startOptions());
  const rightPromise = runner.run(claimedRun('B', 102), startOptions());
  await leftEntered.promise;
  runner.cancel('run-A', 'user_cancelled_child_A');

  const right = await rightPromise;
  releaseLeft.resolve();
  const left = await leftPromise;

  assert.equal(left.status, 'cancelled');
  assert.equal(right.status, 'succeeded');
  assert.deepEqual(right.receipts.map((receipt) => receipt.id), ['receipt-run-B']);
  assert.deepEqual(runner.collect(['run-A', 'run-B']).results.map((entry) => entry.status), [
    'cancelled', 'succeeded',
  ]);
});

test('H10 parent integration cannot report success before every child is terminal', async () => {
  const leftEntered = deferred();
  const releaseLeft = deferred();
  const { runner } = runnerFixture({
    executePlan: async (request) => {
      if (request.run.id === 'run-A') {
        leftEntered.resolve();
        await releaseLeft.promise;
      }
      return {
        kind: 'reply',
        result: { folder: request.context.folder },
        receipts: [{ id: `receipt-${request.run.id}`, runId: request.run.id }],
      };
    },
  });

  const leftPromise = runner.run(claimedRun('A', 101), startOptions());
  const rightPromise = runner.run(claimedRun('B', 102), startOptions());
  await leftEntered.promise;
  await rightPromise;

  const premature = runner.collect(['run-A', 'run-B']);
  releaseLeft.resolve();
  await leftPromise;

  assert.equal(
    premature.ready,
    false,
    'parent collection must explicitly report incomplete children instead of returning a success-shaped partial array',
  );
  assert.deepEqual(premature.pendingRunIds, ['run-A']);

  const complete = runner.collect(['run-A', 'run-B']);
  assert.equal(complete.ready, true);
  assert.deepEqual(complete.results.map((entry) => entry.runId).sort(), ['run-A', 'run-B']);
});
