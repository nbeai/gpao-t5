import { randomUUID } from 'node:crypto';

import { TruthLedger } from '../kernel/l0-evidence/ledger.js';
import { buildSelfState } from '../kernel/l0-evidence/self-state.js';
import {
  AUTOMATION_SCHEMA_VERSION,
  agentRunIdempotencyKey,
  contentHash,
  transitionState,
} from '../kernel/l5-growth/automation-contracts.js';
import {
  makeReplayCallReceipt,
  verifyCallIdentity,
} from '../kernel/l5-growth/tcell-replay.js';
import { replayJudgementPrompt } from '../kernel/l5-growth/replay-verdict.js';
import { toolActionKind } from '../kernel/l2-plan/action-plan.js';
import { runTurn } from '../kernel/turn.js';
import { homeOf, resolveInScope } from './file-scope.js';
import { AgentRunCancellationError } from './agent-run-registry.js';
import { SkillDefinitionStore } from '../surface/skill-store.js';
import { AutomationJobStore } from '../surface/automation-store.js';
import { AgentProfileStore } from '../surface/agent-profile-store.js';
import { AutomationRunLedger } from '../surface/automation-run-ledger.js';
import { SkillService } from '../surface/skill-service.js';
import { migrateAutomationWorkspaceV1 } from '../surface/automation-workspace-migration.js';
import { applyAutomationJobPatch } from '../kernel/l5-growth/automation.js';
import { AgentRunRunner } from './agent-runner.js';
import { buildDelegation } from './agent-delegation.js';
import { AutomationScheduler } from './automation-scheduler.js';
import { commitClaimToRunLedger, prepareRunClaim } from './job-claimer.js';

const REPLAY_TIMEOUT_MS = 60_000;

function ownerForProcess(token = randomUUID()) {
  return { pid: process.pid, ownerToken: token };
}

function replayProfile(request, now) {
  const tools = [...new Set(request.authorityEnvelope.allowedTools ?? [])].sort();
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'agent-skill-replay',
    name: 'Skill replay worker',
    purpose: 'Verify one skill replay case without external effects',
    modelRole: 'growth',
    toolAllowlist: tools,
    workspaceScope: [],
    defaultBudgets: {
      maxToolCalls: Math.max(1, tools.length),
      timeoutMs: REPLAY_TIMEOUT_MS,
      maxCost: 0,
      maxConcurrency: 1,
    },
    authorityCeiling: 'A0',
    state: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

function replayRun(request, now, sequence) {
  const jobId = `skill-replay:${request.skillSnapshot.id}:${request.replayCase.caseId}`;
  const scheduledFor = now + sequence;
  const profile = replayProfile(request, now);
  const idempotencyKey = agentRunIdempotencyKey({
    jobId,
    scheduledFor,
    skillVersion: request.skillSnapshot.version,
    skillHash: request.skillSnapshot.contentHash,
  });
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: `run-${contentHash(idempotencyKey).slice(0, 32)}`,
    jobId,
    scheduledFor,
    idempotencyKey,
    skillSnapshot: structuredClone(request.skillSnapshot),
    triggerSnapshot: {
      kind: 'once', timezone: 'UTC', at: scheduledFor,
      misfirePolicy: 'skip', nextRunAt: scheduledFor,
    },
    inputSnapshot: {},
    agentSnapshot: profile,
    authorityEnvelope: structuredClone(request.authorityEnvelope),
    status: 'queued',
    owner: null,
    heartbeatAt: null,
    budgets: structuredClone(profile.defaultBudgets),
    receipts: [],
    result: null,
    deliveryState: { status: 'not_requested' },
    startedAt: null,
    finishedAt: null,
  };
}

