import { randomUUID } from 'node:crypto';
import { appendFile, chmod, mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SCHEMA = 't5.capability-handoff-event.v1';
const MODES = new Set(['oauth', 'user_action']);
const TERMINAL = new Set(['resumed', 'cancelled', 'needs_attention']);

function clone(value) { return value == null ? value : structuredClone(value); }

function identifier(value, label) {
  const text = String(value ?? '');
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/u.test(text)) throw new TypeError(`${label} is invalid`);
  return text;
}

function uuid(value, label) {
  const text = String(value ?? '');
  if (!/^[0-9a-f-]{36}$/iu.test(text)) throw new TypeError(`${label} is invalid`);
  return text;
}

function parse(text) {
  const events = String(text ?? '').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  if (!events.length || events[0].type !== 'ledger_started') throw new Error('invalid capability handoff ledger');
  for (const [index, event] of events.entries()) {
    if (event.schema !== SCHEMA || event.sequence !== index + 1) {
      throw new Error('invalid capability handoff event sequence');
    }
  }
  return events;
}

function project(events) {
  const handoffs = new Map();
  for (const event of events) {
    if (event.type === 'ledger_started') continue;
    if (event.type === 'handoff_waiting') {
      handoffs.set(event.handoffId, {
        handoffId: event.handoffId, sessionId: event.sessionId, connectionId: event.connectionId,
        mode: event.mode, originRunId: event.originRunId, state: 'waiting',
        startedAt: event.recordedAt, updatedAt: event.recordedAt, claimId: null,
        resumeRunId: null, resumeResultPointer: null, resumeResultDigest: null,
        surfaceReceipt: null, reason: null, connectionState: null,
      });
      continue;
    }
    const handoff = handoffs.get(event.handoffId);
    if (!handoff) throw new Error('capability handoff target is missing');
    if (event.type === 'readiness_observed') {
      handoff.state = 'readiness_observed'; handoff.connectionState = event.connectionState;
    }
    else if (event.type === 'completion_recorded') handoff.state = 'completion_recorded';
    else if (event.type === 'resume_claimed') {
      handoff.state = 'resume_claimed'; handoff.claimId = event.claimId;
    } else if (event.type === 'resume_completed_pending_surface') {
      handoff.state = 'resume_completed_pending_surface'; handoff.resumeRunId = event.resumeRunId;
      handoff.resumeResultPointer = event.resultPointer; handoff.resumeResultDigest = event.resultDigest;
    } else if (event.type === 'handoff_resumed') {
      if (!event.surfaceReceipt || event.surfaceReceipt.surface !== 'console_session'
        || event.surfaceReceipt.sessionId !== handoff.sessionId
        || event.surfaceReceipt.runId !== handoff.resumeRunId
        || event.surfaceReceipt.resultDigest !== handoff.resumeResultDigest) {
        throw new Error('resumed handoff requires exact surface receipt');
      }
      handoff.state = 'resumed'; handoff.resumeRunId = event.resumeRunId;
      handoff.surfaceReceipt = clone(event.surfaceReceipt);
    } else if (event.type === 'handoff_cancelled') handoff.state = 'cancelled';
    else if (event.type === 'handoff_needs_attention') {
      handoff.state = 'needs_attention'; handoff.reason = event.reason;
      if (event.resumeRunId) handoff.resumeRunId = event.resumeRunId;
    }
    handoff.updatedAt = event.recordedAt;
  }
  return [...handoffs.values()].map(clone);
}

export class CapabilityHandoffLedger {
  constructor(directory) {
    if (!directory) throw new TypeError('capability handoff directory is required');
    this.directory = directory;
    this.path = join(directory, 'capability-handoffs.jsonl');
    this.queue = Promise.resolve();
  }

  serialize(work) {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }

  async ensure() {
    return this.serialize(async () => {
      try { return await this.read(); }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await chmod(this.directory, 0o700);
      const handle = await open(this.path, 'ax', 0o600); await handle.close();
      await chmod(this.path, 0o600);
      await appendFile(this.path, `${JSON.stringify({
        schema: SCHEMA, sequence: 1, recordedAt: new Date().toISOString(), type: 'ledger_started',
      })}\n`, { encoding: 'utf8', mode: 0o600 });
      return this.read();
    });
  }

  async read() {
    const events = parse(await readFile(this.path, 'utf8'));
    return { events: clone(events), handoffs: project(events) };
  }

