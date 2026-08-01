import { prepareAutomationRuns } from './automation-engine.js';
import { JobClaimer } from './job-claimer.js';
import { BuiltinTriggerProvider } from './trigger-provider.js';

function requiredFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} is required`);
  return value;
}

/**
 * Durable trigger worker. It derives occurrences, persists queued/claimed runs
 * through the injected canonical ledger, and emits field-level job deltas.
 * AgentRun execution belongs to the parent-owned runner, never this scheduler.
 */
export class AutomationScheduler {
  constructor({
    stateSource,
    runLedger,
    jobStore,
    applyJobDeltas,
    recordHeartbeat,
    owner,
    triggerProvider,
    clock = Date.now,
    intervalMs = 60_000,
    onTick,
    onError = () => {},
  }) {
    this.clock = clock;
    this.intervalMs = intervalMs;
    this.onError = onError;
    this._timer = null;
    this._inFlight = null;
    this._startup = null;
    this._active = false;
    this._legacyOnTick = typeof onTick === 'function' ? onTick : null;
    if (this._legacyOnTick) return;

    this.stateSource = requiredFunction(stateSource, 'stateSource');
    this.applyJobDeltas = requiredFunction(applyJobDeltas, 'applyJobDeltas');
    this.recordHeartbeat = requiredFunction(recordHeartbeat, 'recordHeartbeat');
    this.triggerProvider = triggerProvider ?? new BuiltinTriggerProvider({ clock });
    this.claimer = new JobClaimer({ owner, runLedger, jobStore, clock });
    this.atomicJobClaims = Boolean(jobStore);
    this.owner = { pid: owner.pid, ownerToken: owner.ownerToken };
  }

  async #fire(recovering) {
    const now = this.clock();
    const state = await this.stateSource();
    const prepared = prepareAutomationRuns({
      jobs: state.jobs ?? [],
      skills: state.skills ?? [],
      profiles: state.profiles ?? [],
      now,
      recovering,
      triggerProvider: this.triggerProvider,
    });
    const claimed = [];
    const duplicates = [];
    const claimFailures = [];
    const jobDeltas = [];

    for (const entry of prepared.entries) {
      if (!entry.run) {
        jobDeltas.push(entry.jobDelta);
        continue;
      }
      const outcome = await this.claimer.claim(entry.run, {
        jobGuard: entry.jobGuard,
        jobDelta: entry.jobDelta,
        now,
      });
      if (!outcome.ok) {
        claimFailures.push({ jobId: entry.jobId, reason: outcome.reason });
        continue;
      }
      if (outcome.claimed) claimed.push(outcome.record);
      if (outcome.duplicate) duplicates.push(outcome.record);
      if (!outcome.jobApplied) jobDeltas.push(entry.jobDelta);
    }

    const deltaResult = jobDeltas.length > 0
      ? await this.applyJobDeltas(jobDeltas)
      : { ok: true, applied: 0 };
    const heartbeatDelta = {
      kind: 'automation_scheduler.heartbeat',
      owner: this.owner,
      at: now,
      recovering,
      ok: prepared.failures.length === 0 && claimFailures.length === 0,
    };
    const heartbeatResult = await this.recordHeartbeat(heartbeatDelta);

    return {
      at: now,
      recovering,
      claimed,
      duplicates,
      claimFailures,
      jobDeltas,
      deltaResult,
      heartbeatDelta,
      heartbeatResult,
      prepared,
    };
  }

  async fire({ recovering = false } = {}) {
    if (this._legacyOnTick) {
      return this._legacyOnTick({ source: 'trusted_runtime_event', firedBy: 'scheduler' });
    }
    if (this._inFlight) {
      return { skipped: 'in_flight', claimed: [], duplicates: [], jobDeltas: [] };
    }
    this._inFlight = this.#fire(recovering);
    try {
      return await this._inFlight;
    } finally {
      this._inFlight = null;
    }
  }

  reconcile() {
    return this.fire({ recovering: true });
  }

  start() {
    if (this._active) return this;
    this._active = true;
    if (this._legacyOnTick) {
      this._timer = setInterval(() => {
        this.fire().catch((error) => this.onError(error));
      }, this.intervalMs);
      this._timer.unref?.();
      return this;
    }
    this._startup = this.reconcile()
      .catch((error) => this.onError(error))
      .finally(() => {
        if (!this._active || this._timer) return;
        this._timer = setInterval(() => {
          this.fire().catch((error) => this.onError(error));
        }, this.intervalMs);
        this._timer.unref?.();
      });
    return this;
  }

  async ready() {
    await this._startup;
    return this;
  }

  stop() {
    this._active = false;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    return this;
  }
}
