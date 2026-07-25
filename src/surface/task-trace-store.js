// L4 · Learning 저장소(P6-11) — 파일 기반. {traces, proposed, promoted}. 의존성 0.
// traces: 넓게 관찰한 작업 기록. proposed: 승격 대기 후보. promoted: 승인·replay 통과해 영향 가능한 것.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function defaultLearningDir() {
  return process.env.GPAO_T5_DATA_DIR ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions');
}

export class TaskTraceStore {
  constructor(dir = defaultLearningDir()) {
    this.dir = dir;
    this.file = join(dir, 'learning.json');
  }

  async load() {
    try {
      const a = JSON.parse(await readFile(this.file, 'utf8'));
      return { traces: a.traces ?? [], proposed: a.proposed ?? [], promoted: a.promoted ?? [] };
    } catch {
      return { traces: [], proposed: [], promoted: [] };
    }
  }

  async save(a) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file, JSON.stringify({ traces: a.traces ?? [], proposed: a.proposed ?? [], promoted: a.promoted ?? [] }), 'utf8');
    return a;
  }
}
