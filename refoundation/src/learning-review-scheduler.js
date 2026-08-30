import { createHash } from 'node:crypto';

function sourceKey(sources) {
  return createHash('sha256').update(JSON.stringify(sources.map((source) => source.pointer.runId).sort()))
    .digest('hex');
}

export class LearningReviewScheduler {
  constructor({ loadSources, review, alreadyReviewed = async () => false,
    idleMs = 30_000, onError = () => {} } = {}) {
    if (typeof loadSources !== 'function' || typeof review !== 'function') {
      throw new TypeError('learning review scheduler inputs are required');
    }
    this.loadSources = loadSources; this.review = review; this.alreadyReviewed = alreadyReviewed;
    this.idleMs = idleMs; this.onError = onError; this.timer = null; this.running = null; this.generation = 0;
  }
  async consider() {
    const sources = (await this.loadSources()).filter((source) => source.eligible);
    const signaled = sources.filter((source) => (source.learningSignals?.length ?? 0) > 0);
    if (signaled.length < 2) return false;
    const selected = signaled.slice(-6); const key = sourceKey(selected);
    if (await this.alreadyReviewed(key)) return false;
    const generation = ++this.generation; clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (generation !== this.generation || this.running) return;
      const task = Promise.resolve(this.review({ key, sources: selected })).catch(this.onError)
        .finally(() => { if (this.running === task) this.running = null; });
      this.running = task;
    }, this.idleMs);
    this.timer.unref?.(); return true;
  }
  async close() { clearTimeout(this.timer); this.generation += 1; await this.running; }
}
