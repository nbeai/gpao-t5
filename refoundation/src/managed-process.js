import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const DEFAULT_OUTPUT_LIMIT = 64_000;
const DEFAULT_SPOOL_LIMIT = 1024 * 1024;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function limited(text, limit) {
  if (text.length <= limit) return { text, omittedChars: 0, truncated: false };
  const head = Math.floor(limit / 2);
  const tail = limit - head;
  return {
    text: `${text.slice(0, head)}\n…(${text.length - limit} characters omitted)…\n${text.slice(-tail)}`,
    omittedChars: text.length - limit,
    truncated: true,
  };
}

class OutputSpool {
  constructor(limit) {
    this.limit = limit;
    this.text = '';
    this.start = 0;
    this.total = 0;
  }

  append(chunk) {
    const value = String(chunk);
    this.text += value;
    this.total += value.length;
    if (this.text.length > this.limit) {
      const remove = this.text.length - this.limit;
      this.text = this.text.slice(remove);
      this.start += remove;
    }
  }

  read(cursor, outputLimit) {
    const requested = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
    const effective = Math.max(requested, this.start);
    const raw = this.text.slice(effective - this.start);
    const output = limited(raw, outputLimit);
    return {
      text: output.text,
      next: this.total,
      truncated: output.truncated || requested < this.start,
      omittedChars: output.omittedChars + Math.max(0, this.start - requested),
    };
  }
}

function terminal(state) {
  return state === 'completed' || state === 'failed' || state === 'stopped';
}

export class ManagedProcessRegistry {
  constructor({
    platform = process.platform,
    spawnProcess = spawn,
    outputLimit = DEFAULT_OUTPUT_LIMIT,
    spoolLimit = DEFAULT_SPOOL_LIMIT,
    stopGraceMs = 1000,
    killGraceMs = 2000,
  } = {}) {
    this.platform = platform;
    this.spawnProcess = spawnProcess;
    this.outputLimit = outputLimit;
    this.spoolLimit = spoolLimit;
    this.stopGraceMs = stopGraceMs;
    this.killGraceMs = killGraceMs;
    this.records = new Map();
  }