function replayExecutionPrompt(request) {
  return [
    '다음 스킬을 사례 입력에 실제로 적용한다. 외부 행동과 전달은 하지 않는다.',
    `스킬 목적: ${request.skillSnapshot.purpose}`,
    `스킬 단계: ${request.skillSnapshot.steps.map((step) => step.instruction ?? step.kind).join(' / ')}`,
    `사례 종류: ${request.replayCase.kind}`,
    `입력 사실: ${request.replayCase.inputFacts.join(' / ')}`,
    '판정문이 아니라 이 스킬을 적용해 사용자에게 줄 답 자체만 쓴다.',
  ].join('\n');
}

function replayTaskContext(currentRequest, selfState) {
  return {
    currentRequest,
    answerMode: 'complex_work',
    identity: { name: 'T5', named: true },
    selfStateFacts: {
      model: selfState?.model?.id ?? null,
      readyTools: [],
      limits: [],
    },
    authorityFacts: { needsApproval: [], forbidden: ['외부 행동', '전달'] },
    evidenceFacts: [],
    admittedContext: [],
    carryableWork: [],
    recentTurns: [],
  };
}

function invocationPaths(args = {}) {
  return Object.entries(args).filter(([key, value]) => {
    const normalized = key.toLowerCase();
    return typeof value === 'string'
      && (normalized.endsWith('path') || normalized.endsWith('directory')
        || normalized === 'dir' || normalized === 'root' || normalized === 'cwd');
  }).map(([, value]) => value);
}

function invocationTargets(args = {}) {
  const keys = new Set(['target', 'recipient', 'to', 'channel', 'channelid', 'chatid', 'userid']);
  return Object.entries(args)
    .filter(([key, value]) => keys.has(key.toLowerCase()) && typeof value === 'string' && value)
    .map(([, value]) => value);
}

async function assertInvocationScope(id, args, scope, runtimeReality) {
  const descriptor = (runtimeReality?.connectedTools ?? []).find((tool) => tool.id === id);
  const actionKind = descriptor ? toolActionKind({ toolId: id, args, selfState: runtimeReality }) : null;
  // 인자가 행동을 말하면 그 좁은 종류가 이긴다. 옛 스킬처럼 인자가 종류를 못 밝힐 때만
  // 저장된 descriptor 종류로 폴백한다. delete 를 organize 로 낮추는 우회는 허용하지 않는다.
  const kind = actionKind === 'unknown_kind' ? descriptor.toolKind : actionKind;
  if (!kind || !(scope.authorityEnvelope.allowedKinds ?? []).includes(kind)) {
    throw new Error('agent_tool_kind_outside_scope');
  }
  const allowedTargets = new Set(scope.authorityEnvelope.allowedTargets ?? []);
  if (invocationTargets(args).some((target) => !allowedTargets.has(target))) {
    throw new Error('agent_target_outside_scope');
  }
  for (const path of invocationPaths(args)) {
    // **`~` 는 그 사용자의 집이다**(F-109 · 2026-08-13).
    //
    // 집을 안 넘기면 `resolveInScope` 가 `homedir()` — **OS 의 진짜 홈**으로 편다.
    // 봉투에 그 사용자의 집이 적혀 있는데도 안 봤다. 그래서 대화로 부르면 되는 일이
    // 예약으로 돌면 `path out of scope` 로 죽었고, 그 실패는 사용자에게 가지도 않았다.
    // `local-file.js` 의 여덟 자리는 전부 집을 넘긴다 — **이 한 줄만 빠져 있었다.**
    await resolveInScope(path, { roots: scope.workspaceRoots, home: scope.home ?? homeOf(scope.env) });
  }
}

