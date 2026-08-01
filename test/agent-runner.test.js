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
  transitionState,
} from '../src/kernel/l5-growth/automation-contracts.js';
import { AgentRunRegistry } from '../src/runtime/agent-run-registry.js';
import { AgentRunRunner } from '../src/runtime/agent-runner.js';
import { AutomationRunLedger } from '../src/surface/automation-run-ledger.js';

const owner = { pid: 42, ownerToken: 'owner-A' };

const budgets = (patch = {}) => ({
  maxToolCalls: 4,
  timeoutMs: 1_000,
  maxCost: 2,
  maxConcurrency: 2,
  ...patch,
});

const authority = (patch = {}) => ({
  ceiling: 'A1',
  allowedKinds: ['read'],
  allowedTools: ['local.file'],
  allowedTargets: [],
  workspaceRoots: ['/tmp/work'],
  expiresAt: null,
  maxRuns: 1,
  maxCost: 2,
  requiresFreshApprovalFor: [],
  ...patch,
});

const skill = () => {
  const value = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'skill-1',
    name: 'Read project notes',
    purpose: 'Read bounded notes and return a result',
    version: 1,
    contentHash: '',
    inputs: [],
    steps: [{ kind: 'read' }],
    resultContract: { kind: 'summary' },
    requiredCapabilities: ['local.file'],
    authorityHints: ['read'],
    replayCases: [],
    source: { kind: 'test', sessionId: 's1', traceIds: [] },
    state: 'active',
    createdAt: 1,
    updatedAt: 1,
    previousVersion: null,
  };
  value.contentHash = contentHash(skillHashSource(value));
  return value;
};

