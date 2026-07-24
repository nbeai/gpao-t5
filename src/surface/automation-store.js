// L4 · 자동화 저장소 — 파일 기반. {candidates, jobs} 지속. 의존성 0.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

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