export function scopedAgentTools(base, scope, budget, signal, heartbeat, runtimeReality) {
  const allowed = new Set(scope.toolAllowlist ?? []);
  const entries = Object.entries(base?.tools ?? {}).filter(([id]) => allowed.has(id));
  return {
    tools: Object.fromEntries(entries),
    async run(id, args, selfState) {
      if (!allowed.has(id)) throw new Error('agent_tool_outside_scope');
      if (signal.aborted) throw signal.reason ?? new Error('agent_run_cancelled');
      await assertInvocationScope(id, args, scope, runtimeReality);
      const implementation = base?.tools?.[id];
      const estimatedCost = Number(implementation?.estimatedCost ?? implementation?.cost ?? 0);
      budget.consumeStep({ cost: Number.isFinite(estimatedCost) && estimatedCost >= 0 ? estimatedCost : 0 });
      await heartbeat();
      return base.run(id, args, selfState, {
        // 부모가 봉인한 workspaceRoots는 자식의 읽기 손에만 전달된다. local.file은 이 값을
        // write/move/delete 범위로 사용하지 않는다.
        readScopeRoots: scope.workspaceRoots,
      });
    },
  };
}

/** Reuses the T-cell replay receipt/output truth instead of creating a second evidence store. */
export class TCellReplayEvidenceAdapter {
  constructor({ memStore, withMemory }) {
    this.memStore = memStore;
    this.withMemory = withMemory ?? ((task) => task());
  }

  async get(receiptId) {
    const memory = await this.memStore.load();
    return (memory.replayReceipts ?? []).find((entry) => entry.receiptId === receiptId) ?? null;
  }

  async output(receiptId) {
    const memory = await this.memStore.load();
    return memory.replayOutputs?.[receiptId] ?? null;
  }

  async record(receipt, output) {
    await this.withMemory(async () => {
      const memory = await this.memStore.load();
      if (memory.corrupted) throw new Error('memory_store_corrupted');
      const current = (memory.replayReceipts ?? []).find((entry) => entry.receiptId === receipt.receiptId);
      if (current && memory.replayOutputs?.[receipt.receiptId] !== output) {
        throw new Error('replay_evidence_identity_conflict');
      }
      if (!current) memory.replayReceipts = [...(memory.replayReceipts ?? []), receipt];
      memory.replayOutputs = { ...(memory.replayOutputs ?? {}), [receipt.receiptId]: output };
      await this.memStore.save(memory);
    });
  }
}

/**
 * Canonical automation composition root. Scheduler owns occurrence claims;
 * AgentRunRunner owns every execution; SkillService reuses the same runner.
 */
export class CanonicalAutomationRuntime {
  constructor({
    dir, env, tools, modelFor, memStore, withMemory, now = () => Date.now(),
    // **집을 아는 것은 이쪽이다**(F-109). `env` 는 SelfState 입력 객체이지 OS 환경변수가
    // 아니다 — 거기엔 `GPAO_T5_HOME` 이 없다. `server.js:687` 도 작업 뿌리를 만들 때
    // `deps.processEnv ?? process.env` 를 쓴다. 같은 것을 봐야 예약과 대화가 같은 집을 본다.
    processEnv = process.env,
    owner = ownerForProcess(),
    beforeRun = async () => {},
    skillStore = new SkillDefinitionStore(dir),
    jobStore = new AutomationJobStore(dir),
    profileStore = new AgentProfileStore(dir),
    runLedger = new AutomationRunLedger(dir),
    migrate = true,
  }) {
    this.env = env;
    this.processEnv = processEnv;
    this.tools = tools;
    this.modelFor = modelFor;
    this.now = now;
    this.owner = owner;
    this.beforeRun = beforeRun;
    this.skillStore = skillStore;
    this.jobStore = jobStore;
    this.profileStore = profileStore;
    this.runLedger = runLedger;
    this.readyPromise = migrate ? migrateAutomationWorkspaceV1(dir, now()) : Promise.resolve(null);
    this.replayRequests = new Map();
    this.cancelledRuns = new Set();
    this.replaySequence = 0;
    this.evidenceStore = new TCellReplayEvidenceAdapter({ memStore, withMemory });

    this.runner = new AgentRunRunner({
      ledger: runLedger,
      now,
      getRuntimeReality: async () => buildSelfState(this.env, { tools: this.tools }),
      createContext: async ({ run }) => ({ replayRequest: this.replayRequests.get(run.id) ?? null }),
      modelFor: (role) => this.modelFor(role),
      executePlan: (request) => this.#execute(request),
    });
    this.replayAgent = {
      run: (request) => this.#runReplay(request),
      get: (runId) => this.#getRun(runId),
    };
    this.skillService = new SkillService({
      store: skillStore,
      agentRunner: this.replayAgent,
      evidenceStore: this.evidenceStore,
      selfState: buildSelfState(this.env, { tools: this.tools }),
    });
    this.scheduler = new AutomationScheduler({
      stateSource: () => this.#schedulerState(),
      runLedger,
      jobStore,
      applyJobDeltas: (deltas) => this.#applyJobDeltas(deltas),
      recordHeartbeat: async (heartbeat) => ({ ok: true, heartbeat }),
      owner,
      clock: now,
    });
  }

