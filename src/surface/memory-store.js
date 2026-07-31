// L4 · 기억 저장소 — 파일 기반, 세션 간 지속. 의존성 0.
// {candidates, promoted, observed}: 승격 후보 · 승격된 ContextAdmissionPacket · 관찰 전용(P6-17 Slice-3).
// preference/operating_principle은 kind로 섞이지 않게 한 목록 안에서 구분(계획서 §5.3).
// observed = 추정된 사용자 성향(inferred_trait) 전용 레인 — **admittedContext가 읽지 않는다(영향 0)**.
// "추정"과 "승인된 운영 선호"는 레인으로 분리한다: 추정은 observed(관찰), 승인 선호는 candidates→promoted(영향).
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash, createHmac, randomBytes } from 'node:crypto';

// P-OP-4 · **기록 도중 중단이 파일을 반 토막 내지 못하게** — tmp 에 다 쓰고 rename 한 번으로
// 바꾼다(rename 은 원자적). 임시 이름은 고유하게 — 고정 `.tmp` 는 두 프로세스가 같은 파일을
// 동시에 쓸 때 서로의 반쪽을 rename 하는 충돌이 된다(감사 지적).
async function atomicWrite(file, data) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  /**
   * 없는 파일만 새 저장소다. 파싱·권한·I/O 오류를 빈 상태로 돌려주면 "기억이 없다"와
   * "기억을 못 읽는다"가 같은 얼굴이 되고, 그 위에서 새 기억을 쓰면 기존 기억이 사라진다
   * (T-cell 계획 §4.9). 손상은 격리 사본으로 보존하고 상태로 말한다.
   */
  async load() {
    let raw;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (e) {
      if (e?.code === 'ENOENT') return { candidates: [], promoted: [], observed: [], closed: {}, observations: [], bundles: [], observationWatermark: {}, replayCases: [], replayReceipts: [], replayOutputs: {}, grownBundles: [], growJobs: [], growBudget: null };
      return { candidates: [], promoted: [], observed: [], closed: {}, corrupted: true, corruptionReason: e?.code ?? 'read_failed' };
    }
    try {
      const m = JSON.parse(raw);
      return {
        candidates: m.candidates ?? [], promoted: m.promoted ?? [],
        observed: m.observed ?? [], closed: m.closed ?? {},
        // S2 · T-cell 관찰 레인. `admittedContext` 가 읽지 않는다 — 행동 영향 0.
        observations: m.observations ?? [], bundles: m.bundles ?? [],
        observationWatermark: m.observationWatermark ?? {},
        // S4 · replay 증거 레인. 후보(candidates)는 승격 게이트가 막고, 이 레인은 그 게이트가
        // 읽는 **실행 사실**이다 — 여기 있는 것만으로는 행동에 영향이 없다.
        replayCases: m.replayCases ?? [], replayReceipts: m.replayReceipts ?? [],
        replayOutputs: m.replayOutputs ?? {}, grownBundles: m.grownBundles ?? [],
        // 성장은 여러 tick 에 걸쳐 돈다(§4.10 tick당 ≤2) — 진행 상태와 예산이 저장에 산다.
        growJobs: m.growJobs ?? [], growBudget: m.growBudget ?? null,
      };
    } catch (e) {
      const quarantine = `${this.file}.corrupt-${Date.now()}`;
      try {
        await mkdir(this.dir, { recursive: true });
        await writeFile(quarantine, raw, 'utf8');
      } catch { /* 격리 실패도 상태로만 말한다 — 여기서 던지면 대화가 멈춘다 */ }
      return {
        candidates: [], promoted: [], observed: [], closed: {},
        corrupted: true, corruptionReason: 'parse_failed', corruptionQuarantine: quarantine,
      };
    }
  }

  async save(memory) {
    // 손상을 읽은 상태 위에 쓰면 기존 기억이 그 순간 사라진다. 복구 전에는 쓰지 않는다(§4.9).
    if (memory?.corrupted) throw new Error('기억 저장소가 손상 상태다 — 복구 전에는 쓰지 않는다');
    await mkdir(this.dir, { recursive: true });
    // observed(추정 성향)를 함께 지속하되, 이 레인은 admittedContext가 읽지 않으므로 영향 0 유지.
    // closed: 종료 표식(tombstone) — 거절·철회의 멱등 판정을 **상태 안에서** 한다(P-OP-4 감사).
    // 원장으로 판정하면 "상태가 행동의 진실" 원칙과 충돌한다 — 원장은 실패할 수 있다.
    await atomicWrite(this.file, JSON.stringify({
      candidates: memory.candidates ?? [], promoted: memory.promoted ?? [],
      observed: memory.observed ?? [], closed: memory.closed ?? {},
      observations: memory.observations ?? [], bundles: memory.bundles ?? [],
      observationWatermark: memory.observationWatermark ?? {},
      replayCases: memory.replayCases ?? [], replayReceipts: memory.replayReceipts ?? [],
      replayOutputs: memory.replayOutputs ?? {}, grownBundles: memory.grownBundles ?? [],
      growJobs: memory.growJobs ?? [], growBudget: memory.growBudget ?? null,
    }));
    return memory;
  }
}

