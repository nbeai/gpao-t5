import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { windowsJobHostLaunch } from './windows-process-boundary.js';

const DEFAULT_OUTPUT_LIMIT = 64_000;
const DEFAULT_SPOOL_LIMIT = 1024 * 1024;
const DEFAULT_MACOS_PARENT_DEATH_HOST = fileURLToPath(
  new URL('../scripts/macos-parent-death-host.mjs', import.meta.url),
);

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
  full() { return { text: this.text, totalChars: this.total, omittedChars: this.start }; }
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
    windowsJobHost = null,
    macosParentDeathHost = platform === 'darwin' ? DEFAULT_MACOS_PARENT_DEATH_HOST : null,
  } = {}) {
    this.platform = platform;
    this.spawnProcess = spawnProcess;
    this.outputLimit = outputLimit;
    this.spoolLimit = spoolLimit;
    this.stopGraceMs = stopGraceMs;
    this.killGraceMs = killGraceMs;
    this.windowsJobHost = windowsJobHost;
    this.macosParentDeathHost = macosParentDeathHost;
    this.records = new Map();
    this.terminalListeners = new Set();
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
      ...(record.processBoundary ? { processBoundary: structuredClone(record.processBoundary) } : {}),
      ...(record.outputSink ? { outputRecall: {
        handle: record.outputSink.handle, state: record.outputSinkState,
        cursor: structuredClone(record.outputPersisted),
      } } : {}),
      ...(record.outputSinkState === 'degraded' ? {
        exactOutputRecallUnavailable: true,
        outputPersistence: { state: 'degraded', reason: 'live_output_persistence_failed' },
      } : {}),
    };
  }

  #notifyActivity(record) {
    for (const notify of record.activityWaiters) notify();
    record.activityWaiters.clear();
  }

  #appendPersistedOutput(record, stream, chunk) {
    if (!record.outputSink || record.outputSinkState === 'degraded') return;
    record.outputSinkChain = record.outputSinkChain.then(async () => {
      const persisted = await record.outputSink.append({ stream, text: String(chunk) });
      record.outputPersisted[stream] = persisted.totalChars;
    }).catch(() => { record.outputSinkState = 'degraded'; });
  }

  async #finalizePersistedOutput(record) {
    if (!record.outputSink) return;
    await record.outputSinkChain;
    if (record.outputSinkState === 'degraded') return;
    try { await record.outputSink.finalize(); record.outputSinkState = 'finalized'; }
    catch { record.outputSinkState = 'degraded'; }
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

  #notifyTerminal(record) {
    const event = {
      processId: record.id,
      ownerId: record.ownerId,
      state: record.state,
      metadata: structuredClone(record.metadata),
    };
    setTimeout(() => {
      for (const listener of this.terminalListeners) listener(structuredClone(event));
    }, 0);
  }

  async start({
    program, args = [], cwd, env, ownerId, waitMs = 1000, command = null,
    spoolLimit = this.spoolLimit, metadata = {}, onActivity = null, outputSink = null,
  }) {
    if (!program || !cwd || !ownerId) throw new TypeError('program, cwd, and ownerId are required');
    if (this.platform === 'win32' && !this.windowsJobHost) {
      throw Object.assign(new Error('Windows Job Object host is required'), {
        code: 'T5_WINDOWS_JOB_HOST_REQUIRED',
      });
    }
    const id = randomUUID();
    const hosted = this.platform === 'win32' && this.windowsJobHost
      ? windowsJobHostLaunch({ host: this.windowsJobHost, program, args, cwd }) : null;
    if (this.platform === 'darwin' && (!this.macosParentDeathHost
      || !existsSync(this.macosParentDeathHost))) {
      throw Object.assign(new Error('macOS parent-death host is required'), {
        code: 'T5_MACOS_PARENT_DEATH_HOST_REQUIRED',
      });
    }
    const parentDeathHosted = this.platform === 'darwin' ? {
      program: process.execPath,
      args: [this.macosParentDeathHost, hosted?.program ?? program, ...(hosted?.args ?? args)],
      boundary: { kind: 'macos_parent_death_process_group', qualified: true },
    } : null;
    const child = this.spawnProcess(parentDeathHosted?.program ?? hosted?.program ?? program,
      parentDeathHosted?.args ?? hosted?.args ?? args, {
      cwd,
      env,
      detached: this.platform !== 'win32',
      stdio: parentDeathHosted ? ['pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
    });
    if (parentDeathHosted) {
      let controlReply = '';
      child.stdio[3].setEncoding('utf8');
      child.stdio[3].on('data', (chunk) => {
        controlReply += String(chunk);
        if (controlReply.includes('complete\n')) child.stdio[3].destroy();
      });
      child.once('exit', () => { child.stdio?.[3]?.destroy(); });
    }
    const record = {
      id, ownerId, child, command, cwd,
      metadata: structuredClone(metadata), terminalObserved: false, wakeClaimed: false,
      processBoundary: parentDeathHosted?.boundary ?? hosted?.boundary ?? (this.platform === 'win32'
        ? { kind: 'windows_process_tree_unqualified', qualified: false } : null),
      state: 'running', exitCode: null, signal: null, error: null,
      stopReason: null, startedAt: new Date().toISOString(), startedAtMs: Date.now(), endedAt: null, endedAtMs: null,
      stdout: new OutputSpool(spoolLimit),
      stderr: new OutputSpool(spoolLimit),
      outputSink, outputSinkState: outputSink ? 'live' : null,
      outputSinkChain: Promise.resolve(),
      outputPersisted: { stdout: 0, stderr: 0 },
      activityWaiters: new Set(),
      closePromise: null,
    };
    record.closePromise = new Promise((resolveClose) => { record.resolveClose = resolveClose; });
    this.records.set(id, record);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      record.stdout.append(chunk);
      this.#appendPersistedOutput(record, 'stdout', chunk);
      if (typeof onActivity === 'function') Promise.resolve(onActivity({ stream: 'stdout',
        deltaChars: String(chunk).length, totalChars: record.stdout.total, state: record.state })).catch(() => {});
      this.#notifyActivity(record);
    });
    child.stderr?.on('data', (chunk) => {
      record.stderr.append(chunk);
      this.#appendPersistedOutput(record, 'stderr', chunk);
      if (typeof onActivity === 'function') Promise.resolve(onActivity({ stream: 'stderr',
        deltaChars: String(chunk).length, totalChars: record.stderr.total, state: record.state })).catch(() => {});
      this.#notifyActivity(record);
    });
    child.once('error', (error) => {
      record.error = error?.message ?? String(error);
    });
    child.once('close', (code, signal) => { Promise.resolve().then(async () => {
      await this.#finalizePersistedOutput(record);
      record.exitCode = code ?? -1;
      record.signal = signal ?? null;
      record.endedAt = new Date().toISOString();
      record.endedAtMs = Date.now();
      if (record.state === 'stop_requested') record.state = 'stopped';
      else record.state = code === 0 ? 'completed' : 'failed';
      this.#notifyActivity(record);
      record.resolveClose();
      this.#notifyTerminal(record);
    }); });
    if (waitMs == null) await record.closePromise;
    else await Promise.race([record.closePromise, delay(Math.max(0, waitMs))]);
    return this.#snapshot(record);
  }

  async startPty({ ptyProcess, command, cwd, ownerId, waitMs = 1000, metadata = {},
    spoolLimit = this.spoolLimit, onActivity = null, outputSink = null }) {
    if (!ptyProcess || !cwd || !ownerId) throw new TypeError('ptyProcess, cwd, and ownerId are required');
    const id = randomUUID();
    const child = {
      pid: ptyProcess.pid,
      stdin: {
        write: (input) => { ptyProcess.write(String(input)); return true; },
        end: () => {},
      },
    };
    const record = {
      id, ownerId, child, ptyProcess, command, cwd,
      metadata: structuredClone(metadata), terminalObserved: false, wakeClaimed: false,
      state: 'running', exitCode: null, signal: null, error: null,
      stopReason: null, startedAt: new Date().toISOString(), startedAtMs: Date.now(), endedAt: null, endedAtMs: null,
      stdout: new OutputSpool(spoolLimit), stderr: new OutputSpool(spoolLimit),
      outputSink, outputSinkState: outputSink ? 'live' : null,
      outputSinkChain: Promise.resolve(),
      outputPersisted: { stdout: 0, stderr: 0 },
      activityWaiters: new Set(), closePromise: null,
    };
    record.closePromise = new Promise((resolveClose) => { record.resolveClose = resolveClose; });
    this.records.set(id, record);
    ptyProcess.onData((chunk) => {
      record.stdout.append(chunk);
      this.#appendPersistedOutput(record, 'stdout', chunk);
      if (typeof onActivity === 'function') Promise.resolve(onActivity({ stream: 'stdout',
        deltaChars: String(chunk).length, totalChars: record.stdout.total, state: record.state })).catch(() => {});
      this.#notifyActivity(record);
    });
    ptyProcess.onExit(({ exitCode, signal }) => { Promise.resolve().then(async () => {
      await this.#finalizePersistedOutput(record);
      record.exitCode = exitCode ?? -1;
      record.signal = signal == null ? null : String(signal);
      record.endedAt = new Date().toISOString();
      record.endedAtMs = Date.now();
      if (record.state === 'stop_requested') record.state = 'stopped';
      else record.state = exitCode === 0 ? 'completed' : 'failed';
      this.#notifyActivity(record);
      record.resolveClose();
      this.#notifyTerminal(record);
    }); });
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
    await record.outputSinkChain;
    const snapshot = this.#snapshot(record, cursor);
    if (terminal(record.state)) record.terminalObserved = true;
    return snapshot;
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

  resize({ processId, cols, rows, ownerId }) {
    const record = this.#owned(processId, ownerId);
    if (!record.ptyProcess || record.state !== 'running') {
      throw Object.assign(new Error('process is not a running PTY'), { status: 409 });
    }
    record.ptyProcess.resize(cols, rows);
    return { processId: record.id, state: record.state, cols, rows };
  }

  async #signalTree(record, signal) {
    if (record.ptyProcess) {
      try { record.ptyProcess.kill(signal); }
      catch (error) { if (error?.code !== 'ESRCH') throw error; }
      return;
    }
    if (this.platform === 'win32') {
      if (record.processBoundary?.kind === 'windows_job_object') {
        try { record.child.kill(); } catch (error) { if (error?.code !== 'ESRCH') throw error; }
        return;
      }
      throw new Error('unqualified Windows process tree cannot be terminated');
    }
    try { process.kill(-record.child.pid, signal); }
    catch (error) { if (error?.code !== 'ESRCH') throw error; }
  }

  async stop({ processId, ownerId, reason = 'requested', cursor }) {
    const record = this.#owned(processId, ownerId);
    if (terminal(record.state)) {
      const snapshot = this.#snapshot(record, cursor);
      record.terminalObserved = true;
      return snapshot;
    }
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
    const snapshot = this.#snapshot(record, cursor);
    if (terminal(record.state)) record.terminalObserved = true;
    return snapshot;
  }

  list(ownerId) {
    return [...this.records.values()]
      .filter((record) => record.ownerId === ownerId)
      .map((record) => {
        const snapshot = this.#snapshot(record, {
        stdout: record.stdout.total,
        stderr: record.stderr.total,
        });
        if (terminal(record.state)) record.terminalObserved = true;
        return snapshot;
      });
  }

  onTerminal(listener) {
    if (typeof listener !== 'function') throw new TypeError('terminal listener is required');
    this.terminalListeners.add(listener);
    return () => this.terminalListeners.delete(listener);
  }

  markTerminalObserved(processId, ownerId) {
    const record = this.#owned(processId, ownerId);
    if (terminal(record.state)) record.terminalObserved = true;
  }

  metadata(processId, ownerId) {
    return structuredClone(this.#owned(processId, ownerId).metadata);
  }

  fullOutput(processId, ownerId) {
    const record = this.#owned(processId, ownerId);
    return { stdout: record.stdout.full(), stderr: record.stderr.full() };
  }

  claimTerminalWake(processId) {
    const record = this.records.get(String(processId ?? ''));
    if (!record || !terminal(record.state) || record.metadata?.kind !== 'managed'
      || record.terminalObserved || record.wakeClaimed
      || ['runtime_shutdown', 'test_cleanup', 'model_classified_cancel',
        'user_cancelled', 'user_recovered_or_cancelled'].includes(record.stopReason)) return null;
    record.wakeClaimed = true;
    return {
      ...this.#snapshot(record),
      ownerId: record.ownerId,
      metadata: structuredClone(record.metadata),
    };
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
