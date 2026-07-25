// L4 · 개인 도구 저장소(2.0-C-1) — 파일 기반. 등록된 PersonalTool 목록 지속. 의존성 0.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function defaultPersonalDir() {
  return process.env.GPAO_T5_DATA_DIR ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions');
}

export class PersonalToolsStore {
  constructor(dir = defaultPersonalDir()) {
    this.dir = dir;
    this.file = join(dir, 'personal-tools.json');
  }

  async load() {
    try {
      const a = JSON.parse(await readFile(this.file, 'utf8'));
      return { tools: a.tools ?? [] };
    } catch {
      return { tools: [] };
    }
  }

  async save(a) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file, JSON.stringify({ tools: a.tools ?? [] }), 'utf8');
    return a;
  }
}
