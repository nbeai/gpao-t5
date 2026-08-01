// L4 · Skill 저장소(P6-17 Slice-2) — 파일 기반. {skills}. 의존성 0.
// skills: SkillCandidate lifecycle 상태를 지속(detected→…→admitted/rejected). 영향은 admitted만(코드가 게이트).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  AUTOMATION_SCHEMA_VERSION,
  mergeSkillDefinitionV1,
  migrateSkillsStateV1,
  projectSkillDefinitionV1,
  validateSkillDefinition,
} from '../kernel/l5-growth/automation-contracts.js';
import {
  serializeByFile,
  atomicWritePrivate,
  assertStateRecords,
  loadVersionedJson,
} from './versioned-json-store.js';

export function defaultSkillDir() {
  return process.env.GPAO_T5_DATA_DIR ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions');
}

export class SkillStore {
  constructor(dir = defaultSkillDir()) {
    this.dir = dir;
    this.file = join(dir, 'skills.json');
  }

  /** 지금 디스크의 v2 레코드(id → record). 없으면 빈 지도. */
  async #현재레코드() {
    try {
      const a = JSON.parse(await readFile(this.file, 'utf8'));
      if (a?.schemaVersion !== AUTOMATION_SCHEMA_VERSION) return new Map();
      return new Map((a.skills ?? []).filter((s) => s?.id).map((s) => [s.id, s]));
    } catch { return new Map(); }
  }

  async load() {
    try {
      const a = JSON.parse(await readFile(this.file, 'utf8'));
      if (a.schemaVersion === AUTOMATION_SCHEMA_VERSION) {
        return {
          schemaVersion: AUTOMATION_SCHEMA_VERSION,
          compatibility: 'v1',
          skills: (a.skills ?? []).map(projectSkillDefinitionV1),
        };
      }
      return { skills: a.skills ?? [] };
    } catch {
      return { skills: [] };
    }
  }

  async save(a) {
    if (a.schemaVersion === AUTOMATION_SCHEMA_VERSION) {
      // 읽기-병합-쓰기를 한 파일 단위로 직렬화한다 — 병합만으로는 두 저장이 각자 현재를 읽고
      // 각자 써서 나중 것이 앞 것을 지운다(오너 지적 2026-08-02).
      return serializeByFile(this.file, () => this.#병합저장(a));
    }
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file, JSON.stringify({ skills: a.skills ?? [] }), 'utf8');
    return a;
  }

  async #병합저장(a) {
    {
      // **오래된 뷰가 최신 갱신을 덮지 않는다**(Codex 감사 2026-08-02). v1 은 로드 시점
      // 스냅샷을 들고 다니므로, 저장은 그 스냅샷이 아니라 **지금 디스크의 레코드** 위에
      // v1 소유 칸만 얹는다. 그리고 뷰에 없는 레코드는 지우지 않는다 — 그 사이 다른 저장선이
      // 만든 것일 수 있고, 현재 호출 지점에 삭제는 하나도 없다(server.js 19자리 전수 확인).
      const now = Date.now();
      const 현재 = await this.#현재레코드();
      const 병합 = (a.skills ?? []).map((skill) => mergeSkillDefinitionV1(skill, now, 현재.get(skill?.id) ?? null));
      const 본뷰 = new Set(병합.map((s) => s.id));
      const 남은것 = [...현재.entries()].filter(([id]) => !본뷰.has(id)).map(([, rec]) => rec);
      await atomicWritePrivate(this.file, {
        schemaVersion: AUTOMATION_SCHEMA_VERSION,
        skills: [...병합, ...남은것],
      });
      return a;
    }
  }
}

// AC-1 v2 저장선. 기존 SkillStore는 P-OP-7 런타임 호환을 위해 그대로 두고,
// AC-2 전환 시 이 클래스로 한 번에 바꾼다.
export class SkillDefinitionStore {
  constructor(dir = defaultSkillDir()) {
    this.dir = dir;
    this.file = join(dir, 'skills.json');
  }

  async load() {
    const fallback = { schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [] };
    const loaded = await loadVersionedJson(
      this.file,
      fallback,
      (raw) => migrateSkillsStateV1(raw),
      (state) => {
        if (state.schemaVersion !== AUTOMATION_SCHEMA_VERSION) throw new Error('skills state schemaVersion must be 2');
        assertStateRecords(state.skills, validateSkillDefinition, 'skill definition');
      },
    );
    return { ...loaded.state, ...(loaded.recovery ? { recovery: loaded.recovery } : {}) };
  }

  async save(state) {
    if (state.schemaVersion !== AUTOMATION_SCHEMA_VERSION) throw new Error('skills state schemaVersion must be 2');
    assertStateRecords(state.skills, validateSkillDefinition, 'skill definition');
    await atomicWritePrivate(this.file, {
      schemaVersion: AUTOMATION_SCHEMA_VERSION,
      skills: state.skills ?? [],
    });
    return state;
  }
}
