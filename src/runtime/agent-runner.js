import {
  agentRunTransitionWithin,
  authorityWithin,
  transitionState,
  validateAgentRun,
} from '../kernel/l5-growth/automation-contracts.js';
import {
  canStartAgentRun,
  validateAgentBudgets,
} from '../kernel/l5-growth/agent-profile.js';
import {
  boundedChildToolAllowlist,
  sameAgentRunOwner,
} from '../kernel/l5-growth/agent-run.js';
import {
  AgentRunCancellationError,
  AgentRunRegistry,
} from './agent-run-registry.js';

export class AgentRunBudgetError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'AgentRunBudgetError';
    this.code = 'agent_run_budget_exceeded';
    this.reason = reason;
  }
}

function checkedRun(run, label = 'agent run') {
  const checked = validateAgentRun(run);
  if (!checked.ok) throw new Error(`${label} invalid: ${checked.errors.join('; ')}`);
  return frozenClone(run);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function frozenClone(value) {
  return deepFreeze(structuredClone(value));
}

function runWithinBudgetBound(run, budgets) {
  return validateAgentBudgets(budgets).ok
    && agentRunTransitionWithin({ ...run, budgets }, run);
}

function profileAuthorityBound(run) {
  return {
    ...run.authorityEnvelope,
    ceiling: run.agentSnapshot.authorityCeiling,
    allowedTools: run.agentSnapshot.toolAllowlist,
    workspaceRoots: run.agentSnapshot.workspaceScope,
    maxCost: run.agentSnapshot.defaultBudgets.maxCost,
  };
}

function sameStrings(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function createBudgetAdapter(budgets, now, startedAt) {
  let steps = 0;
  let cost = 0;
  return Object.freeze({
    consumeStep({ cost: stepCost = 0 } = {}) {
      if (!(Number.isFinite(stepCost) && stepCost >= 0)) {
        throw new AgentRunBudgetError('invalid_step_cost');
      }
      if (steps + 1 > budgets.maxToolCalls) {
        throw new AgentRunBudgetError('step_budget_exhausted');
      }
      if (cost + stepCost > budgets.maxCost) {
        throw new AgentRunBudgetError('cost_budget_exhausted');
      }
      if (now() - startedAt > budgets.timeoutMs) {
        throw new AgentRunBudgetError('time_budget_exhausted');
      }
      steps += 1;
      cost += stepCost;
      return { steps, cost };
    },
    snapshot() {
      return { steps, cost, elapsedMs: Math.max(0, now() - startedAt) };
    },
  });
}

function abortPromise(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new AgentRunCancellationError());
      return;
    }
    signal.addEventListener(
      'abort',
      () => reject(signal.reason ?? new AgentRunCancellationError()),
      { once: true },
    );
  });
}

function outcomeStatus(outcome) {
  if (outcome?.kind === 'approval') return 'waiting_approval';
  if (['failed', 'cancelled', 'unknown'].includes(outcome?.kind)) return outcome.kind;
  return 'succeeded';
}

function publicResult(outcome, status) {
  if (status === 'waiting_approval') {
    if (typeof outcome?.pendingId !== 'string' || outcome.pendingId.length === 0) {
      throw new Error('approval outcome requires existing pendingId');
    }
    return { kind: 'approval', pendingId: outcome.pendingId };
  }
  if (outcome?.result !== undefined) return outcome.result;
  return outcome?.kind ? { kind: outcome.kind } : null;
}

/**
 * Lifecycle adapter around the parent-owned executePlan loop.
 * It never calls a tool and never interprets a plan step.
 */
export class AgentRunRunner {
  #ledger;
  #registry;
  #executePlan;
  #getRuntimeReality;
  #createContext;
  #modelFor;
  #onHeartbeat;
  #now;
  #setTimeout;
  #clearTimeout;

  constructor({
    ledger,
    registry = new AgentRunRegistry(),
    executePlan,
    getRuntimeReality,
    createContext,
    modelFor,
    onHeartbeat,
    now = () => Date.now(),
    setTimeoutImpl = globalThis.setTimeout,
    clearTimeoutImpl = globalThis.clearTimeout,
  } = {}) {
    if (typeof ledger?.append !== 'function') throw new Error('agent run ledger is required');
    if (typeof executePlan !== 'function') throw new Error('parent executePlan adapter is required');
    if (typeof getRuntimeReality !== 'function') throw new Error('fresh runtime reality adapter is required');
    if (typeof createContext !== 'function') throw new Error('fresh context adapter is required');
    if (typeof modelFor !== 'function') throw new Error('modelFor adapter is required');
    this.#ledger = ledger;
    this.#registry = registry;
    this.#executePlan = executePlan;
    this.#getRuntimeReality = getRuntimeReality;
    this.#createContext = createContext;
    this.#modelFor = modelFor;
    this.#onHeartbeat = onHeartbeat;
    this.#now = now;
    this.#setTimeout = setTimeoutImpl;
    this.#clearTimeout = clearTimeoutImpl;
  }