const profile = (patch = {}) => ({
  schemaVersion: AUTOMATION_SCHEMA_VERSION,
  id: 'agent-1',
  name: 'Bounded worker',
  purpose: 'Read bounded notes and return a result',
  modelRole: 'worker',
  toolAllowlist: [
    'local.file', 'telegram.send', 'agent.create',
    'memory.propose', 'automation.create',
  ],
  workspaceScope: ['/tmp/work'],
  defaultBudgets: budgets(),
  authorityCeiling: 'A1',
  state: 'active',
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

const queuedRun = (id = 'run-1', patch = {}) => {
  const skillSnapshot = skill();
  const scheduledFor = patch.scheduledFor ?? 100;
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id,
    jobId: 'parent-1',
    scheduledFor,
    idempotencyKey: agentRunIdempotencyKey({
      jobId: 'parent-1',
      scheduledFor,
      skillVersion: skillSnapshot.version,
      skillHash: skillSnapshot.contentHash,
    }),
    skillSnapshot,
    triggerSnapshot: {
      kind: 'once', timezone: 'UTC', at: scheduledFor,
      misfirePolicy: 'skip', nextRunAt: scheduledFor,
    },
    agentSnapshot: profile(),
    authorityEnvelope: authority(),
    status: 'queued',
    owner: null,
    heartbeatAt: null,
    budgets: budgets(),
    receipts: [],
    result: null,
    deliveryState: { status: 'not_requested' },
    startedAt: null,
    finishedAt: null,
    ...patch,
  };
};

const claimedRun = (id = 'run-1', patch = {}, now = 150) => {
  const claimed = claimAgentRun(queuedRun(id, patch), owner, now);
  if (!claimed.ok) throw new Error(`test claim failed: ${claimed.reason}`);
  return claimed.record;
};

class RecordingLedger {
  records = [];

  async append(run) {
    this.records.push(structuredClone(run));
    return { record: run, eventWritten: true, snapshotWritten: true };
  }
}

const selfState = {
  connectedTools: [
    { id: 'local.file', toolKind: 'read' },
    { id: 'telegram.send', toolKind: 'send' },
    { id: 'agent.create', toolKind: 'automate' },
    { id: 'memory.propose', toolKind: 'promote_memory' },
    { id: 'automation.create', toolKind: 'automate' },
  ],
};

const startOptions = (patch = {}) => ({
  owner,
  parentAuthority: authority({
    ceiling: 'A2',
    allowedKinds: ['read', 'send', 'automate', 'promote_memory'],
    allowedTools: [
      'local.file', 'telegram.send', 'agent.create',
      'memory.propose', 'automation.create',
    ],
    maxCost: 4,
  }),
  parentToolAllowlist: [
    'local.file', 'telegram.send', 'agent.create',
    'memory.propose', 'automation.create',
  ],
  parentBudgets: budgets({ maxToolCalls: 8, timeoutMs: 2_000, maxCost: 4 }),
  concurrencyKey: 'parent-1',
  ...patch,
});

test('AC-4 registry permits only independent bounded parallel runs and binds owner identity', () => {
  const registry = new AgentRunRegistry({ now: () => 10 });
  const a = claimAgentRun(queuedRun('run-a', { scheduledFor: 101 }), owner, 10).record;
  const b = claimAgentRun(queuedRun('run-b', { scheduledFor: 102 }), owner, 10).record;
  const c = claimAgentRun(queuedRun('run-c', { scheduledFor: 103 }), owner, 10).record;

  registry.acquire(a, { owner, concurrencyKey: 'parent-1', maxConcurrency: 2 });
  registry.acquire(b, { owner, concurrencyKey: 'parent-1', maxConcurrency: 2 });
  assert.throws(
    () => registry.acquire(c, { owner, concurrencyKey: 'parent-1', maxConcurrency: 2 }),
    /concurrency_budget_exhausted/,
  );
  assert.throws(
    () => registry.heartbeat('run-a', { pid: 99, ownerToken: 'owner-B' }, 11),
    /owner_mismatch/,
  );
  assert.equal(registry.heartbeat('run-a', owner, 12).heartbeatAt, 12);

  const cancelled = registry.requestCancellation('run-a', 'user_cancelled');
  assert.equal(cancelled.signal.aborted, true);
  registry.release('run-a', owner, { status: 'cancelled', result: null, run: a });
  registry.release('run-b', owner, { status: 'succeeded', result: { answer: 2 }, run: b });
  assert.deepEqual(registry.collect(['run-a', 'run-b']).map((entry) => entry.status), [
    'cancelled', 'succeeded',
  ]);
});

test('AC-4 runner consumes parent executePlan and never grants recursive, memory, automation, or send tools', async () => {
  const ledger = new RecordingLedger();
  const registry = new AgentRunRegistry();
  let realityCalls = 0;
  let contextCalls = 0;
  let selectedRole;
  let received;
  const runner = new AgentRunRunner({
    ledger,
    registry,
    now: (() => { let at = 200; return () => ++at; })(),
    getRuntimeReality: async () => { realityCalls += 1; return selfState; },
    createContext: async ({ run }) => { contextCalls += 1; return { request: run.skillSnapshot.purpose }; },
    modelFor: (role) => { selectedRole = role; return { role }; },
    executePlan: async (request) => {
      received = request;
      request.budget.consumeStep({ cost: 0.5 });
      await request.heartbeat();
      return {
        kind: 'reply',
        result: { answer: 'done' },
        receipts: [{ id: 'receipt-1', lifecycle: 'executed' }],
      };
    },
  });

  const result = await runner.run(claimedRun(), startOptions());
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.result, { answer: 'done' });
  assert.deepEqual(result.receipts, [{ id: 'receipt-1', lifecycle: 'executed' }]);
  assert.deepEqual(ledger.records.map((entry) => entry.status), [
    'running', 'succeeded',
  ]);
  assert.equal(realityCalls, 1);
  assert.equal(contextCalls, 1);
  assert.equal(selectedRole, 'worker');
  assert.deepEqual(received.scope.toolAllowlist, ['local.file']);
  assert.deepEqual(received.scope.authorityEnvelope.allowedTools, ['local.file']);
  assert.deepEqual(received.scope.authorityEnvelope.allowedKinds, ['read']);
  assert.equal(received.signal.aborted, false);
  assert.equal(Object.isFrozen(received.scope), true);
  assert.equal(Object.isFrozen(received.scope.authorityEnvelope), true);
  assert.equal(Object.isFrozen(received.runtimeReality), true);
  assert.equal('toolRunner' in received, false, 'runner is an executePlan consumer, not a tool executor');
});

test('AC-4 runner rejects queued input and never owns the claim transition', async () => {
  const ledger = new RecordingLedger();
  let executed = false;
  const runner = new AgentRunRunner({
    ledger,
    registry: new AgentRunRegistry(),
    getRuntimeReality: async () => selfState,
    createContext: async () => ({}),
    modelFor: () => ({}),
    executePlan: async () => { executed = true; return { kind: 'reply' }; },
  });

  await assert.rejects(
    runner.run(queuedRun('run-not-claimed'), startOptions()),
    /agent_run_must_be_claimed/,
  );
  await assert.rejects(
    runner.run(
      claimedRun('run-wrong-owner'),
      startOptions({ owner: { pid: 99, ownerToken: 'owner-B' } }),
    ),
    /owner_mismatch/,
  );
  assert.equal(executed, false);
  assert.deepEqual(ledger.records, []);
});

