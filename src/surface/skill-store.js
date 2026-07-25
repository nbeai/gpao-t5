// L4 · Skill 저장소(P6-17 Slice-2) — 파일 기반. {skills}. 의존성 0.
// skills: SkillCandidate lifecycle 상태를 지속(detected→…→admitted/rejected). 영향은 admitted만(코드가 게이트).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

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
