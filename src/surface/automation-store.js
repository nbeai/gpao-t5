// L4 · 자동화 저장소 — 파일 기반. {candidates, jobs} 지속. 의존성 0.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import {
  AUTOMATION_SCHEMA_VERSION,
  mergeAutomationJobV1,
  migrateAutomationStateV1,
  projectAutomationJobV1,
  validateAutomationJob,
} from '../kernel/l5-growth/automation-contracts.js';
import {
  serializeByFile,
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
      if (a.schemaVersion === AUTOMATION_SCHEMA_VERSION) {
        return {
          schemaVersion: AUTOMATION_SCHEMA_VERSION,
          compatibility: 'v1',
          candidates: a.candidates ?? [],
          __v2Candidates: structuredClone(a.candidates ?? []),
          jobs: (a.jobs ?? []).map(projectAutomationJobV1),
        };
      }
      return { candidates: a.candidates ?? [], jobs: a.jobs ?? [] };
    } catch {
      return { candidates: [], jobs: [] };
    }
  }

  /** 지금 디스크의 v2 job(id → record). 없으면 빈 지도. */
  async #현재잡() {
    try {
      const a = JSON.parse(await readFile(this.file, 'utf8'));
      if (a?.schemaVersion !== AUTOMATION_SCHEMA_VERSION) return new Map();
      return new Map((a.jobs ?? []).filter((j) => j?.id).map((j) => [j.id, j]));
    } catch { return new Map(); }
  }

  async save(a) {
    if (a.schemaVersion === AUTOMATION_SCHEMA_VERSION) {
      // skill-store 와 같은 계약: 읽기-병합-쓰기를 파일 단위로 직렬화한다.
      return serializeByFile(this.file, () => this.#병합저장(a));
    }
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file, JSON.stringify({ candidates: a.candidates ?? [], jobs: a.jobs ?? [] }), 'utf8');
    return a;
  }

  async #병합저장(a) {
    {
      const now = Date.now();
      const hasNewLegacyJob = (a.jobs ?? []).some((job) => !job?.__v2Job);
      // skill-store 와 같은 계약: 오래된 뷰가 최신 갱신을 덮지 않는다(Codex 감사 2026-08-02).
      // v1 이 소유한 칸(state·nextRunAt·lastRunId·실행 이력)만 현재 레코드 위에 얹는다.
      const 현재 = await this.#현재잡();
      const jobs = (a.jobs ?? []).map((job) => mergeAutomationJobV1(job, now, 현재.get(job?.id) ?? null));
      const 본뷰 = new Set(jobs.map((j) => j.id));
      const 남은것 = [...현재.entries()].filter(([id]) => !본뷰.has(id)).map(([, rec]) => rec);
      const 현재파일 = await this.#현재상태();
      const candidates = 후보병합(
        현재파일.candidates ?? [],
        a.candidates ?? [],
        a.__v2Candidates,
      );
      await atomicWritePrivate(this.file, {
        schemaVersion: AUTOMATION_SCHEMA_VERSION,
        candidates,
        jobs: [...jobs, ...남은것],
      });
      if (hasNewLegacyJob) {
        const { migrateAutomationWorkspaceV1 } = await import('./automation-workspace-migration.js');
        const migrated = await migrateAutomationWorkspaceV1(this.dir, now);
        return {
          schemaVersion: AUTOMATION_SCHEMA_VERSION,
          compatibility: 'v1',
          candidates: migrated.automation.candidates,
          jobs: migrated.automation.jobs.map(projectAutomationJobV1),
        };
      }
      return a;
    }
  }

  async #현재상태() {
    try {
      const a = JSON.parse(await readFile(this.file, 'utf8'));
      return a?.schemaVersion === AUTOMATION_SCHEMA_VERSION ? a : { candidates: [], jobs: [] };
    } catch { return { candidates: [], jobs: [] }; }
  }
}

function 후보키(candidate) {
  return candidate?.candidateId ?? candidate?.id ?? null;
}

function 후보병합(current, view, snapshot) {
  // snapshot 없는 직접 호출은 기존 호환 계약대로 view 를 권위 있게 쓴다. v2 파일을 load 한
  // legacy 소비자는 snapshot 을 갖고 오므로, 그 사이 canonical 소비자가 만든 후보를 보존하고
  // legacy 가 실제로 추가·변경한 후보만 얹는다.
  if (!Array.isArray(snapshot)) return view;
  const before = new Map(snapshot.map((c) => [후보키(c), c]).filter(([id]) => id));
  const merged = new Map(current.map((c) => [후보키(c), c]).filter(([id]) => id));
  for (const candidate of view) {
    const id = 후보키(candidate);
    if (!id) continue;
    const old = before.get(id);
    if (!old || !isDeepStrictEqual(candidate, old)) merged.set(id, candidate);
  }
  return [...merged.values()];
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
    return serializeByFile(this.file, () => this.#write(state));
  }

  async update(mutator) {
    return serializeByFile(this.file, async () => {
      const current = await this.load();
      const changed = await mutator(current) ?? current;
      return this.#write(changed);
    });
  }

  async #write(state) {
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
