// L4 · 기억 저장소 — 파일 기반, 세션 간 지속. 의존성 0.
// {candidates, promoted, observed}: 승격 후보 · 승격된 ContextAdmissionPacket · 관찰 전용(P6-17 Slice-3).
// preference/operating_principle은 kind로 섞이지 않게 한 목록 안에서 구분(계획서 §5.3).
// observed = 추정된 사용자 성향(inferred_trait) 전용 레인 — **admittedContext가 읽지 않는다(영향 0)**.
// "추정"과 "승인된 운영 선호"는 레인으로 분리한다: 추정은 observed(관찰), 승인 선호는 candidates→promoted(영향).
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

// P-OP-4 · **기록 도중 중단이 파일을 반 토막 내지 못하게** — tmp 에 다 쓰고 rename 한 번으로
// 바꾼다(rename 은 원자적). 채널 자격 저장소가 이미 쓰는 방식과 같다.
async function atomicWrite(file, data) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, data, 'utf8');
  await rename(tmp, file);
}

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
    await atomicWrite(this.file, JSON.stringify({ candidates: memory.candidates ?? [], promoted: memory.promoted ?? [], observed: memory.observed ?? [] }));
    return memory;
  }
}

/** 기억 수명주기 영수증용 내용 지문 — 원문은 남기지 않는다(철회로 지운 기억이 원장에 되살아나지 않게). */
export function memoryDigest(statement) {
  return createHash('sha256').update(String(statement ?? '')).digest('hex').slice(0, 16);
}

/**
 * 기억 수명주기 원장 (H 감사 보강 2026-07-29) — 후보·승격·거절·철회의 **감사 흔적**.
 * 저장소(memory.json)는 현재 상태만 들고, rollback 은 승격 항목을 제거하므로 "과거에 승인됐다가
 * 철회됐다"는 사실이 사라진다. 이 원장이 그 흔적을 남긴다: proposed / confirmed / rejected /
 * rolled_back. 내용 원문은 담지 않는다 — candidateId·종류·시각·digest 만.
 */
export class MemoryLedger {
  constructor(dir = defaultMemoryDir()) {
    this.dir = dir;
    this.file = join(dir, 'memory-ledger.json');
  }

  // 손상은 **조용히 버리지 않는다**(P-OP-4). 예전엔 파싱 실패 → 빈 원장 → 다음 append 가
  // 새 항목만 담아 덮어써서 감사 이력 전체가 소리 없이 사라졌다. 이제 읽기는 손상 사실을
  // 함께 돌려주고, append 는 손상 파일을 옆으로 보존한 뒤 새로 시작한다(바이트를 잃지 않는다).
  async load() {
    let raw;
    try { raw = await readFile(this.file, 'utf8'); } catch { return { entries: [] }; }
    try { return JSON.parse(raw); } catch { return { entries: [], corrupted: true }; }
  }

  /** @param {'proposed'|'confirmed'|'rejected'|'rolled_back'} event */
  async append(event, entry, now = Date.now()) {
    const a = await this.load();
    if (a.corrupted) {
      // 손상 파일을 격리 보존 — 지우지도, 그 위에 덮어쓰지도 않는다.
      await rename(this.file, `${this.file}.corrupt-${now}`).catch(() => {});
      a.entries = [];
      delete a.corrupted;
    }
    a.entries.push({
      event,
      candidateId: entry?.candidateId ?? null,
      kind: entry?.kind ?? null,
      at: now,
      digest: memoryDigest(entry?.statement),
    });
    await mkdir(this.dir, { recursive: true });
    await atomicWrite(this.file, JSON.stringify(a));
    return a.entries[a.entries.length - 1];
  }
}
