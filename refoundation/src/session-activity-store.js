import { safeProgressText } from './progress-language.js';

function clone(value) { return value == null ? value : structuredClone(value); }

export class SessionActivityStore {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.bySession = new Map();
  }

  start({ sessionId, runId, text, phase = 'starting' } = {}) {
    if (!sessionId || !runId) throw new TypeError('sessionId and runId are required');
    const at = this.now();
    const activity = {
      sessionId: String(sessionId), runId: String(runId), status: 'running',
      phase: String(phase), text: safeProgressText(text), startedAt: at, updatedAt: at,
    };
    this.bySession.set(activity.sessionId, activity);
    return clone(activity);
  }

  update({ sessionId, runId, text, phase = 'working' } = {}) {
    const current = this.bySession.get(String(sessionId ?? ''));
    if (!current || current.runId !== String(runId ?? '') || current.status !== 'running') return null;
    current.text = safeProgressText(text);
    current.phase = String(phase);
    current.updatedAt = this.now();
    return clone(current);
  }

  finish({ sessionId, runId, status } = {}) {
    if (!['completed', 'cancelled', 'failed'].includes(status)) throw new TypeError('invalid activity status');
    const key = String(sessionId ?? '');
    const current = this.bySession.get(key);
    if (!current || current.runId !== String(runId ?? '')) return null;
    const finished = { ...current, status, updatedAt: this.now() };
    this.bySession.delete(key);
    return clone(finished);
  }

  get(sessionId) {
    return clone(this.bySession.get(String(sessionId ?? '')) ?? null);
  }

  list() {
    return [...this.bySession.values()].map(clone);
  }

  reset(sessionId) {
    const key = String(sessionId ?? '');
    const current = this.bySession.get(key);
    this.bySession.delete(key);
    return clone(current ?? null);
  }
}
