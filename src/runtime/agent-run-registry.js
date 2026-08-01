import { sameAgentRunOwner } from '../kernel/l5-growth/agent-run.js';

export class AgentRunCancellationError extends Error {
  constructor(reason = 'cancelled') {
    super(reason);
    this.name = 'AbortError';
    this.code = 'agent_run_cancelled';
    this.reason = reason;
  }
}

function publicEntry(entry) {
  return entry ? {
    runId: entry.runId,
    owner: { ...entry.owner },
    concurrencyKey: entry.concurrencyKey,
    acquiredAt: entry.acquiredAt,
    heartbeatAt: entry.heartbeatAt,
    cancelReason: entry.cancelReason,
    signal: entry.controller.signal,
  } : null;
}

export class AgentRunRegistry {
  #active = new Map();
  #results = new Map();
  #now;

  constructor({ now = () => Date.now() } = {}) {
    this.#now = now;
  }

  acquire(run, {
    owner,
    concurrencyKey = run?.jobId ?? run?.id,
    maxConcurrency = run?.budgets?.maxConcurrency,
  } = {}) {
    if (!sameAgentRunOwner(run?.owner, owner)) throw new Error('owner_mismatch');
    if (!['claimed', 'running', 'waiting_approval'].includes(run?.status)) {
      throw new Error('run_not_claimed');
    }
    if (!(Number.isInteger(maxConcurrency) && maxConcurrency > 0)) {
      throw new Error('invalid_concurrency_budget');
    }
    const existing = this.#active.get(run.id);
    if (existing) {
      if (!sameAgentRunOwner(existing.owner, owner)) throw new Error('owner_mismatch');
      return publicEntry(existing);
    }
    const inScope = [...this.#active.values()].filter(
      (entry) => entry.concurrencyKey === concurrencyKey,
    ).length;
    if (inScope >= maxConcurrency) throw new Error('concurrency_budget_exhausted');

    const at = this.#now();
    const entry = {
      runId: run.id,
      owner: { pid: owner.pid, ownerToken: owner.ownerToken },
      concurrencyKey,
      acquiredAt: at,
      heartbeatAt: run.heartbeatAt ?? at,
      cancelReason: null,
      controller: new AbortController(),
    };
    this.#active.set(run.id, entry);
    this.#results.delete(run.id);
    return publicEntry(entry);
  }

  heartbeat(runId, owner, at = this.#now()) {
    const entry = this.#active.get(runId);
    if (!entry) throw new Error('run_not_active');
    if (!sameAgentRunOwner(entry.owner, owner)) throw new Error('owner_mismatch');
    if (!Number.isFinite(at) || at < entry.heartbeatAt) throw new Error('heartbeat_not_monotonic');
    entry.heartbeatAt = at;
    return publicEntry(entry);
  }

  requestCancellation(runId, reason = 'cancelled') {
    const entry = this.#active.get(runId);
    if (!entry) throw new Error('run_not_active');
    if (!entry.controller.signal.aborted) {
      entry.cancelReason = String(reason || 'cancelled');
      entry.controller.abort(new AgentRunCancellationError(entry.cancelReason));
    }
    return publicEntry(entry);
  }

  release(runId, owner, outcome) {
    const entry = this.#active.get(runId);
    if (!entry) throw new Error('run_not_active');
    if (!sameAgentRunOwner(entry.owner, owner)) throw new Error('owner_mismatch');
    this.#active.delete(runId);
    const result = {
      runId,
      ...outcome,
      releasedAt: this.#now(),
    };
    this.#results.set(runId, result);
    return result;
  }

  get(runId) {
    return publicEntry(this.#active.get(runId));
  }

  result(runId) {
    return this.#results.get(runId) ?? null;
  }

  collect(runIds) {
    return (runIds ?? []).map((runId) => this.#results.get(runId)).filter(Boolean);
  }

  activeCount(concurrencyKey) {
    return [...this.#active.values()].filter(
      (entry) => concurrencyKey === undefined || entry.concurrencyKey === concurrencyKey,
    ).length;
  }
}
