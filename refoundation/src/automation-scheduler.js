import { randomUUID } from 'node:crypto';

export class AutomationScheduler {
  constructor({ store, execute, now = Date.now, maxSleepMs = 60_000, unavailableTools = [],
    owner = null, inspectOwner = async () => 'unknown', leaseMs = 120_000, heartbeatMs = 15_000 } = {}) {
    if (!store || typeof execute !== 'function') throw new TypeError('automation scheduler inputs are required');
    this.store = store; this.execute = execute; this.now = now; this.maxSleepMs = maxSleepMs;
    this.unavailableTools = [...new Set(unavailableTools.map(String))];
    this.owner = owner ?? { runtimeId: randomUUID(), generation: 1 };
    this.inspectOwner = inspectOwner; this.leaseMs = leaseMs; this.heartbeatMs = heartbeatMs;
    this.timer = null; this.started = false; this.inFlight = new Set(); this.controllers = new Map(); this.ticking = false;
  }
  async start() { if (this.started) return; this.started = true;
    await this.store.recoverInterrupted({ leaseMs: this.leaseMs, inspectOwner: this.inspectOwner });
    await this.store.quarantineUnqualified();
    await this.store.quarantineUnavailableTools?.(this.unavailableTools); await this.arm(); }
  async arm() {
    if (!this.started) return; clearTimeout(this.timer);
    const { jobs } = await this.store.list();
    const next = jobs.filter((job) => job.state === 'scheduled' && !job.runningAt && Number.isFinite(job.nextRunAt))
      .reduce((value, job) => Math.min(value, job.nextRunAt), Infinity);
    const delay = Number.isFinite(next) ? Math.max(10, Math.min(this.maxSleepMs, next - this.now())) : this.maxSleepMs;
    this.timer = setTimeout(() => this.tick().catch(() => {}).finally(() => this.arm()), delay); this.timer.unref?.();
  }
  async tick() {
    if (!this.started || this.ticking) return; this.ticking = true;
    try { const claims = await this.store.claimDue({ owner: this.owner }); for (const claim of claims) this.dispatch(claim); }
    finally { this.ticking = false; }
  }
  dispatch(claim) {
    const controller = new AbortController(); this.controllers.set(claim.run.id, controller);
    const promise = (async () => {
      await this.store.markRunning(claim.job.id, claim.run.id, claim.claim);
      let heartbeatError = null;
      const heartbeat = setInterval(() => this.store.heartbeat(claim.job.id, claim.run.id, claim.claim)
        .catch((error) => { heartbeatError = error; }), this.heartbeatMs);
      heartbeat.unref?.();
      try {
        const result = await this.execute({ ...structuredClone(claim),
          signal: controller.signal,
          assertCurrent: () => this.store.assertCurrentClaim(claim.job.id, claim.run.id, claim.claim) });
        if (heartbeatError) throw heartbeatError;
        await this.store.assertCurrentClaim(claim.job.id, claim.run.id, claim.claim);
        const objectiveAchieved = result?.objectiveStatus === 'achieved';
        const deliveryRequired = claim.job.delivery?.kind === 'telegram';
        const deliverySucceeded = !deliveryRequired || result?.deliveryStatus === 'succeeded';
        await this.store.complete({ jobId: claim.job.id, runId: claim.run.id, claim: claim.claim,
          sourceRunId: result?.runId ?? null,
          executionWorkId: result?.workId ?? null, executionWorkRevision: result?.workRevision ?? null,
          executionStatus: 'completed', objectiveStatus: objectiveAchieved ? 'achieved' : 'unresolved',
          surfaceStatus: result?.surfaceStatus ?? (result?.runId ? 'persisted' : 'none'),
          deliveryStatus: result?.deliveryStatus ?? (deliveryRequired ? 'failed' : 'not_requested'),
          error: objectiveAchieved && deliverySucceeded ? null : result?.error
            ?? (!objectiveAchieved ? 'scheduled_objective_not_achieved' : 'scheduled_delivery_failed'),
        });
      } catch (error) {
        if (error?.code !== 'AUTOMATION_CLAIM_STALE') {
          const current = await this.store.assertCurrentClaim(claim.job.id, claim.run.id, claim.claim)
            .catch(() => null);
          if (current && !current.resultPointer) await this.store.complete({
            jobId: claim.job.id, runId: claim.run.id, claim: claim.claim,
            executionStatus: 'failed', objectiveStatus: 'unassessed', surfaceStatus: 'none',
            deliveryStatus: claim.job.delivery?.kind === 'none' ? 'not_requested' : 'pending',
            error: error?.message ?? String(error),
          });
        }
      } finally { clearInterval(heartbeat); }
    })().finally(() => { this.controllers.delete(claim.run.id);
      this.inFlight.delete(promise); this.arm().catch(() => {}); });
    this.inFlight.add(promise);
  }
  async runNow(jobId) { const claims = await this.store.claimDue({ jobId, force: true, owner: this.owner }); if (!claims.length) throw new Error('automation cannot run now'); this.dispatch(claims[0]); await this.arm(); return claims[0].run; }
  async jobsChanged() { await this.arm(); }
  async cancel(jobId) {
    const state = await this.store.list();
    const controllers = state.runs.filter((item) => item.jobId === jobId
      && ['claimed', 'running'].includes(item.status)).map((run) => this.controllers.get(run.id)).filter(Boolean);
    const job = await this.store.cancel(jobId);
    for (const controller of controllers) controller.abort();
    await this.arm(); return job;
  }
  async stop() {
    this.started = false; clearTimeout(this.timer);
    await this.store.interruptOwner(this.owner, 'runtime_stopped');
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.allSettled([...this.inFlight]);
  }
}
