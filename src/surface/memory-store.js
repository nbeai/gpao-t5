// L4 · 기억 저장소 — 파일 기반, 세션 간 지속. 의존성 0.
// {candidates, promoted, observed}: 승격 후보 · 승격된 ContextAdmissionPacket · 관찰 전용(P6-17 Slice-3).
// preference/operating_principle은 kind로 섞이지 않게 한 목록 안에서 구분(계획서 §5.3).
// observed = 추정된 사용자 성향(inferred_trait) 전용 레인 — **admittedContext가 읽지 않는다(영향 0)**.
// "추정"과 "승인된 운영 선호"는 레인으로 분리한다: 추정은 observed(관찰), 승인 선호는 candidates→promoted(영향).
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
      return { candidates: m.candidates ?? [], promoted: m.promoted ?? [], observed: m.observed ?? [] };
    } catch {
      return { candidates: [], promoted: [], observed: [] };
    }
  }

  async save(memory) {
    await mkdir(this.dir, { recursive: true });
    // observed(추정 성향)를 함께 지속하되, 이 레인은 admittedContext가 읽지 않으므로 영향 0 유지.
    await writeFile(this.file, JSON.stringify({ candidates: memory.candidates ?? [], promoted: memory.promoted ?? [], observed: memory.observed ?? [] }), 'utf8');
    return memory;
  }
}