// 종료 표식 상한 — 감사용 무한 성장 금지(§18 계열). 오래된 것부터 걷는다. 원문은 담지 않는다.
const CLOSED_CAP = 50;

/** 거절·철회의 종료 표식을 상태에 남긴다(상태 저장과 같은 원자 쓰기에 실린다). */
export function markClosed(memory, candidateId, outcome) {
  const closed = { ...(memory.closed ?? {}) };
  delete closed[candidateId]; // 재기입 시 순서 갱신
  closed[candidateId] = outcome;
  const keys = Object.keys(closed);
  for (const k of keys.slice(0, Math.max(0, keys.length - CLOSED_CAP))) delete closed[k];
  memory.closed = closed;
  return memory;
}

/**
 * 기억 수명주기 영수증용 내용 지문 — 원문은 남기지 않는다(철회로 지운 기억이 원장에 되살아나지 않게).
 * key 가 있으면 HMAC — 짧고 흔한 선호 문장은 평문 sha256 절단으로도 사전 대입 추측이 가능하다
 * (설치 전 필수, 감사 관찰 2026-07-29). 키는 로컬 0600 파일에만 산다.
 */
export function memoryDigest(statement, key) {
  const h = key ? createHmac('sha256', key) : createHash('sha256');
  return h.update(String(statement ?? '')).digest('hex').slice(0, 16);
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

  /**
   * 지문 키 — 이 데이터 자리 전용 비밀(0600). 없으면 처음 한 번 만든다.
   * **손상된 키로 평문에 후퇴하지 않는다**(실측: 공백 키 파일 → trim → 빈 키 → 평문 sha256 과
   * 동일한 지문). 형식이 아니면 손상 파일을 격리 보존하고 새 키를 만든다 — 이전 지문과의
   * 연결은 키와 함께 잃지만, 그건 손상의 정직한 결과다. 격리가 실패하면 기록을 중단한다
   * (원장 손상 격리와 같은 계약 — 부르는 쪽이 receiptWritten:false 로 넘긴다).
   */
  async digestKey() {
    if (this._key) return this._key;
    const kf = join(this.dir, 'memory-ledger.key');
    let raw = null;
    try { raw = (await readFile(kf, 'utf8')).trim(); } catch { raw = null; }
    if (raw && /^[0-9a-f]{64}$/.test(raw)) { this._key = raw; return this._key; }
    if (raw !== null) {
      await rename(kf, `${kf}.corrupt-${Date.now()}`);
      console.error('[memory-ledger] 지문 키 손상 — 격리 보존 후 새 키 발급(이전 지문 연결은 끊김)');
    }
    this._key = randomBytes(32).toString('hex');
    await mkdir(this.dir, { recursive: true });
    await writeFile(kf, this._key, { encoding: 'utf8', mode: 0o600 });
    return this._key;
  }

  /** @param {'proposed'|'confirmed'|'rejected'|'rolled_back'} event */
  async append(event, entry, now = Date.now()) {
    await this.digestKey(); // 키 확보 실패는 여기서 정직하게 던진다(평문 후퇴 금지)
    const a = await this.load();
    if (a.corrupted) {
      // 손상 파일을 격리 보존 — 지우지도, 그 위에 덮어쓰지도 않는다. **격리가 실패하면 새 기록을
      // 중단한다**(감사 지적) — 조용히 계속 쓰면 "손상 바이트를 반드시 보존한다"는 계약이 깨진다.
      // 이 throw 는 부르는 쪽(기억영수증)이 receiptWritten:false 로 정직하게 넘긴다.
      await rename(this.file, `${this.file}.corrupt-${now}`);
      a.entries = [];
      delete a.corrupted;
    }
    a.entries.push({
      event,
      candidateId: entry?.candidateId ?? null,
      kind: entry?.kind ?? null,
      at: now,
      // digestKey 는 항상 유효한 키를 주거나 던진다 — 평문 후퇴 없음(이중 방어).
      digest: memoryDigest(entry?.statement, (() => { const k = this._key; if (!k) throw new Error('digest key missing'); return k; })()),
    });
    await mkdir(this.dir, { recursive: true });
    await atomicWrite(this.file, JSON.stringify(a));
    return a.entries[a.entries.length - 1];
  }
}
