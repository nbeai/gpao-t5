import { chmod, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AUTOMATION_SCHEMA_VERSION,
  transitionState,
  validateAgentRun,
} from '../kernel/l5-growth/automation-contracts.js';
import { atomicWritePrivate } from './versioned-json-store.js';
import { defaultAutomationDir } from './automation-store.js';

const queues = new Map();

function serialize(key, task) {
  const previous = queues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  queues.set(key, current);
  return current.finally(() => {
    if (queues.get(key) === current) queues.delete(key);
  });
}

function parseLines(raw) {
  if (!raw.trim()) return [];
  return raw.trimEnd().split('\n').map((line) => JSON.parse(line));
}

async function quarantine(file, raw) {
  const quarantinedFile = `${file}.corrupt-${randomUUID()}`;
  await rename(file, quarantinedFile);
  await chmod(quarantinedFile, 0o600);
  return {
    corrupted: true,
    quarantinedFile,
    corruptBytes: Buffer.byteLength(raw),
  };
}

function eventFor(run, previous, at) {
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    eventId: randomUUID(),
    runId: run.id,
    idempotencyKey: run.idempotencyKey,
    type: previous ? 'transition' : 'queued',
    from: previous?.status ?? null,
    to: run.status,
    at,
    snapshot: run,
  };
}

function currentRuns(events) {
  const byId = new Map();
  for (const event of events) byId.set(event.runId, event.snapshot);
  return [...byId.values()];
}

export class AutomationRunLedger {
  constructor(dir = defaultAutomationDir()) {
    this.dir = dir;
    this.file = join(dir, 'automation-runs.jsonl');
    this.stateFile = join(dir, 'automation-run-state.json');
  }

  async readEvents() {
    let raw;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return { events: [] };
      throw error;
    }
    try {
      const events = parseLines(raw);
      const previousById = new Map();
      const occurrenceOwner = new Map();
      for (const event of events) {
        if (event?.schemaVersion !== AUTOMATION_SCHEMA_VERSION
          || !event.eventId || !event.runId || !event.idempotencyKey
          || !['queued', 'transition'].includes(event.type)) {
          throw new Error('invalid run event');
        }
        const checked = validateAgentRun(event.snapshot);
        if (!checked.ok) throw new Error(checked.errors.join('; '));
        if (event.to !== event.snapshot.status) throw new Error('run event status disagrees with snapshot');
        const occurrence = occurrenceOwner.get(event.idempotencyKey);
        if (occurrence && occurrence !== event.runId) throw new Error('run occurrence has multiple owners');
        occurrenceOwner.set(event.idempotencyKey, event.runId);
        const previous = previousById.get(event.runId);
        if (!previous) {
          if (event.type !== 'queued' || event.from !== null || event.to !== 'queued') {
            throw new Error('run event does not start queued');
          }
        } else {
          if (event.type !== 'transition' || event.from !== previous.status) {
            throw new Error('run event transition is discontinuous');
          }
          const moved = transitionState(
            'agentRun',
            previous,
            event.snapshot.status,
            event.at,
            event.snapshot,
          );
          if (!moved.ok) throw new Error('run event transition is invalid');
        }
        previousById.set(event.runId, event.snapshot);
      }
      return { events };
    } catch {
      return { events: [], recovery: await quarantine(this.file, raw) };
    }
  }

  async load() {
    const loaded = await this.readEvents();
    return {
      schemaVersion: AUTOMATION_SCHEMA_VERSION,
      runs: currentRuns(loaded.events),
      events: loaded.events,
      ...(loaded.recovery ? { recovery: loaded.recovery } : {}),
    };
  }

  async append(run) {
    return serialize(this.file, async () => {
      const checked = validateAgentRun(run);
      if (!checked.ok) throw new Error(`agent run invalid: ${checked.errors.join('; ')}`);
      const current = await this.load();
      if (current.recovery) throw new Error('automation run ledger was corrupted; retry after reviewing the quarantined ledger');

      const previous = current.runs.find((entry) => entry.id === run.id);
      const occurrence = current.runs.find((entry) => entry.idempotencyKey === run.idempotencyKey);
      if (occurrence && occurrence.id !== run.id) throw new Error('agent run idempotency key already exists');

      if (previous) {
        if (previous.idempotencyKey !== run.idempotencyKey) throw new Error('agent run identity changed');
        const moved = transitionState(
          'agentRun',
          previous,
          run.status,
          run.updatedAt ?? run.heartbeatAt ?? run.finishedAt ?? run.startedAt ?? 0,
          run,
        );
        if (!moved.ok) throw new Error(`agent run transition invalid: ${moved.reason}`);
        run = moved.record;
      } else if (run.status !== 'queued') {
        throw new Error('new agent run must start queued');
      }

      const event = eventFor(run, previous, run.updatedAt ?? run.heartbeatAt ?? run.finishedAt ?? run.startedAt ?? 0);
      const events = [...current.events, event];
      const rows = events.map((entry) => JSON.stringify(entry)).join('\n');
      await atomicWritePrivate(this.file, `${rows}\n`);
      await atomicWritePrivate(this.stateFile, {
        schemaVersion: AUTOMATION_SCHEMA_VERSION,
        runs: currentRuns(events),
      });
      return run;
    });
  }
}