  async append(type, fields) {
    const current = await this.read();
    const event = {
      schema: SCHEMA, sequence: current.events.length + 1,
      recordedAt: new Date().toISOString(), type, ...clone(fields),
    };
    await appendFile(this.path, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    return clone(event);
  }

  async start({ handoffId, sessionId, connectionId, mode, originRunId = handoffId } = {}) {
    const id = uuid(handoffId, 'handoff id');
    const session = uuid(sessionId, 'session id');
    const connection = identifier(connectionId, 'connection id');
    if (!MODES.has(mode)) throw new TypeError('capability handoff mode is invalid');
    const origin = uuid(originRunId, 'origin run id');
    return this.serialize(async () => {
      const current = await this.read();
      const existing = current.handoffs.find((entry) => entry.handoffId === id);
      if (existing) {
        if (existing.sessionId !== session || existing.connectionId !== connection || existing.mode !== mode) {
          throw new Error('capability handoff identity collision');
        }
        return existing;
      }
      await this.append('handoff_waiting', {
        handoffId: id, sessionId: session, connectionId: connection, mode, originRunId: origin,
      });
      return (await this.read()).handoffs.find((entry) => entry.handoffId === id);
    });
  }

  async transition(handoffId, allowed, type, fields = {}) {
    const id = uuid(handoffId, 'handoff id');
    return this.serialize(async () => {
      const current = await this.read();
      const handoff = current.handoffs.find((entry) => entry.handoffId === id);
      if (!handoff) throw new Error('capability handoff not found');
      if (allowed.idempotent.includes(handoff.state)) return handoff;
      if (!allowed.from.includes(handoff.state) || TERMINAL.has(handoff.state)) {
        throw new Error(`invalid capability handoff transition from ${handoff.state}`);
      }
      await this.append(type, { handoffId: id, ...fields });
      return (await this.read()).handoffs.find((entry) => entry.handoffId === id);
    });
  }

  observeReady(handoffId, connectionState) {
    if (!['ready', 'connected'].includes(connectionState)) throw new TypeError('connection is not ready');
    return this.transition(handoffId, {
      from: ['waiting'], idempotent: ['readiness_observed', 'completion_recorded', 'resume_claimed',
        'resume_completed_pending_surface', 'resumed'],
    }, 'readiness_observed', { connectionState });
  }

  recordCompletion(handoffId) {
    return this.transition(handoffId, {
      from: ['readiness_observed'], idempotent: ['completion_recorded', 'resume_claimed',
        'resume_completed_pending_surface', 'resumed'],
    }, 'completion_recorded');
  }

  async claimResume(handoffId) {
    const id = uuid(handoffId, 'handoff id');
    return this.serialize(async () => {
      const current = await this.read();
      const handoff = current.handoffs.find((entry) => entry.handoffId === id);
      if (!handoff) throw new Error('capability handoff not found');
      if (handoff.state === 'resume_claimed') return handoff;
      if (handoff.state !== 'completion_recorded') throw new Error('capability handoff is not resumable');
      await this.append('resume_claimed', { handoffId: id, claimId: randomUUID() });
      return (await this.read()).handoffs.find((entry) => entry.handoffId === id);
    });
  }

  markResumeCompletedPendingSurface(handoffId, { resumeRunId, resultPointer, resultDigest }) {
    const runId = uuid(resumeRunId, 'resume run id');
    if (!String(resultPointer ?? '').trim() || !String(resultDigest ?? '').trim()) {
      throw new TypeError('resume result pointer and digest are required');
    }
    return this.transition(handoffId, {
      from: ['resume_claimed'], idempotent: ['resume_completed_pending_surface', 'resumed'],
    }, 'resume_completed_pending_surface', { resumeRunId: runId,
      resultPointer: String(resultPointer), resultDigest: String(resultDigest) });
  }

  async markResumed(handoffId, { resumeRunId, surfaceReceipt }) {
    const id = uuid(handoffId, 'handoff id'); const runId = uuid(resumeRunId, 'resume run id');
    const current = await this.read(); const handoff = current.handoffs.find((entry) => entry.handoffId === id);
    if (!handoff) throw new Error('capability handoff not found');
    if (handoff.state === 'resumed') return handoff;
    if (handoff.state !== 'resume_completed_pending_surface' || handoff.resumeRunId !== runId) {
      throw new Error('resume completion is not pending surface');
    }
    if (!surfaceReceipt || surfaceReceipt.surface !== 'console_session'
      || surfaceReceipt.sessionId !== handoff.sessionId || surfaceReceipt.runId !== runId
      || surfaceReceipt.resultDigest !== handoff.resumeResultDigest) {
      throw new Error('exact resume surface receipt is required');
    }
    return this.transition(id, { from: ['resume_completed_pending_surface'], idempotent: ['resumed'] },
      'handoff_resumed', { resumeRunId: runId, surfaceReceipt });
  }

  cancel(handoffId) {
    return this.transition(handoffId, {
      from: ['waiting', 'readiness_observed', 'completion_recorded'], idempotent: ['cancelled'],
    }, 'handoff_cancelled');
  }

  needsAttention(handoffId, reason, resumeRunId = null) {
    const text = String(reason ?? '').trim();
    if (!text) throw new TypeError('capability handoff attention reason is required');
    return this.transition(handoffId, {
      from: ['waiting', 'readiness_observed', 'completion_recorded', 'resume_claimed'],
      idempotent: ['needs_attention'],
    }, 'handoff_needs_attention', {
      reason: text.slice(0, 120), ...(resumeRunId ? { resumeRunId: uuid(resumeRunId, 'resume run id') } : {}),
    });
  }
}
