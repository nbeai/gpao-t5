// L4 · Skill 저장소(P6-17 Slice-2) — 파일 기반. {skills}. 의존성 0.
// skills: SkillCandidate lifecycle 상태를 지속(detected→…→admitted/rejected). 영향은 admitted만(코드가 게이트).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  AUTOMATION_SCHEMA_VERSION,
  migrateSkillsStateV1,
  validateSkillDefinition,
} from '../kernel/l5-growth/automation-contracts.js';
import {
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

  async load() {
    try {
      const a = JSON.parse(await readFile(this.file, 'utf8'));
      return { skills: a.skills ?? [] };
    } catch {
      return { skills: [] };
    }
  }

  async save(a) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file, JSON.stringify({ skills: a.skills ?? [] }), 'utf8');
    return a;
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
