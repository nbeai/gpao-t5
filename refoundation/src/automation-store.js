import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CronExpressionParser } from 'cron-parser';

const SCHEMA = 't5.automation-store.v1';
const LIVE = new Set(['scheduled', 'paused', 'needs_review']);

function clone(value) { return value == null ? value : structuredClone(value); }
function nowIso(now) { return new Date(now).toISOString(); }

function timezone(value) {
  const zone = String(value ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC').trim();
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(new Date()); }
  catch { throw new TypeError('invalid automation timezone'); }
  return zone;
}

function everyMs(value) {
  const match = String(value ?? '').trim().match(/^(\d+)(m|h|d)$/iu);
  if (!match) throw new TypeError('every schedule must look like 15m, 2h, or 1d');
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2].toLowerCase()];
  const duration = Number(match[1]) * unit;
  if (!Number.isSafeInteger(duration) || duration < 60_000 || duration > 365 * 86_400_000) {
    throw new TypeError('automation interval is out of range');
  }
  return duration;
}

export function normalizeAutomationSchedule({ kind, value, timezone: zone } = {}, current = Date.now()) {
  const scheduleKind = String(kind ?? '');
  const expression = String(value ?? '').trim();
  const tz = timezone(zone);
  if (scheduleKind === 'cron') {
    if (expression.split(/\s+/u).length !== 5) throw new TypeError('cron schedule must contain five fields');
    let next;
    try { next = CronExpressionParser.parse(expression, { currentDate: new Date(current), tz }).next().getTime(); }
    catch { throw new TypeError('invalid cron schedule'); }
    return { kind: 'cron', expression, timezone: tz, nextRunAt: next };
  }
  if (scheduleKind === 'every') {
    const durationMs = everyMs(expression);
    return { kind: 'every', expression, timezone: tz, durationMs, nextRunAt: current + durationMs };
  }
  if (scheduleKind === 'at') {
    const nextRunAt = Date.parse(expression);
    if (!Number.isFinite(nextRunAt) || nextRunAt <= current) throw new TypeError('one-time schedule must be in the future');
    return { kind: 'at', expression: new Date(nextRunAt).toISOString(), timezone: tz, nextRunAt };
  }
  throw new TypeError('automation schedule kind must be cron, every, or at');
}

export function nextAutomationRun(schedule, current = Date.now()) {
  if (schedule.kind === 'at') return null;
  if (schedule.kind === 'every') return current + Number(schedule.durationMs);
  try {
    return CronExpressionParser.parse(schedule.expression, {
      currentDate: new Date(current), tz: schedule.timezone,
    }).next().getTime();
  } catch { return null; }
}

function emptyState() { return { schema: SCHEMA, version: 1, jobs: [], runs: [] }; }

function automationRequirements(value = {}) {
  const requiredTools = [...new Set((value.requiredTools ?? []).map(String))];
  if (requiredTools.length > 10 || requiredTools.some((name) => !/^[a-z][a-z0-9_]{0,63}$/u.test(name))) {
    throw new TypeError('automation required tools are invalid');
  }
  const requiredEffect = value.requiredEffect == null ? null : String(value.requiredEffect);
  if (requiredEffect && !['observe', 'local_change', 'external_change', 'external_send'].includes(requiredEffect)) {
    throw new TypeError('automation required effect is invalid');
  }
  return { requiredTools, requiredEffect, requireResultUrl: value.requireResultUrl === true };
}

function automationDelivery(value = {}) {
  const kind = String(value.kind ?? 'origin_session');
  if (!['origin_session', 'telegram', 'none'].includes(kind)) throw new TypeError('automation delivery is invalid');
  const sessionId = value.sessionId == null ? null : String(value.sessionId);
  if (kind === 'telegram' && !sessionId) throw new TypeError('telegram automation delivery requires a bound session');
  return { kind, sessionId };
}

function validateState(state) {
  if (state?.schema !== SCHEMA || state.version !== 1 || !Array.isArray(state.jobs) || !Array.isArray(state.runs)) {
    throw new Error('invalid automation store');
  }
  return state;
}

