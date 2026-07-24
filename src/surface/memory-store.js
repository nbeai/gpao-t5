// L4 · 기억 저장소 — 파일 기반, 세션 간 지속. 의존성 0.
// {candidates, promoted}: 승격 후보와 승격된 ContextAdmissionPacket. preference/operating_principle은
// kind로 섞이지 않게 한 목록 안에서 구분(계획서 §5.3). P6-1은 단일 문서(프로필 격리는 P6 후속).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function defaultMemoryDir() {
  return process.env.GPAO_T5_DATA_DIR ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions');
}

export class MemoryStore {
  constructor(dir = defaultMemoryDir()) {
    this.dir = dir;
    this.file = join(dir, 'memory.json');
  }

  async load() {
    try {
      const m = JSON.parse(await readFile(this.file, 'utf8'));
      return { candidates: m.candidates ?? [], promoted: m.promoted ?? [] };
    } catch {
      return { candidates: [], promoted: [] };
    }
  }

  async save(memory) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file, JSON.stringify({ candidates: memory.candidates ?? [], promoted: memory.promoted ?? [] }), 'utf8');
    return memory;
  }
}