  get(runId) {
    return this.#registry.get(runId) ?? this.#registry.result(runId);
  }

  cancel(runId, reason = 'cancelled') {
    return this.#registry.requestCancellation(runId, reason);
  }

  collect(runIds) {
    return this.#registry.collect(runIds);
  }

  async #prepareScope(run, options, baselineRun = null) {
    run = checkedRun(run);
    if (baselineRun) baselineRun = checkedRun(baselineRun, 'baseline agent run');
    const parentAuthority = frozenClone(options.parentAuthority);
    const parentBudgets = frozenClone(options.parentBudgets);
    const parentToolAllowlist = frozenClone(options.parentToolAllowlist);
    if (!canStartAgentRun(run.agentSnapshot)) throw new Error('agent_profile_not_active');
    if (baselineRun && !agentRunTransitionWithin(baselineRun, run)) {
      throw new Error('resume_scope_widened');
    }
    if (!authorityWithin(parentAuthority, run.authorityEnvelope)) {
      throw new Error('child_authority_outside_parent');
    }
    if (!authorityWithin(profileAuthorityBound(run), run.authorityEnvelope)) {
      throw new Error('child_authority_outside_profile');
    }
    if (!validateAgentBudgets(parentBudgets).ok) {
      throw new Error('parent_budgets_not_explicit');
    }
    if (!runWithinBudgetBound(run, parentBudgets)) {
      throw new Error('child_budgets_outside_parent');
    }
    if (!runWithinBudgetBound(run, run.agentSnapshot.defaultBudgets)) {
      throw new Error('child_budgets_outside_profile');
    }

