import { chmod, readFile, rename } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AUTOMATION_SCHEMA_VERSION,
  agentRunTransitionWithin,
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

function stateProjection(events) {
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    runs: currentRuns(events),
  };
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
          if (!agentRunTransitionWithin(previous, event.snapshot)) {
            throw new Error('run event widened its immutable envelope');
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
    let snapshotProjection = { written: false, reason: 'event_ledger_corrupted' };
    if (!loaded.recovery) snapshotProjection = await this.#syncSnapshot(loaded.events);
    return {
      schemaVersion: AUTOMATION_SCHEMA_VERSION,
      runs: currentRuns(loaded.events),
      events: loaded.events,
      snapshotProjection,
      ...(loaded.recovery ? { recovery: loaded.recovery } : {}),
    };
  }

  async #syncSnapshot(events) {
    const expected = stateProjection(events);
    try {
      const actual = JSON.parse(await readFile(this.stateFile, 'utf8'));
      if (isDeepStrictEqual(actual, expected)) return { written: true, repaired: false };
    } catch {
      // Missing, malformed, stale, and unreadable projections all rebuild from events.
    }
    try {
      await atomicWritePrivate(this.stateFile, expected);
      return { written: true, repaired: true };
    } catch {
      return { written: false, repaired: false, reason: 'snapshot_projection_failed' };
    }
  }

  async append(run) {
    return serialize(this.file, async () => {
      const checked = validateAgentRun(run);
      if (!checked.ok) throw new Error(`agent run invalid: ${checked.errors.join('; ')}`);
      const loaded = await this.readEvents();
      if (loaded.recovery) throw new Error('automation run ledger was corrupted; retry after reviewing the quarantined ledger');
      const current = {
        events: loaded.events,
        runs: currentRuns(loaded.events),
      };

      const previous = current.runs.find((entry) => entry.id === run.id);
      const occurrence = current.runs.find((entry) => entry.idempotencyKey === run.idempotencyKey);
      if (occurrence && occurrence.id !== run.id) throw new Error('agent run idempotency key already exists');

      if (previous) {
        if (previous.idempotencyKey !== run.idempotencyKey) throw new Error('agent run identity changed');
        if (isDeepStrictEqual(previous, run)) {
          return {
            record: previous,
            eventWritten: true,
            snapshotWritten: (await this.#syncSnapshot(current.events)).written,
            idempotent: true,
          };
        }
        if (!agentRunTransitionWithin(previous, run)) {
          throw new Error('agent run immutable snapshots, authority, or budgets changed');
        }
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
      const projection = await this.#syncSnapshot(events);
      return {
        record: run,
        eventWritten: true,
        snapshotWritten: projection.written,
        idempotent: false,
      };
    });
  }
}
