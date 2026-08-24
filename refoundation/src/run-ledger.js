import { randomUUID } from 'node:crypto';
import { appendFile, chmod, mkdir, open, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const SCHEMA = 't5.run-event.v1';
const TERMINAL = new Set(['run_completed', 'run_cancelled', 'run_failed']);

function clone(value) { return value == null ? value : structuredClone(value); }

function safeRunId(runId) {
  const value = String(runId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw Object.assign(new Error('run not found'), { status: 404 });
  return value;
}

class RunWriter {
  constructor({ runId, file, onTerminal }) {
    this.runId = runId;
    this.file = file;
    this.sequence = 0;
    this.queue = Promise.resolve();
    this.finished = false;
    this.onTerminal = onTerminal;
  }

  serialize(work) {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }

  append({ type, stepId = null, payload = {} }) {
    if (!type) throw new TypeError('run event type is required');
    return this.serialize(async () => {
      if (this.finished && type !== 'surface_metric') throw new Error('run is already finished');
      const event = {
        schema: SCHEMA,
        runId: this.runId,
        sequence: this.sequence + 1,
        recordedAt: new Date().toISOString(),
        type: String(type),
        ...(stepId ? { stepId: String(stepId) } : {}),
        payload: clone(payload),
      };
      await appendFile(this.file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
      this.sequence = event.sequence;
      if (TERMINAL.has(event.type)) {
        this.finished = true;
        this.onTerminal?.();
      }
      return clone(event);
    });
  }

  finish(status, payload = {}) {
    if (!['completed', 'cancelled', 'failed'].includes(status)) throw new TypeError('invalid run status');
    return this.append({ type: `run_${status}`, payload });
  }
}

export class RunLedger {
  constructor(directory) {
    if (!directory) throw new TypeError('run ledger directory is required');
    this.directory = directory;
    this.activeRuns = new Set();
  }

  async start({ sessionId, request, metadata = {} }) {
    if (!sessionId || typeof request !== 'string') throw new TypeError('sessionId and request are required');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const runId = randomUUID();
    const file = join(this.directory, `${runId}.jsonl`);
    const handle = await open(file, 'ax', 0o600);
    await handle.close();
    await chmod(file, 0o600);
    this.activeRuns.add(runId);
    const writer = new RunWriter({
      runId, file, onTerminal: () => this.activeRuns.delete(runId),
    });
    await writer.append({
      type: 'run_started',
      payload: { sessionId: String(sessionId), request, metadata: clone(metadata) },
    });
    return writer;
  }

  async read(runId) {
    const id = safeRunId(runId);
    let text;
    try { text = await readFile(join(this.directory, `${id}.jsonl`), 'utf8'); }
    catch (error) {
      if (error?.code === 'ENOENT') throw Object.assign(new Error('run not found'), { status: 404 });
      throw error;
    }
    const events = text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    if (!events.length || events[0].type !== 'run_started') throw new Error('invalid run ledger');
    for (let index = 0; index < events.length; index += 1) {
      if (events[index].schema !== SCHEMA || events[index].runId !== id || events[index].sequence !== index + 1) {
        throw new Error('invalid run event sequence');
      }
    }
    const terminal = [...events].reverse().find((event) => TERMINAL.has(event.type));
    const status = terminal ? terminal.type.slice('run_'.length)
      : this.activeRuns.has(id) ? 'running' : 'interrupted';
    return {
      runId: id,
      sessionId: events[0].payload.sessionId,
      request: events[0].payload.request,
      metadata: clone(events[0].payload.metadata ?? {}),
      status,
      startedAt: events[0].recordedAt,
      endedAt: terminal?.recordedAt ?? null,
      events,
    };
  }

  async list({ sessionId } = {}) {
    let names;
    try { names = await readdir(this.directory); }
    catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
    const runs = [];
    for (const name of names.filter((entry) => /^[0-9a-f-]{36}\.jsonl$/i.test(entry))) {
      const run = await this.read(name.slice(0, -'.jsonl'.length));
      if (!sessionId || run.sessionId === sessionId) runs.push(run);
    }
    return runs.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }
  async appendRecoveredSurface(runId, type, payload = {}) {
    if (!['surface_persisted', 'delivery_terminal'].includes(type)) {
      throw new TypeError('invalid recovered surface event');
    }
    const run = await this.read(runId);
    if (run.events.some((event) => event.type === type)) return run;
    const event = { schema: SCHEMA, runId: run.runId, sequence: run.events.length + 1,
      recordedAt: new Date().toISOString(), type, payload: clone(payload) };
    await appendFile(join(this.directory, `${run.runId}.jsonl`), `${JSON.stringify(event)}\n`, {
      encoding: 'utf8', mode: 0o600,
    });
    return this.read(run.runId);
  }
}