test('AC-4 durable ledger claim precedes runner execution without a second claim', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-ac4-run-'));
  const ledger = new AutomationRunLedger(dir);
  const queued = queuedRun('run-durable-claim');
  await ledger.append(queued);
  const claimed = claimAgentRun(queued, owner, 150);
  assert.equal(claimed.ok, true);
  await ledger.append(claimed.record);

  const runner = new AgentRunRunner({
    ledger,
    registry: new AgentRunRegistry(),
    now: (() => { let at = 200; return () => ++at; })(),
    getRuntimeReality: async () => selfState,
    createContext: async () => ({}),
    modelFor: () => ({}),
    executePlan: async () => ({ kind: 'reply', result: { answer: 'done' } }),
  });
  const result = await runner.run(claimed.record, startOptions());
  assert.equal(result.status, 'succeeded');

  const loaded = await ledger.load();
  assert.deepEqual(loaded.events.map((event) => event.to), [
    'queued', 'claimed', 'running', 'succeeded',
  ]);
  assert.equal(loaded.events.filter((event) => event.to === 'claimed').length, 1);
});

test('AC-4 runner asks the canonical authority contract whether child allowedTools stay inside the parent', async () => {
  let executed = false;
  const runner = new AgentRunRunner({
    ledger: new RecordingLedger(),
    registry: new AgentRunRegistry(),
    getRuntimeReality: async () => selfState,
    createContext: async () => ({}),
    modelFor: () => ({}),
    executePlan: async () => { executed = true; return { kind: 'reply' }; },
  });

  await assert.rejects(
    runner.run(claimedRun('run-parent-tool-boundary'), startOptions({
      parentAuthority: authority({ allowedTools: [] }),
      // A separate parent availability list cannot widen the canonical authority envelope.
      parentToolAllowlist: ['local.file'],
    })),
    /child_authority_outside_parent/,
  );
  assert.equal(executed, false);
});

test('AC-4 canonical child deny rules reject recursive, memory, automation, and send run tools', async () => {
  const forbidden = [
    ['telegram.send', 'send'],
    ['agent.create', 'automate'],
    ['memory.propose', 'promote_memory'],
    ['automation.create', 'automate'],
  ];

  for (const [tool, kind] of forbidden) {
    let executed = false;
    const runner = new AgentRunRunner({
      ledger: new RecordingLedger(),
      registry: new AgentRunRegistry(),
      getRuntimeReality: async () => selfState,
      createContext: async () => ({}),
      modelFor: () => ({}),
      executePlan: async () => { executed = true; return { kind: 'reply' }; },
    });
    const run = claimedRun(`run-denied-${tool}`, {
      authorityEnvelope: authority({
        allowedKinds: ['read', kind],
        allowedTools: ['local.file', tool],
      }),
    });
    await assert.rejects(
      runner.run(run, startOptions()),
      /child_tools_outside_canonical_allowlist/,
      tool,
    );
    assert.equal(executed, false, tool);
  }
});

test('AC-4 parent/profile budget gates and executePlan budget adapter fail closed', async () => {
  const adapter = (executePlan) => new AgentRunRunner({
    ledger: new RecordingLedger(),
    registry: new AgentRunRegistry(),
    getRuntimeReality: async () => selfState,
    createContext: async () => ({}),
    modelFor: () => ({}),
    executePlan,
  });

  await assert.rejects(
    adapter(async () => ({ kind: 'reply' })).run(
      claimedRun('run-profile-budget', { budgets: budgets({ maxConcurrency: 3 }) }),
      startOptions({ parentBudgets: budgets({ maxConcurrency: 4 }) }),
    ),
    /child_budgets_outside_profile/,
  );
  await assert.rejects(
    adapter(async () => ({ kind: 'reply' })).run(
      claimedRun('run-parent-budget'),
      startOptions({ parentBudgets: budgets({ maxConcurrency: 1 }) }),
    ),
    /child_budgets_outside_parent/,
  );

  const exhausted = await adapter(async ({ budget }) => {
    for (let index = 0; index <= budgets().maxToolCalls; index += 1) {
      budget.consumeStep({ cost: 0 });
    }
    return { kind: 'reply' };
  }).run(claimedRun('run-step-budget'), startOptions());
  assert.equal(exhausted.status, 'failed');
  assert.equal(exhausted.result.reason, 'step_budget_exhausted');
});

test('AC-4 context/model adapter failures become canonical failed runs', async () => {
  const ledger = new RecordingLedger();
  let executed = false;
  const runner = new AgentRunRunner({
    ledger,
    registry: new AgentRunRegistry(),
    getRuntimeReality: async () => selfState,
    createContext: async () => { throw new Error('context_unavailable'); },
    modelFor: () => ({}),
    executePlan: async () => { executed = true; return { kind: 'reply' }; },
  });

  const result = await runner.run(claimedRun('run-context-failure'), startOptions());
  assert.equal(result.status, 'failed');
  assert.equal(result.result.reason, 'context_unavailable');
  assert.equal(executed, false);
  assert.equal(ledger.records.at(-1).status, 'failed');
});