  async ready() {
    await this.readyPromise;
    return this;
  }

  async delegateUserRequest(request) {
    await this.ready();
    const delegated = buildDelegation({ ...request, now: this.now() });
    const children = [];
    for (const child of delegated.children) {
      const persisted = await this.runLedger.append(child);
      children.push(persisted.record);
    }
    return { parent: delegated.parent, children };
  }

  collectDelegation(parent) {
    return this.runner.collect(parent?.childRunIds ?? []);
  }

  async executeDelegation(delegated) {
    await this.ready();
    const parent = delegated?.parent ?? delegated;
    if (!parent || !Array.isArray(parent.childRunIds)) throw new Error('delegation_parent_required');
    const loaded = await this.runLedger.load();
    if (loaded.recovery) throw new Error('automation_run_ledger_recovery_required');
    const byId = new Map(loaded.runs.map((run) => [run.id, run]));
    const children = parent.childRunIds.map((runId) => {
      const run = byId.get(runId);
      if (!run) throw new Error('delegation_child_missing');
      return run;
    });
    const concurrency = Math.max(1, Math.min(
      parent.budgets?.maxConcurrency ?? 1,
      children.length,
    ));
    const results = new Array(children.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < children.length) {
        const index = cursor;
        cursor += 1;
        const queued = children[index];
        if (['succeeded', 'failed', 'cancelled', 'unknown'].includes(queued.status)) {
          results[index] = queued;
          continue;
        }
        if (queued.status !== 'queued') {
          results[index] = queued;
          continue;
        }
        const at = this.now();
        const claim = await commitClaimToRunLedger(this.runLedger, prepareRunClaim(queued, {
          owner: this.owner,
          now: at,
          jobGuard: {
            jobId: queued.jobId,
            state: 'delegated',
            updatedAt: parent.createdAt,
            nextRunAt: queued.scheduledFor,
            triggerNextRunAt: queued.scheduledFor,
          },
        }));
        if (!claim.ok) throw new Error(claim.reason ?? 'delegation_claim_failed');
        if (!claim.claimed) {
          results[index] = claim.record;
          continue;
        }
        results[index] = await this.runner.run(claim.record, {
          owner: this.owner,
          parentAuthority: parent.authorityEnvelope,
          parentBudgets: parent.budgets,
          parentToolAllowlist: parent.authorityEnvelope.allowedTools,
          concurrencyKey: parent.id,
        });
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    const terminal = results.every((run) => ['succeeded', 'failed', 'cancelled', 'unknown'].includes(run?.status));
    const succeeded = terminal && results.every((run) => run.status === 'succeeded');
    return {
      ready: terminal,
      status: succeeded ? 'succeeded' : terminal ? 'failed' : 'waiting',
      pendingRunIds: results.filter(
        (run) => !['succeeded', 'failed', 'cancelled', 'unknown'].includes(run?.status),
      ).map((run) => run.id),
      results,
    };
  }

  async #schedulerState() {
    await this.ready();
    const [automation, skills, profiles, runState] = await Promise.all([
      this.jobStore.load(), this.skillStore.load(), this.profileStore.load(), this.runLedger.load(),
    ]);
    return { jobs: automation.jobs, skills: skills.skills, profiles: profiles.profiles, runs: runState.runs };
  }

