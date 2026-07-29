// L4 · 자동화 저장소 — 파일 기반. {candidates, jobs} 지속. 의존성 0.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  AUTOMATION_SCHEMA_VERSION,
  migrateAutomationStateV1,
  validateAutomationJob,
} from '../kernel/l5-growth/automation-contracts.js';
import {
  atomicWritePrivate,
  assertStateRecords,
  loadVersionedJson,
} from './versioned-json-store.js';

export function defaultAutomationDir() {
  return process.env.GPAO_T5_DATA_DIR ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions');
}

export class AutomationStore {
  constructor(dir = defaultAutomationDir()) {
    this.dir = dir;
    this.file = join(dir, 'automation.json');
  }

  async load() {
    try {
      const a = JSON.parse(await readFile(this.file, 'utf8'));
      return { candidates: a.candidates ?? [], jobs: a.jobs ?? [] };
    } catch {
      return { candidates: [], jobs: [] };
    }
  }

  async save(a) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file, JSON.stringify({ candidates: a.candidates ?? [], jobs: a.jobs ?? [] }), 'utf8');
    return a;
  }
}

// AC-1 v2 저장선. scheduler/runner는 아직 이 클래스를 소비하지 않는다.
export class AutomationJobStore {
  constructor(dir = defaultAutomationDir()) {
    this.dir = dir;
    this.file = join(dir, 'automation.json');
  }

  async load() {
    const fallback = { schemaVersion: AUTOMATION_SCHEMA_VERSION, candidates: [], jobs: [] };
    const loaded = await loadVersionedJson(
      this.file,
      fallback,
      (raw) => migrateAutomationStateV1(raw),
      (state) => {
        if (state.schemaVersion !== AUTOMATION_SCHEMA_VERSION) throw new Error('automation state schemaVersion must be 2');
        if (!Array.isArray(state.candidates)) throw new Error('automation candidates must be an array');
        assertStateRecords(state.jobs, validateAutomationJob, 'automation job');
      },
    );
    return { ...loaded.state, ...(loaded.recovery ? { recovery: loaded.recovery } : {}) };
  }

  async save(state) {
    if (state.schemaVersion !== AUTOMATION_SCHEMA_VERSION) throw new Error('automation state schemaVersion must be 2');
    if (!Array.isArray(state.candidates)) throw new Error('automation candidates must be an array');
    assertStateRecords(state.jobs, validateAutomationJob, 'automation job');
    await atomicWritePrivate(this.file, {
      schemaVersion: AUTOMATION_SCHEMA_VERSION,
      candidates: state.candidates,
      jobs: state.jobs,
    });
    return state;
  }
}
