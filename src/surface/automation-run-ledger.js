import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AUTOMATION_SCHEMA_VERSION,
  validateAgentRun,
} from '../kernel/l5-growth/automation-contracts.js';
import { atomicWritePrivate } from './versioned-json-store.js';
import { defaultAutomationDir } from './automation-store.js';

function parseLines(raw) {
  if (!raw.trim()) return [];
  return raw.trimEnd().split('\n').map((line) => JSON.parse(line));
}

export class AutomationRunLedger {
  constructor(dir = defaultAutomationDir()) {
    this.dir = dir;
    this.file = join(dir, 'automation-runs.jsonl');
  }

  async load() {
    let raw;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return { schemaVersion: AUTOMATION_SCHEMA_VERSION, runs: [] };
      throw error;
    }
    try {
      const runs = parseLines(raw);
      for (const run of runs) {
        const checked = validateAgentRun(run);
        if (!checked.ok) throw new Error(checked.errors.join('; '));
      }
      return { schemaVersion: AUTOMATION_SCHEMA_VERSION, runs };
    } catch {
      const quarantinedFile = `${this.file}.corrupt-${randomUUID()}`;
      await rename(this.file, quarantinedFile);
      return {
        schemaVersion: AUTOMATION_SCHEMA_VERSION,
        runs: [],
        recovery: { corrupted: true, quarantinedFile, corruptBytes: Buffer.byteLength(raw) },
      };
    }
  }

  async append(run) {
    const checked = validateAgentRun(run);
    if (!checked.ok) throw new Error(`agent run invalid: ${checked.errors.join('; ')}`);
    const current = await this.load();
    if (current.recovery) throw new Error('automation run ledger was corrupted; retry after reviewing the quarantined ledger');
    if (current.runs.some((entry) => entry.id === run.id)) throw new Error('agent run id already exists');
    if (current.runs.some((entry) => entry.idempotencyKey === run.idempotencyKey)) {
      throw new Error('agent run idempotency key already exists');
    }
    const rows = [...current.runs, run].map((entry) => JSON.stringify(entry)).join('\n');
    await atomicWritePrivate(this.file, `${rows}\n`);
    return run;
  }
}