  async #applyJobDeltas(deltas) {
    let applied = 0;
    await this.jobStore.update((state) => {
      let current = state;
      for (const delta of deltas) {
        const result = applyAutomationJobPatch(current, delta);
        if (!result.ok) continue;
        current = result.state;
        applied += 1;
      }
      return current;
    });
    return { ok: applied === deltas.length, applied };
  }

  async #getRun(runId) {
    const loaded = await this.runLedger.load();
    if (loaded.recovery) throw new Error('automation_run_ledger_recovery_required');
    return loaded.runs.find((run) => run.id === runId) ?? null;
  }

  async #runReplay(request) {
    await this.ready();
    const now = this.now();
    const queued = replayRun(request, now, this.replaySequence += 1);
    const delta = prepareRunClaim(queued, {
      owner: this.owner,
      now,
      jobGuard: { jobId: queued.jobId, state: 'replay', updatedAt: now, nextRunAt: now, triggerNextRunAt: now },
    });
    const claimed = await commitClaimToRunLedger(this.runLedger, delta);
    if (!claimed.ok || !claimed.claimed) throw new Error(claimed.reason ?? 'skill_replay_claim_failed');
    this.replayRequests.set(claimed.record.id, structuredClone(request));
    try {
      const run = await this.runner.run(claimed.record, {
        owner: this.owner,
        parentAuthority: queued.authorityEnvelope,
        parentBudgets: queued.budgets,
        parentToolAllowlist: queued.authorityEnvelope.allowedTools,
        concurrencyKey: queued.jobId,
      });
      return { runId: run.id };
    } finally {
      this.replayRequests.delete(claimed.record.id);
    }
  }

  async #execute(request) {
    const replay = request.context.replayRequest;
    if (replay) {
      const startedAt = this.now();
      let executionIdentity = null;
      const raw = await request.model.respond(
        replayTaskContext(replayExecutionPrompt(replay), request.runtimeReality), {
          onCallIdentity: (value) => { executionIdentity = value; },
        },
      );
      const answer = typeof raw === 'string' ? raw : raw?.text ?? '';
      const executionVerified = verifyCallIdentity(executionIdentity);
      if (!executionVerified.ok) throw new Error(executionVerified.reason);

      let judgementIdentity = null;
      const judged = await request.model.respond(
        replayTaskContext(replayJudgementPrompt(replay.replayCase, answer), request.runtimeReality), {
          onCallIdentity: (value) => { judgementIdentity = value; },
        },
      );
      const judgement = typeof judged === 'string' ? judged : judged?.text ?? '';
      const judgementVerified = verifyCallIdentity(judgementIdentity);
      if (!judgementVerified.ok) throw new Error(judgementVerified.reason);
      const output = JSON.stringify({ answer, judgement: JSON.parse(judgement) });
      const receiptId = `skill-replay-${request.run.id}`;
      const receipt = makeReplayCallReceipt({
        receiptId,
        caseId: replay.replayCase.caseId,
        principleId: replay.replayCase.principleId,
        principleVersion: replay.replayCase.principleVersion,
        caseInputDigest: replay.replayCase.caseInputDigest,
        requestDigest: replay.replayCase.caseInputDigest,
        outputText: output,
        modelCallIdentity: executionIdentity,
        startedAt,
        finishedAt: this.now(),
        state: 'completed',
      });
      receipt.judgeModelCallIdentity = judgementIdentity;
      await this.evidenceStore.record(receipt, output);
      return {
        kind: 'reply',
        result: {
          externalEffects: 0,
          replayReceiptRef: receiptId,
          caseInputDigest: replay.replayCase.caseInputDigest,
        },
        receipts: [],
      };
    }

    const ledger = new TruthLedger();
    // **집을 함께 넘긴다**(F-109). 봉투에는 그 사용자의 작업 뿌리가 있지만 「집이 어디냐」는
    // 없다. 안 넘기면 `~` 가 OS 진짜 홈으로 펴져서, 대화로 되던 일이 예약으로 돌면 죽는다.
    const tools = scopedAgentTools(
      this.tools, { ...request.scope, env: this.processEnv }, request.budget, request.signal,
      request.heartbeat, request.runtimeReality,
    );
    if (this.cancelledRuns.has(request.run.id)) throw new AgentRunCancellationError('job_cancelled');
    const skill = request.run.skillSnapshot;
    const instruction = [
      skill.purpose,
      ...(skill.steps ?? []).map((step, index) => `${index + 1}. ${step.instruction ?? step.kind}`),
      `입력: ${JSON.stringify(request.run.inputSnapshot ?? {})}`,
      `결과 계약: ${JSON.stringify(skill.resultContract ?? {})}`,
    ].join('\n');
    const result = await runTurn({ text: instruction }, {
      env: this.env,
      model: request.model,
      tools,
      ledger,
      pending: new Map(),
      identity: { name: 'T5', named: true },
      selfhoodDocs: {},
      memory: {},
      recentTurns: [],
      carryableWork: [],
      carryableWorkEntries: [],
      activeGoal: null,
      workingState: null,
      modelControls: null,
      newId: () => randomUUID(),
      now: this.now,
    });
    if (result.kind === 'approval') {
      return { kind: 'approval', pendingId: result.pendingId, receipts: ledger.entries };
    }
    return {
      kind: result.kind === 'reply' ? 'reply' : 'failed',
      result: { reply: result.reply ?? '', turn: result },
      receipts: ledger.entries,
    };
  }

  async tick({ recovering = false } = {}) {
    await this.ready();
    const scheduled = await this.scheduler.fire({ recovering });
    const runs = [];
    for (const claimed of scheduled.claimed) {
      await this.beforeRun(claimed);
      const current = (await this.jobStore.load()).jobs.find((job) => job.id === claimed.jobId);
      if (!current || current.state !== 'scheduled' || current.lastRunId !== claimed.id) {
        this.cancelledRuns.add(claimed.id);
      }
      const run = await this.runner.run(claimed, {
        owner: this.owner,
        parentAuthority: claimed.authorityEnvelope,
        parentBudgets: claimed.budgets,
        parentToolAllowlist: claimed.authorityEnvelope.allowedTools,
        concurrencyKey: claimed.jobId,
      });
      this.cancelledRuns.delete(claimed.id);
      runs.push(run);
    }
    return { ...scheduled, runs };
  }

  async cancelJob(jobId, now = this.now()) {
    await this.ready();
    let outcome = null;
    await this.jobStore.update((state) => {
      const index = state.jobs.findIndex((job) => job.id === jobId);
      if (index < 0) return state;
      const moved = transitionState('automationJob', state.jobs[index], 'cancelled', now);
      outcome = moved.ok ? {
        ...moved,
        record: { ...moved.record, jobRevision: (state.jobs[index].jobRevision ?? 0) + 1 },
      } : moved;
      if (!moved.ok) return state;
      const jobs = [...state.jobs];
      jobs[index] = outcome.record;
      return { ...state, jobs };
    });
    if (!outcome?.ok) return outcome ?? { ok: false, reason: 'job_not_found' };
    const runId = outcome.record.lastRunId;
    if (runId) {
      this.cancelledRuns.add(runId);
      try { this.runner.cancel(runId, 'job_cancelled'); } catch { /* claim과 acquire 사이면 실행 진입에서 잡는다 */ }
    }
    return outcome;
  }
}
