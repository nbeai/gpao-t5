import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const initial = () => ({ version: 1, events: [] });

export class RuntimeContinuityLedger {
  constructor(directory, { now = () => Date.now() } = {}) {
    if (!directory) throw new TypeError('runtime continuity directory is required');
    this.directory = directory; this.file = join(directory, 'events.json'); this.now = now;
  }
  async read() {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'));
      if (value?.version !== 1 || !Array.isArray(value.events)) throw new Error('runtime continuity state is invalid');
      return value;
    } catch (error) { if (error?.code === 'ENOENT') return initial(); throw error; }
  }
  async append(type, facts = {}) {
    const state = await this.read(); const at = Number(facts.at ?? this.now());
    if (!Number.isSafeInteger(at) || at < 0) throw new TypeError('runtime continuity time is invalid');
    const event = { sequence: (state.events.at(-1)?.sequence ?? 0) + 1, type, at,
      ...Object.fromEntries(Object.entries(facts).filter(([key]) => key !== 'at')) };
    state.events.push(event); state.events = state.events.slice(-64);
    await mkdir(this.directory, { recursive: true, mode: 0o700 }); await chmod(this.directory, 0o700);
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600); await rename(temporary, this.file); await chmod(this.file, 0o600);
    return event;
  }
  async start({ generationId, at = this.now() } = {}) {
    const state = await this.read(); const previous = state.events.at(-1) ?? null;
    const previousDisposition = !previous ? 'first_start'
      : previous.type === 'runtime_stopped' ? 'clean_stop' : 'interrupted';
    return this.append('runtime_started', { at, generationId, previousDisposition,
      downtimeMs: previous ? Math.max(0, at - previous.at) : null, executionClaimedDuringDowntime: false });
  }
  gap({ generationId, gapMs, at = this.now() } = {}) {
    return this.append('runtime_gap_observed', { at, generationId,
      gapMs: Math.max(0, Math.round(gapMs)), executionClaimedDuringGap: false });
  }
  stop({ generationId, reason, at = this.now() } = {}) {
    return this.append('runtime_stopped', { at, generationId, reason });
  }
}

export function makeRuntimeContinuityMonitor({ ledger, generationId, gapThresholdMs = 30_000,
  tickMs = 5_000, onGap = async () => {}, now = () => Date.now() } = {}) {
  if (!ledger || !generationId) throw new TypeError('runtime continuity monitor requires ledger and generation');
  let last = now(); let pending = Promise.resolve();
  const timer = setInterval(() => {
    const current = now(); const gapMs = current - last; last = current;
    if (gapMs <= gapThresholdMs) return;
    pending = pending.then(async () => { await ledger.gap({ generationId, gapMs, at: current }); await onGap(); });
  }, tickMs);
  timer.unref?.();
  return { async stop() { clearInterval(timer); await pending; } };
}