    const runtimeReality = frozenClone(
      await this.#getRuntimeReality({ run, mode: options.mode }),
    );
    const toolAllowlist = boundedChildToolAllowlist({
      parentToolAllowlist,
      profile: run.agentSnapshot,
      requestedTools: run.authorityEnvelope.allowedTools,
      selfState: runtimeReality,
    });
    if (!sameStrings(toolAllowlist, run.authorityEnvelope.allowedTools ?? [])) {
      throw new Error('child_tools_outside_canonical_allowlist');
    }
    const scope = frozenClone({
      authorityEnvelope: run.authorityEnvelope,
      budgets: run.budgets,
      toolAllowlist,
      workspaceRoots: run.authorityEnvelope.workspaceRoots,
    });
    return { scope, runtimeReality };
  }

  async run(run, options = {}) {
    run = checkedRun(run);
    options = { ...options, owner: frozenClone(options.owner) };
    if (run.status !== 'claimed') throw new Error('agent_run_must_be_claimed');
    if (!sameAgentRunOwner(run.owner, options.owner)) throw new Error('owner_mismatch');
    const prepared = await this.#prepareScope(run, { ...options, mode: 'start' });
    const at = this.#now();
    const running = transitionState('agentRun', run, 'running', at, {
      heartbeatAt: at,
    });
    if (!running.ok) throw new Error(`agent_run_start_failed: ${running.reason}`);
    this.#registry.acquire(running.record, {
      owner: options.owner,
      concurrencyKey: options.concurrencyKey,
      maxConcurrency: prepared.scope.budgets.maxConcurrency,
    });
    try {
      await this.#ledger.append(running.record);
      return await this.#invoke(running.record, prepared, options, 'start', undefined);
    } catch (error) {
      if (this.#registry.get(run.id)) {
        this.#registry.release(run.id, options.owner, {
          status: 'failed', result: { reason: 'runner_start_failed' }, run: running.record,
        });
      }
      throw error;
    }
  }

  async resume(run, pending, options = {}) {
    run = checkedRun(run);
    options = { ...options, owner: frozenClone(options.owner) };
    const baseline = checkedRun(
      options.baselineRun ?? this.#registry.result(run.id)?.run ?? run,
      'baseline agent run',
    );
    if (baseline.status !== 'waiting_approval') throw new Error('agent_run_not_waiting_approval');
    if (!sameAgentRunOwner(baseline.owner, options.owner)) throw new Error('owner_mismatch');
    const pendingId = options.pendingId ?? pending?.pendingId;
    if (pendingId !== baseline.result?.pendingId) throw new Error('pending_contract_mismatch');
    const prepared = await this.#prepareScope(run, { ...options, mode: 'resume' }, baseline);
    const running = transitionState('agentRun', baseline, 'running', this.#now(), {
      authorityEnvelope: prepared.scope.authorityEnvelope,
      budgets: prepared.scope.budgets,
      heartbeatAt: this.#now(),
      result: null,
    });
    if (!running.ok || !agentRunTransitionWithin(baseline, running.record)) {
      throw new Error(`agent_run_resume_failed: ${running.reason ?? 'scope_widened'}`);
    }
    this.#registry.acquire(running.record, {
      owner: options.owner,
      concurrencyKey: options.concurrencyKey,
      maxConcurrency: prepared.scope.budgets.maxConcurrency,
    });
    try {
      await this.#ledger.append(running.record);
      return await this.#invoke(running.record, prepared, options, 'resume', pending);
    } catch (error) {
      if (this.#registry.get(run.id)) {
        this.#registry.release(run.id, options.owner, {
          status: 'failed', result: { reason: 'runner_resume_failed' }, run: baseline,
        });
      }
      throw error;
    }
  }

  async #invoke(running, prepared, options, mode, pending) {
    let current = running;
    const active = this.#registry.get(running.id);
    const startedAt = this.#now();
    const budget = createBudgetAdapter(prepared.scope.budgets, this.#now, startedAt);
    const heartbeat = async () => {
      const at = this.#now();
      const beat = this.#registry.heartbeat(running.id, running.owner, at);
      current = { ...current, heartbeatAt: beat.heartbeatAt };
      await this.#onHeartbeat?.({ run: frozenClone(current), owner: { ...running.owner }, at });
      return beat;
    };

    let outcome;
    let timer = null;
    try {
      const context = await this.#createContext({
        run: frozenClone(running),
        scope: prepared.scope,
        runtimeReality: prepared.runtimeReality,
        mode,
        pending,
      });
      const model = this.#modelFor(running.agentSnapshot.modelRole);
      timer = this.#setTimeout(() => {
        if (this.#registry.get(running.id)) {
          this.#registry.requestCancellation(running.id, 'timeout');
        }
      }, prepared.scope.budgets.timeoutMs);
      const request = {
        mode,
        run: frozenClone(running),
        scope: prepared.scope,
        runtimeReality: prepared.runtimeReality,
        context,
        model,
        signal: active.signal,
        budget,
        heartbeat,
        ...(mode === 'resume' ? { pending } : {}),
      };
      outcome = await Promise.race([
        this.#executePlan(request),
        abortPromise(active.signal),
      ]);
    } catch (error) {
      const reason = error?.reason ?? error?.message ?? 'run_failed';
      const kind = reason === 'timeout'
        ? 'failed'
        : error?.externalEffectState === 'unknown'
          ? 'unknown'
          : (error instanceof AgentRunCancellationError || error?.name === 'AbortError')
            ? 'cancelled'
            : 'failed';
      outcome = { kind, result: { reason } };
    } finally {
      if (timer !== null) this.#clearTimeout(timer);
    }

    let status = outcomeStatus(outcome);
    let result;
    try {
      result = publicResult(outcome, status);
    } catch (error) {
      status = 'failed';
      result = { reason: error?.message ?? 'invalid_execute_plan_outcome' };
    }
    const now = this.#now();
    const receipts = [
      ...(current.receipts ?? []),
      ...(Array.isArray(outcome?.receipts) ? outcome.receipts : []),
    ];
    const patch = {
      heartbeatAt: Math.max(current.heartbeatAt ?? now, now),
      receipts,
      result,
      ...(status === 'waiting_approval' ? {} : { finishedAt: now }),
    };
    const moved = transitionState('agentRun', current, status, now, patch);
    if (!moved.ok) throw new Error(`agent_run_finish_failed: ${moved.reason}`);
    await this.#ledger.append(moved.record);
    this.#registry.release(running.id, running.owner, {
      status,
      result: moved.record.result,
      run: moved.record,
    });
    return moved.record;
  }

  /**
   * Persists a recovery transition selected by the parent owner. Owner-liveness
   * proof and the recovery decision remain outside this executePlan adapter.
   */
  async recordRecoveryTransition(run, {
    status,
    now = this.#now(),
    patch = {},
  } = {}) {
    run = checkedRun(run);
    const moved = transitionState('agentRun', run, status, now, patch);
    if (!moved.ok) throw new Error(`agent_run_recovery_failed: ${moved.reason}`);
    await this.#ledger.append(moved.record);
    return moved.record;
  }
}