test('AC-4 approval waiting reuses the parent pending contract and resume cannot widen scope', async () => {
  const ledger = new RecordingLedger();
  const registry = new AgentRunRegistry();
  const pending = { pendingId: 'pending-1', parentOwned: { plan: 'opaque' } };
  let invocation = 0;
  let resumedWith;
  let realityCalls = 0;
  const runner = new AgentRunRunner({
    ledger,
    registry,
    now: (() => { let at = 300; return () => ++at; })(),
    getRuntimeReality: async () => { realityCalls += 1; return selfState; },
    createContext: async () => ({ fresh: realityCalls }),
    modelFor: () => ({ respond() {} }),
    executePlan: async (request) => {
      invocation += 1;
      if (invocation === 1) return { kind: 'approval', pendingId: pending.pendingId };
      resumedWith = request;
      return { kind: 'reply', result: { answer: 'approved result' }, receipts: [] };
    },
  });

  const waiting = await runner.run(claimedRun(), startOptions());
  assert.equal(waiting.status, 'waiting_approval');
  assert.deepEqual(waiting.result, { kind: 'approval', pendingId: 'pending-1' });

  const widened = {
    ...waiting,
    authorityEnvelope: {
      ...waiting.authorityEnvelope,
      allowedKinds: [...waiting.authorityEnvelope.allowedKinds, 'send'],
      allowedTools: [...waiting.authorityEnvelope.allowedTools, 'telegram.send'],
    },
    budgets: { ...waiting.budgets, maxToolCalls: waiting.budgets.maxToolCalls + 1 },
  };
  await assert.rejects(
    runner.resume(widened, pending, startOptions({ baselineRun: waiting })),
    /resume_scope_widened/,
  );

  const finished = await runner.resume(waiting, pending, startOptions({ baselineRun: waiting }));
  assert.equal(finished.status, 'succeeded');
  assert.equal(realityCalls, 2, 'resume rebuilds runtime reality');
  assert.equal(resumedWith.mode, 'resume');
  assert.equal(resumedWith.pending, pending, 'pending remains the parent-owned opaque contract');
  assert.deepEqual(resumedWith.scope.authorityEnvelope.allowedTools, ['local.file']);
  assert.equal(resumedWith.scope.budgets.maxToolCalls, waiting.budgets.maxToolCalls);
});

test('AC-4 cancellation aborts the parent loop boundary and records a terminal cancelled result', async () => {
  const ledger = new RecordingLedger();
  const registry = new AgentRunRegistry();
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const runner = new AgentRunRunner({
    ledger,
    registry,
    getRuntimeReality: async () => selfState,
    createContext: async () => ({}),
    modelFor: () => ({}),
    executePlan: ({ signal }) => new Promise((resolve, reject) => {
      entered();
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });

  const running = runner.run(claimedRun('run-cancel'), startOptions());
  await started;
  assert.equal(runner.get('run-cancel').runId, 'run-cancel');
  runner.cancel('run-cancel', 'user_cancelled');
  const result = await running;
  assert.equal(result.status, 'cancelled');
  assert.equal(result.result.reason, 'user_cancelled');
  assert.equal(ledger.records.at(-1).status, 'cancelled');
  assert.equal(runner.get('run-cancel').status, 'cancelled');
  assert.equal(runner.collect(['run-cancel'])[0].status, 'cancelled');
});

test('AC-4 runner only persists a parent-decided canonical recovery transition', async () => {
  const ledger = new RecordingLedger();
  const runner = new AgentRunRunner({
    ledger,
    registry: new AgentRunRegistry(),
    executePlan: async () => ({ kind: 'reply' }),
    getRuntimeReality: async () => selfState,
    createContext: async () => ({}),
    modelFor: () => ({}),
    now: () => 1_000,
  });
  const claimed = claimAgentRun(queuedRun('run-recover'), owner, 10).record;
  const running = transitionState('agentRun', claimed, 'running', 20, {
    heartbeatAt: 20,
    receipts: [{ id: 'receipt-uncertain' }],
  }).record;

  await assert.rejects(
    runner.recordRecoveryTransition(running, {
      status: 'unknown',
      now: 1_000,
      patch: {
        authorityEnvelope: authority({ allowedKinds: ['read', 'send'] }),
        heartbeatAt: 1_000,
        finishedAt: 1_000,
        result: { reason: 'owner_lost_execution_uncertain' },
      },
    }),
    /run_envelope_expanded/,
  );
  assert.equal(ledger.records.length, 0);

  // Owner-liveness proof and this status choice belong to the parent integration.
  const recovered = await runner.recordRecoveryTransition(running, {
    status: 'unknown',
    now: 1_000,
    patch: {
      heartbeatAt: 1_000,
      finishedAt: 1_000,
      result: { reason: 'owner_lost_execution_uncertain' },
    },
  });
  assert.equal(recovered.status, 'unknown');
  assert.equal(recovered.result.reason, 'owner_lost_execution_uncertain');
  assert.equal(ledger.records.at(-1).status, 'unknown');
});
