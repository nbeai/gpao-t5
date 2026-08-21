export class AutomationScheduler {
  constructor({ store, execute, now = Date.now, maxSleepMs = 60_000 } = {}) {
    if (!store || typeof execute !== 'function') throw new TypeError('automation scheduler inputs are required');
    this.store = store; this.execute = execute; this.now = now; this.maxSleepMs = maxSleepMs;
    this.timer = null; this.started = false; this.inFlight = new Set(); this.ticking = false;
  }
  async start() { if (this.started) return; this.started = true; await this.store.recoverInterrupted(); await this.arm(); }
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
    try { const claims = await this.store.claimDue(); for (const claim of claims) this.dispatch(claim); }
    finally { this.ticking = false; }
  }
  dispatch(claim) {
    const promise = (async () => {
      await this.store.markRunning(claim.job.id, claim.run.id);
      try {
        const result = await this.execute(structuredClone(claim));
        await this.store.complete({ jobId: claim.job.id, runId: claim.run.id, status: 'succeeded',
          sourceRunId: result?.runId ?? null, deliveryStatus: result?.deliveryStatus ?? 'not_requested' });
      } catch (error) {
        await this.store.complete({ jobId: claim.job.id, runId: claim.run.id,
          status: error?.code === 'SESSION_BUSY' ? 'skipped' : 'failed', error: error?.message ?? String(error) });
      }
    })().finally(() => { this.inFlight.delete(promise); this.arm().catch(() => {}); });
    this.inFlight.add(promise);
  }
  async runNow(jobId) { const claims = await this.store.claimDue({ jobId, force: true }); if (!claims.length) throw new Error('automation cannot run now'); this.dispatch(claims[0]); await this.arm(); return claims[0].run; }
  async jobsChanged() { await this.arm(); }
  async stop() { this.started = false; clearTimeout(this.timer); await Promise.allSettled([...this.inFlight]); }
}