export class AutomationStore {
  constructor(file, { now = Date.now } = {}) {
    if (!file) throw new TypeError('automation store file is required');
    this.file = file; this.now = now; this.queue = Promise.resolve();
  }
  serialize(work) { const next = this.queue.then(work, work); this.queue = next.catch(() => {}); return next; }
  async read() {
    try { return validateState(JSON.parse(await readFile(this.file, 'utf8'))); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; return emptyState(); }
  }
  async write(state) {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 }); await chmod(dirname(this.file), 0o700);
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 }); await chmod(temporary, 0o600);
    await rename(temporary, this.file);
  }
  async snapshot() { const state = await this.read(); return clone(state); }
  async change(mutator) {
    return this.serialize(async () => { const state = await this.read(); const result = await mutator(state); await this.write(state); return clone(result); });
  }
  async create({ name, prompt, sessionId, scheduleKind, schedule, timezone: zone,
    requirements, delivery, authorityEnvelope = null } = {}) {
    const title = String(name ?? '').trim(); const task = String(prompt ?? '').trim();
    if (!title || title.length > 200) throw new TypeError('automation name is required');
    if (!task || task.length > 10_000) throw new TypeError('automation prompt is required');
    if (!sessionId) throw new TypeError('automation session is required');
    return this.change((state) => {
      const current = this.now(); const normalized = normalizeAutomationSchedule({ kind: scheduleKind, value: schedule, timezone: zone }, current);
      const job = {
        id: randomUUID(), name: title, prompt: task, sessionId: String(sessionId), state: 'scheduled',
        schedule: { kind: normalized.kind, expression: normalized.expression, timezone: normalized.timezone,
          ...(normalized.durationMs ? { durationMs: normalized.durationMs } : {}) },
        trigger: { misfirePolicy: 'skip' },
        requirements: automationRequirements(requirements),
        delivery: automationDelivery(delivery),
        authorityEnvelope: authorityEnvelope ? clone(authorityEnvelope) : null,
        nextRunAt: normalized.nextRunAt, runningAt: null, createdAt: current, updatedAt: current,
        lastRunAt: null, lastStatus: null, lastError: null,
      };
      state.jobs.push(job); return job;
    });
  }
  async list() { const state = await this.read(); return { jobs: clone(state.jobs), runs: clone(state.runs), candidates: [] }; }
  async inspect(jobId) { return clone((await this.read()).jobs.find((job) => job.id === jobId) ?? null); }
  async pause(jobId) { return this.change((state) => { const job = state.jobs.find((item) => item.id === jobId); if (!job) throw new Error('automation not found');
    if (job.runningAt) throw new Error('running automation cannot be paused until it finishes'); job.state = 'paused'; job.updatedAt = this.now(); return job; }); }
  async resume(jobId) { return this.change((state) => { const job = state.jobs.find((item) => item.id === jobId); if (!job) throw new Error('automation not found');
    if (!job.requirements || !job.delivery) throw new Error('automation contract is missing');
    if (!LIVE.has(job.state)) throw new Error('automation cannot be resumed'); job.state = 'scheduled'; job.nextRunAt = nextAutomationRun(job.schedule, this.now());
    if (!job.nextRunAt) throw new Error('one-time automation time has passed'); job.updatedAt = this.now(); return job; }); }
  async cancel(jobId) { return this.change((state) => { const job = state.jobs.find((item) => item.id === jobId); if (!job) throw new Error('automation not found');
    job.state = 'cancelled'; job.nextRunAt = null; job.updatedAt = this.now(); return job; }); }
  async quarantineUnqualified() { return this.change((state) => { const current = this.now(); const quarantined = [];
    for (const job of state.jobs.filter((item) => (
      !['cancelled', 'expired'].includes(item.state) && (!item.requirements || !item.delivery)
    ))) {
      job.state = 'needs_review'; job.nextRunAt = null; job.runningAt = null;
      job.lastStatus = 'failed'; job.lastError = 'automation_contract_missing'; job.updatedAt = current;
      quarantined.push(job.id);
    }
    return quarantined;
  }); }
  async quarantineUnavailableTools(unavailableTools = []) { return this.change((state) => {
    const unavailable = new Set(unavailableTools.map(String)); const current = this.now(); const quarantined = [];
    for (const job of state.jobs.filter((item) => (
      !['cancelled', 'expired'].includes(item.state)
      && item.requirements?.requiredTools?.some((name) => unavailable.has(name))
    ))) {
      job.state = 'needs_review'; job.nextRunAt = null; job.runningAt = null;
      job.lastStatus = 'failed'; job.lastError = 'required_tool_unavailable'; job.updatedAt = current;
      quarantined.push(job.id);
    }
    return quarantined;
  }); }
  async recoverInterrupted() { return this.change((state) => { const current = this.now(); const recovered = [];
    for (const job of state.jobs.filter((item) => item.runningAt)) {
      const run = [...state.runs].reverse().find((item) => item.jobId === job.id && ['claimed', 'running'].includes(item.status));
      if (run) { run.status = 'unknown'; run.finishedAt = current; run.userSafeSummary = 'T5가 종료되어 이전 실행의 완료 여부를 확인하지 못했어요.'; }
      job.runningAt = null; job.lastStatus = 'unknown'; job.lastError = 'runtime_interrupted';
      if (job.schedule.kind === 'at') { job.state = 'needs_review'; job.nextRunAt = null; }
      else { job.state = job.state === 'paused' ? 'paused' : 'scheduled'; job.nextRunAt = nextAutomationRun(job.schedule, current); }
      job.updatedAt = current; recovered.push(job.id);
    }
    return recovered;
  }); }
  async claimDue({ jobId = null, force = false } = {}) { return this.change((state) => { const current = this.now(); const claims = [];
    for (const job of state.jobs) {
      if (jobId && job.id !== jobId) continue;
      if (job.runningAt || ['cancelled', 'expired'].includes(job.state)) continue;
      const due = job.state === 'scheduled' && Number.isFinite(job.nextRunAt) && job.nextRunAt <= current;
      if (!force && !due) continue;
      if (force && !['scheduled', 'paused', 'needs_review'].includes(job.state)) continue;
      const previousState = job.state; const scheduledFor = force ? current : job.nextRunAt;
      const run = { id: randomUUID(), jobId: job.id, status: 'claimed', scheduledFor, startedAt: current,
        finishedAt: null, deliveryStatus: 'pending', sourceRunId: null, previousState };
      job.runningAt = current; job.lastError = null;
      if (previousState === 'scheduled') job.nextRunAt = nextAutomationRun(job.schedule, current);
      state.runs.push(run); if (state.runs.length > 2_000) state.runs.splice(0, state.runs.length - 2_000);
      claims.push({ job: clone(job), run: clone(run) });
      if (jobId) break;
    }
    return claims;
  }); }
  async markRunning(jobId, runId) { return this.change((state) => { const run = state.runs.find((item) => item.id === runId && item.jobId === jobId); if (!run) throw new Error('automation run not found'); run.status = 'running'; return run; }); }
  async complete({ jobId, runId, status, sourceRunId = null, deliveryStatus = 'not_requested', error = null } = {}) {
    return this.change((state) => { const current = this.now(); const job = state.jobs.find((item) => item.id === jobId); const run = state.runs.find((item) => item.id === runId && item.jobId === jobId);
      if (!job || !run) throw new Error('automation run not found'); run.status = status; run.finishedAt = current; run.sourceRunId = sourceRunId; run.deliveryStatus = deliveryStatus;
      if (error) { run.userSafeSummary = String(error).slice(0, 500); run.nextSafeAction = '자동화 설정에서 상태를 확인하고 다시 실행할 수 있어요.'; }
      job.runningAt = null; job.lastRunAt = current; job.lastStatus = status; job.lastError = error ? String(error).slice(0, 500) : null;
      if (run.previousState === 'paused') job.state = 'paused';
      else if (job.state === 'cancelled') { /* cancellation during a run wins */ }
      else if (job.schedule.kind === 'at') job.state = status === 'succeeded' ? 'expired' : 'needs_review';
      else { job.state = 'scheduled'; if (!job.nextRunAt || job.nextRunAt <= current) job.nextRunAt = nextAutomationRun(job.schedule, current); }
      job.updatedAt = current; return { job, run };
    });
  }
}