  #owned(processId, ownerId) {
    const record = this.records.get(String(processId ?? ''));
    if (!record || record.ownerId !== ownerId) {
      throw Object.assign(new Error('process not found'), { status: 404 });
    }
    return record;
  }

  #snapshot(record, cursor = {}) {
    const out = record.stdout.read(cursor?.stdout, this.outputLimit);
    const err = record.stderr.read(cursor?.stderr, this.outputLimit);
    return {
      processId: record.id,
      state: record.state,
      command: record.command ?? null,
      cwd: record.cwd,
      stdout: out.text,
      stderr: err.text,
      cursor: { stdout: out.next, stderr: err.next },
      truncated: out.truncated || err.truncated,
      omittedChars: out.omittedChars + err.omittedChars,
      exitCode: record.exitCode,
      signal: record.signal,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      durationMs: (record.endedAtMs ?? Date.now()) - record.startedAtMs,
      ...(record.error ? { error: record.error } : {}),
      ...(record.stopReason ? { stopReason: record.stopReason } : {}),
      ...(record.state === 'stopped' ? { terminationConfirmed: true } : {}),
      ...(record.state === 'stop_requested' ? { terminationConfirmed: false } : {}),
    };
  }

  #notifyActivity(record) {
    for (const notify of record.activityWaiters) notify();
    record.activityWaiters.clear();
  }

  #waitForActivity(record, waitMs, before) {
    return new Promise((resolveActivity) => {
      let timer;
      const done = () => {
        clearTimeout(timer);
        record.activityWaiters.delete(done);
        resolveActivity();
      };
      record.activityWaiters.add(done);
      timer = setTimeout(done, waitMs);
      if (terminal(record.state)
        || record.stdout.total !== before.stdout
        || record.stderr.total !== before.stderr) queueMicrotask(done);
    });
  }

  async start({
    program, args = [], cwd, env, ownerId, waitMs = 1000, command = null,
    spoolLimit = this.spoolLimit,
  }) {
    if (!program || !cwd || !ownerId) throw new TypeError('program, cwd, and ownerId are required');
    const id = randomUUID();
    const child = this.spawnProcess(program, args, {
      cwd,
      env,
      detached: this.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const record = {
      id, ownerId, child, command, cwd,
      state: 'running', exitCode: null, signal: null, error: null,
      stopReason: null, startedAt: new Date().toISOString(), startedAtMs: Date.now(), endedAt: null, endedAtMs: null,
      stdout: new OutputSpool(spoolLimit),
      stderr: new OutputSpool(spoolLimit),
      activityWaiters: new Set(),
      closePromise: null,
    };
    record.closePromise = new Promise((resolveClose) => { record.resolveClose = resolveClose; });
    this.records.set(id, record);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      record.stdout.append(chunk);
      this.#notifyActivity(record);
    });
    child.stderr?.on('data', (chunk) => {
      record.stderr.append(chunk);
      this.#notifyActivity(record);
    });
    child.once('error', (error) => {
      record.error = error?.message ?? String(error);
    });
    child.once('close', (code, signal) => {
      record.exitCode = code ?? -1;
      record.signal = signal ?? null;
      record.endedAt = new Date().toISOString();
      record.endedAtMs = Date.now();
      if (record.state === 'stop_requested') record.state = 'stopped';
      else record.state = code === 0 ? 'completed' : 'failed';
      this.#notifyActivity(record);
      record.resolveClose();
    });
    if (waitMs == null) await record.closePromise;
    else await Promise.race([record.closePromise, delay(Math.max(0, waitMs))]);
    return this.#snapshot(record);
  }

  async poll({ processId, cursor, ownerId, waitMs = 0 }) {
    const record = this.#owned(processId, ownerId);
    const before = { stdout: record.stdout.total, stderr: record.stderr.total };
    if (!terminal(record.state) && waitMs > 0
      && before.stdout === (cursor?.stdout ?? 0)
      && before.stderr === (cursor?.stderr ?? 0)) {
      await this.#waitForActivity(record, waitMs, before);
    }
    return this.#snapshot(record, cursor);
  }

  write({ processId, input, ownerId, end = false }) {
    const record = this.#owned(processId, ownerId);
    if (record.state !== 'running') {
      throw Object.assign(new Error(`process is not running: ${record.state}`), { status: 409 });
    }
    const accepted = record.child.stdin?.write(String(input ?? '')) ?? false;
    if (end) record.child.stdin?.end();
    return { processId: record.id, state: record.state, accepted, stdinEnded: Boolean(end) };
  }

  async #signalTree(record, signal) {
    if (this.platform === 'win32') {
      const force = signal === 'SIGKILL' ? ['/F'] : [];
      const killer = this.spawnProcess('taskkill.exe', ['/PID', String(record.child.pid), '/T', ...force], {
        stdio: 'ignore', detached: false,
      });
      killer.unref?.();
      return;
    }
    try { process.kill(-record.child.pid, signal); }
    catch (error) { if (error?.code !== 'ESRCH') throw error; }
  }

  async stop({ processId, ownerId, reason = 'requested', cursor }) {
    const record = this.#owned(processId, ownerId);
    if (terminal(record.state)) return this.#snapshot(record, cursor);
    if (record.state !== 'stop_requested') {
      record.state = 'stop_requested';
      record.stopReason = reason;
      await this.#signalTree(record, 'SIGTERM');
    }
    await Promise.race([record.closePromise, delay(this.stopGraceMs)]);
    if (!terminal(record.state)) {
      await this.#signalTree(record, 'SIGKILL');
      await Promise.race([record.closePromise, delay(this.killGraceMs)]);
    }
    return this.#snapshot(record, cursor);
  }

  list(ownerId) {
    return [...this.records.values()]
      .filter((record) => record.ownerId === ownerId)
      .map((record) => this.#snapshot(record, {
        stdout: record.stdout.total,
        stderr: record.stderr.total,
      }));
  }

  forget(processId, ownerId) {
    const record = this.#owned(processId, ownerId);
    if (!terminal(record.state)) throw Object.assign(new Error('cannot forget a running process'), { status: 409 });
    this.records.delete(record.id);
    return true;
  }

  async stopOwner(ownerId, reason = 'owner_cancelled') {
    const owned = [...this.records.values()].filter((record) => record.ownerId === ownerId && !terminal(record.state));
    return Promise.all(owned.map((record) => this.stop({ processId: record.id, ownerId, reason })));
  }

  async stopAll(reason = 'runtime_shutdown') {
    const active = [...this.records.values()].filter((record) => !terminal(record.state));
    return Promise.all(active.map((record) => this.stop({
      processId: record.id, ownerId: record.ownerId, reason,
    })));
  }
}
