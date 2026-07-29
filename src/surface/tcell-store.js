// L4 · T-cell 관찰 저장소 + shadow 관찰자 (TG-1 보강, 명세 §6·§16 + 감사 2026-07-29)
// **관찰은 영향이 아니다.** growth/observations.jsonl 에 append-only. 커널은 읽지 않는다.
//
// 감사 보강 3묶음이 이 파일의 규칙이다:
// ① 사실의 신분 — receipt 참조는 fixture 가짜 id 가 아니라 **세션+원장 위치**(ledger:세션:번호)다.
//    승인/거절은 "입력에 approve 가 있었다"가 아니라 **실제 유효한 결정만** 관찰한다(서버가 판정).
// ② 지속 중복 방지 — 완료 키는 append 성공 **뒤에만** 등록한다(실패 후 재시도가 duplicate 로
//    막혀 영구 소실되던 결함). 재시작 시 기존 로그에서 완료 키를 복원한다(로그가 곧 인덱스 —
//    상한 없는 Set 이지만 관찰 수에 비례할 뿐이고, 키를 버리면 중복이 돌아온다). 쓰기는 직렬화.
// ③ privacy — 비밀 표식이 있으면 저장 **전에** 일반화 문장으로 교체하고 파생 관찰까지 비가독.
//    파일은 0600. 읽기는 schema 검증을 통과한 것만, 기본 조회는 scope(sessionId) 필수.
import { appendFile, mkdir, readFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import {
  makeObservationEvent, observationFromApproval, observationFromReceipt,
  observationFromRecovery, observationFromCorrection, validateObservationEvent,
} from '../kernel/l0-evidence/tcell-observation.js';

const 비밀일반화 = '비밀이 포함된 실행 사실(원문 비저장)';

/**
 * 저장 직전 비밀 모양 선별 — **판단이 아니라 보관 안전망**이다(감사 2026-07-29).
 * 사용자 발화에 자격 문자열이 섞여 들어오면 관찰 파일에 남을 수 있었다. 여기서 걸러
 * containsSecret 로 표시하면 요약이 일반화되고 모델 가독도 자동으로 닫힌다.
 * 목록으로 의미를 판정하지 않는다 — 길고 무작위한 자격 모양만 본다.
 */
export function looksLikeSecret(text) {
  const t = String(text ?? '');
  if (/\b(sk-|ghp_|gho_|xox[baprs]-|AKIA|ya29\.|Bearer\s+[\w-]{16,})/i.test(t)) return true;
  // 20자 이상의 고엔트로피 토큰(영숫자+기호 혼합) — 사람 문장에는 잘 없다.
  return /[A-Za-z0-9_\-]{28,}/.test(t) && /[0-9]/.test(t) && /[A-Za-z]/.test(t);
}

export class TCellObserver {
  constructor(dir) {
    this.dir = join(dir, 'growth');
    this.file = join(this.dir, 'observations.jsonl');
    this.done = new Set();      // append 성공한 키만
    this.inFlight = new Set();  // 직렬 큐에 들어간 키(성공 전) — 실패하면 제거되어 재시도 가능
    this.queue = Promise.resolve();
    this.restored = false;
    this.lastError = null;
  }

  /** 재시작 복원: 기존 로그의 참조 키를 완료로 채운다 — 로그가 곧 지속 인덱스다. */
  async #restore() {
    if (this.restored) return;
    this.restored = true;
    try {
      const raw = await readFile(this.file, 'utf8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          if (ev?.receiptRefs?.length) this.done.add(`r:${ev.receiptRefs.join(',')}`);
        } catch { /* 손상 줄은 load 가 센다 */ }
      }
      await chmod(this.file, 0o600).catch(() => {}); // 기존 파일도 0600 으로
    } catch { /* 파일 없음 = 첫 실행 */ }
  }

  /** 관찰 1건 — 절대 던지지 않는다. 완료 처리는 append 성공 뒤에만. 쓰기는 직렬화. */
  async record(event) {
    const run = this.queue.then(async () => {
      try {
        await this.#restore();
        const v = validateObservationEvent(event);
        if (!v.ok) { this.lastError = v.errors.join(' · '); return { recorded: false, why: 'invalid' }; }
        const key = event.receiptRefs?.length ? `r:${event.receiptRefs.join(',')}` : `id:${event.id}`;
        if (this.done.has(key) || this.inFlight.has(key)) return { recorded: false, why: 'duplicate' };
        this.inFlight.add(key);
        try {
          await mkdir(this.dir, { recursive: true });
          await appendFile(this.file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
          this.done.add(key); // **성공 뒤에만** — 실패했으면 재시도가 다시 쓸 수 있어야 한다
          return { recorded: true };
        } finally {
          this.inFlight.delete(key);
        }
      } catch (e) {
        this.lastError = e?.message ?? String(e);
        return { recorded: false, why: 'io' };
      }
    });
    this.queue = run.then(() => {}, () => {});
    return run;
  }

  /**
   * 턴 완료 후 투영 — **안정적 신분으로만.** receipt 참조는 원장 위치(ledger:세션:번호),
   * 승인/거절은 서버가 유효성을 판정해 넘긴 결정만(옛 승인 ID 는 여기 오지 않는다).
   */
  async observeTurn({ sessionId, ledgerStart = 0, turnReceipts = [], approvalDecision = null, turnId = null, anchor = null, now = 0 } = {}) {
    try {
      const jobs = [];
      // anchor 를 실제로 남긴다 — 이게 비어 있으면 세포의 범위 판정이 영원히 무의미하다.
      const base = { sessionId, now, anchor: anchor ?? undefined, sourceRefs: sessionId ? [`session:${sessionId}`] : [] };
      turnReceipts.forEach((rec, i) => {
        // 명세 §5.1 생성자를 **단일 통로로** 쓴다 — 여기서 다시 조립하면 계약이 두 곳에 생긴다.
        const ctx = { ...base, turnId, ref: `ledger:${sessionId}:${ledgerStart + i}`, secretSummary: 비밀일반화 };
        jobs.push(this.record(observationFromReceipt(rec, ctx)));
        if (rec?.failureState && rec.failureState !== 'none') {
          jobs.push(this.record(observationFromRecovery(rec, ctx))); // 파생도 비밀 표식·비가독 상속
        }
      });
      if (approvalDecision?.pendingId) {
        jobs.push(this.record({ ...observationFromApproval(approvalDecision, {
          ...base, sourceRefs: [...base.sourceRefs, `approval:${sessionId}:${approvalDecision.pendingId}`],
        }), turnId }));
      }
      const done = await Promise.all(jobs);
      return { recorded: done.filter((d) => d.recorded).length };
    } catch (e) {
      this.lastError = e?.message ?? String(e);
      return { recorded: 0 };
    }
  }

  /**
   * 명시 지시 관찰 — **일반 발화 원문은 저장하지 않는다**(감사 2026-07-29 P1).
   * 예전엔 모든 사용자 원문이 최대 300자까지 모델 가독으로 남아 "원문·비밀 비저장" 계약을 깼다.
   * 이제 **구조화된 운영 원리 문장만** 들어온다(부르는 쪽이 레인을 판정한다). 그마저도
   * 비밀 모양이면 일반화 문장으로 바뀌고 모델 가독이 닫힌다.
   * 지시 근거는 자기 참조(`request:세션:턴`)를 갖는다 — 추측으로 옛 정정을 집지 않는다.
   * @param {{sessionId:string, statement:string, turnIndex?:number, anchor?:object, now?:number}} p
   */
  async observeUserRequest({ sessionId, statement, turnIndex = 0, anchor = null, now = 0 } = {}) {
    const ref = `request:${sessionId}:${turnIndex}`;
    const secret = looksLikeSecret(statement);
    const r = await this.record(makeObservationEvent({
      // 턴 신분을 함께 남긴다 — TG-4 가 "서로 다른 turn 근거"를 영수증 수가 아니라 이걸로 센다.
      type: 'user_request', sessionId, turnId: String(turnIndex), occurredAt: now,
      anchor: anchor ?? undefined,   // 행렬 6 — 이 지시가 어느 자리의 것인지

      signal: { summary: secret ? '비밀이 섞인 지시(원문 비저장)' : (statement ?? ''), valence: 'neutral' },
      sourceRefs: sessionId ? [`session:${sessionId}`] : [], receiptRefs: [ref],
      privacy: { containsSecret: secret },
    }));
    return { ...r, ref, secret };
  }

  /** 사용자 정정(구조화 신호: 되돌리기·철회 행동) — 발화 원문이 아니라 행동 사실과 참조만. */
  async observeCorrection({ sessionId = null, what, ref, anchor = null, now = 0 } = {}) {
    return this.record(observationFromCorrection(what ?? '사용자가 이전 반영을 되돌렸어요', {
      sessionId, now, ref, anchor: anchor ?? undefined,   // 행렬 6
      sourceRefs: sessionId ? [`session:${sessionId}`] : [],
    }));
  }

  /** 자동화 결과 — 엔진 결과 경계에서 job+실행 번호로 투영한다. */
  async observeAutomationResult({ jobId, executionIndex = 0, receipt, anchor = null, now = 0 } = {}) {
    const secret = receipt?.containsSecret === true;
    return this.record(makeObservationEvent({
      type: 'automation_result', occurredAt: now,
      anchor: anchor ?? undefined,   // 행렬 6 — 자동화도 어느 작업 공간의 것인지 남긴다

      signal: { summary: secret ? 비밀일반화 : (receipt?.userSafeSummary ?? '자동화 실행'), valence: receipt?.failureState && receipt.failureState !== 'none' ? 'failure' : 'success' },
      sourceRefs: [`automation:${jobId}`], receiptRefs: [`automation:${jobId}:exec:${executionIndex}`],
      privacy: { containsSecret: secret },
    }));
  }

  /**
   * 기본 조회 — **scope 필수**(범위 횡단 기본 차단, 명세 §6). schema 검증 통과분만.
   * 읽기 오류는 빈 저장소로 위장하지 않는다(error 로 정직하게).
   */
  async load(scope) {
    if (!scope?.sessionId) return { events: [], corrupted: 0, error: 'scope(sessionId) 없이는 조회할 수 없어요' };
    const all = await this.#readAll();
    if (all.error) return all;
    return { ...all, events: all.events.filter((e) => e.sessionId === scope.sessionId) };
  }

  /**
   * **참조로 조회한다** — 이미 가진 참조만 확인하므로 범위 횡단 열람이 아니다(TG-5A 감사).
   * 장기 원리의 근거는 다른 세션에 있어서, 세션 훑기로는 영영 찾지 못한다.
   * @param {string[]} refs
   * @returns {Promise<{found:Record<string,object>, error?:string}>}
   */
  async getByRefs(refs = []) {
    const want = new Set((Array.isArray(refs) ? refs : []).filter((r) => typeof r === 'string' && r));
    if (!want.size) return { found: {} };
    const all = await this.#readAll();
    if (all.error) return { found: {}, error: all.error };
    const found = {};
    for (const e of all.events) {
      for (const r of e.receiptRefs ?? []) if (want.has(r)) found[r] = e;
    }
    return { found };
  }

  /** 감사 전용 전체 읽기 — 일반 경로가 아니다. */
  async loadAllForAudit() {
    return this.#readAll();
  }

  async #readAll() {
    let raw;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (e) {
      if (e?.code === 'ENOENT') return { events: [], corrupted: 0 };
      return { events: [], corrupted: 0, error: e?.message ?? String(e) };
    }
    const events = [];
    let corrupted = 0;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (validateObservationEvent(ev).ok) events.push(ev);
        else corrupted += 1; // JSON 문법이 맞아도 schema 가 틀리면 정상 이벤트가 아니다 — 격리
      } catch { corrupted += 1; }
    }
    return { events, corrupted };
  }
}

// ── TG-2 · TCell Registry + legacy adapter (명세 §6·§16 TG-2) ──────────────
// growth/tcells.json 이 원리 세포의 현재 상태 문서다(원자 교체·미래 필드 보존·손상 격리).
// **여기 있는 어떤 것도 아직 TaskContext 에 들어가지 않는다** — TG-5 전까지 영향 0.
import { writeFile, rename, stat } from 'node:fs/promises';
import { validateTCell, makeTCellCandidate } from '../kernel/l5-growth/tcell-core.js';

export class TCellRegistry {
  constructor(dir) {
    this.dir = join(dir, 'growth');
    this.file = join(this.dir, 'tcells.json');
    this.queue = Promise.resolve(); // 저장 변경 직렬화(감사: 동시 저장 20건 중 1건만 남음)
    // 서버 수명 캐시 — 아래 `load()` 참조. 변경(#mutate)은 자기 캐시를 직접 비운다.
    this.cache = null;
  }

  /**
   * 손상은 빈 저장소로 위장하지 않는다. 읽을 때도 모든 세포를 검증해 격리 투영한다.
   *
   * **읽기 캐시**(명세 §19 성능 예산 · 실측 2026-07-29): admission 이 매 턴 이 함수를 부른다.
   * 세포가 0건인 세션에서도 파일을 열고 파싱하고 전수 검증하던 비용이 게이트 CPU 로 실측됐다
   * (내 몫 +4.7s). 캐시 키는 **파일의 mtime+크기**다 — 우리 프로세스의 변경은 `#mutate` 가
   * 직접 무효화하고, 밖에서 바뀐 파일은 키가 달라져 자동으로 다시 읽힌다.
   * **정확성을 캐시로 바꾸지 않는다**: 파일이 조금이라도 달라지면 캐시는 쓰이지 않는다.
   */
  async load() {
    let st = null;
    try { st = await stat(this.file); }
    catch (e) {
      if (e?.code === 'ENOENT') return { cells: [] };   // 아직 아무 원리도 없다(오류가 아니다)
      return { cells: [], error: e?.message ?? String(e) };
    }
    const key = `${st.mtimeMs}:${st.size}`;
    // 캐시는 **복사해서** 준다 — 호출자가 목록을 만지더라도 다음 호출의 진실이 오염되지 않는다.
    if (this.cache?.key === key) return { ...this.cache.value, cells: [...this.cache.value.cells] };
    let raw;
    try { raw = await readFile(this.file, 'utf8'); }
    catch (e) {
      if (e?.code === 'ENOENT') return { cells: [] };   // stat 과 read 사이에 지워졌다
      return { cells: [], error: e?.message ?? String(e) };
    }
    let a;
    try { a = JSON.parse(raw); } catch { return { cells: [], corrupted: true }; }
    // 문법만 맞고 **구조가 깨진** 저장소(cells 가 배열이 아님)도 같은 격리 경계다 — 빈 저장소가 아니다.
    if (!a || typeof a !== 'object' || Array.isArray(a) || !Array.isArray(a.cells)) {
      return { cells: [], corrupted: true };
    }
    const cells = a.cells.map((c) => {
      const v = validateTCell(c);
      return v.ok ? c : v.cell; // 잘못된 항목은 quarantined 투영(영향 0) — 원본 바이트는 저장소에 그대로
    });
    const out = { ...a, cells };
    // 손상 판정(`corrupted`)은 캐시하지 않는다 — 격리·복구가 파일을 바꾸면 다음 읽기가 진실이어야 한다.
    this.cache = { key, value: out };
    return { ...out, cells: [...cells] };
  }

  /** 변경은 한 줄로 직렬화된다. 손상 저장소는 옆으로 격리 보존 후 새로 시작(덮어쓰기 금지). */
  async #mutate(fn) {
    const run = this.queue.then(async () => {
      // **읽기 실패를 '파일 없음'으로 취급하지 않는다**(감사 재현: 읽을 수 없는 저장소를
      // 새 상태로 덮어썼다). 신규 저장소는 ENOENT 뿐이고, 그 밖의 오류는 변경 자체를 중단한다.
      let raw = null;
      try { raw = await readFile(this.file, 'utf8'); }
      catch (e) {
        if (e?.code !== 'ENOENT') throw new Error(`저장소를 읽지 못해 변경을 중단했어요: ${e?.message ?? e}`);
        raw = null;
      }
      let a = { cells: [] };
      if (raw !== null) {
        try {
          const parsed = JSON.parse(raw);
          // 구조 손상도 문법 손상과 같이 격리 보존한다(덮어쓰기 금지).
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.cells)) {
            throw new Error('구조 손상');
          }
          a = parsed;
        }
        catch {
          await mkdir(this.dir, { recursive: true });
          await rename(this.file, `${this.file}.corrupt-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
          a = { cells: [] };
        }
      }
      const out = await fn(a);
      await mkdir(this.dir, { recursive: true });
      const tmp = `${this.file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
      await writeFile(tmp, JSON.stringify(a), { encoding: 'utf8', mode: 0o600 });
      await rename(tmp, this.file);
      // 우리가 쓴 변경은 **우리가 직접** 캐시를 버린다. mtime 해상도에 기대지 않는다 —
      // 같은 밀리초 안의 연속 변경이 옛 목록을 되살리면 안 된다.
      this.cache = null;
      return out;
    });
    this.queue = run.then(() => {}, () => {});
    return run;
  }

  async save(a) { return this.#mutate(async (cur) => { Object.assign(cur, a, { cells: a.cells ?? [] }); return a; }); }

  /** 등록은 검증을 지나서만 — 기존 항목의 미래 필드는 병합으로 보존한다. */
  async upsert(cell, evidenceStore = null, opts = {}) {
    const v = validateTCell(cell, evidenceStore, opts);
    await this.#mutate(async (a) => {
      const idx = a.cells.findIndex((c) => c.id === v.cell.id);
      if (idx >= 0) a.cells[idx] = { ...a.cells[idx], ...v.cell }; // 알 수 없는 기존 필드 보존
      else a.cells.push(v.cell);
    });
    return v;
  }

  /** rollback: 실제 이전 버전을 스냅샷으로 보존한다 — previousVersionId 는 그 스냅샷을 가리킨다. */
  async rollback(cellId) {
    return this.#mutate(async (a) => {
      const cell = a.cells.find((c) => c.id === cellId);
      if (!cell) return { ok: false, why: 'not_found' };
      const 판 = (cell.versions?.length ?? 0) + 1;
      const snapshot = { ...structuredClone(cell), id: `${cellId}@v${판}`, versions: undefined };
      cell.versions = [...(cell.versions ?? []), snapshot];
      cell.growth = { ...(cell.growth ?? {}), previousVersionId: snapshot.id, lastAuditAt: null };
      cell.state = 'rolled_back';
      cell.authority = { ...(cell.authority ?? {}), allowedInfluence: ['none'], mustNotOverrideCurrentRequest: true };
      return { ok: true, cell };
    });
  }
}

/**
 * legacy adapter (감사 이관표 그대로) — **일반 선호(preference)는 T-cell 로 바꾸지 않는다**
 * (기존 저장소가 계속 담당). replay(재검토)를 거쳐 승격된 **운영 원리만** M2_replayed 로
 * 읽기 전용 투영한다. 원래 기억의 저장 위치를 trace(rawSourceRefs)에 보존한다.
 */
export function importLegacyMemory(memory, { storePath = 'memory.json' } = {}) {
  const cells = [];
  for (const m of memory?.promoted ?? []) {
    if (!m?.statement) continue;
    if (m.kind !== 'operating_principle') continue; // 선호는 이관하지 않는다
    const key = m.id ?? m.candidateId ?? String(cells.length);
    const cell = makeTCellCandidate({
      id: `legacy-mem-${key}`,
      principle: { statement: m.statement, type: 'workflow', hypothesisConfidence: 0 },
      boundary: {
        validWhen: ['기존 기억이 승인된 범위 그대로'],
        invalidWhen: ['사용자가 철회했거나 현재 지시와 충돌할 때'],
        needsReviewWhen: ['T-cell replay 재검증 전'], mustNotOverride: ['현재 요청'],
      },
      trace: {
        observationRefs: [`memory:promoted:${key}`],
        rawSourceRefs: [`store:${storePath}#promoted:${key}`], // 원 저장 위치 하강 경로
        corrections: [],
      },
      replay: { status: 'passed_basic', caseRefs: [], lastRunAt: null }, // 승격 시 재검토(replay) 통과 사실
    });
    cell.state = 'M2_replayed'; // 검토된 운영 원리 — M1 강등도 M4 과장도 아니다(이관표)
    cells.push(cell);
  }
  return cells;
}

/**
 * 원리 확인 원장 (TG-5A) — 사용자가 원리를 확인한 사실이 사는 곳.
 * TG-4 계약과 같은 모양: `kind·tcellId·at·sourceRefs·confirmed`.
 * **읽기는 지금 배선된다.** 쓰기(확인 UI)는 TG-5C 이므로 현재 기록 수는 0일 수 있다 —
 * 그건 빈 stub 이 아니라 "아직 아무도 확인하지 않았다"는 정직한 사실이다.
 */
export class ConfirmationStore {
  constructor(dir) {
    this.dir = join(dir, 'growth');
    this.file = join(this.dir, 'confirmations.jsonl');
    this.cache = null;
  }

  async #all() {
    if (this.cache) return this.cache;
    const map = new Map();
    try {
      const raw = await readFile(this.file, 'utf8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try { const r = JSON.parse(line); if (r?.id) map.set(r.id, r); } catch { /* 손상 줄은 건너뛴다 */ }
      }
    } catch { /* 파일 없음 = 아직 확인이 없다 */ }
    this.cache = map;
    return map;
  }

  /** 동기 조회기로 굳힌다 — admission 은 순수·동기 함수다. */
  async snapshot() {
    const m = await this.#all();
    return Object.freeze({ get: (k) => m.get(k) ?? null });
  }

  /** 확인 1건 기록 — TG-5C 표면이 부른다. 계약 필드를 여기서 강제한다. */
  async record({ id, tcellId, sourceRefs = [], now = 0 } = {}) {
    if (!id || !tcellId || !sourceRefs.length) return { recorded: false };
    await mkdir(this.dir, { recursive: true });
    const rec = { kind: 'user_confirmation', id, tcellId, at: now, sourceRefs: [...sourceRefs], confirmed: true };
    await appendFile(this.file, `${JSON.stringify(rec)}\n`, { encoding: 'utf8', mode: 0o600 });
    this.cache = null;
    return { recorded: true, rec };
  }
}

/**
 * **부여된 권한 원장** (TG-5A · 종료 행렬 4) — 실제로 **소비된** 승인만 산다.
 *
 * 감사 재현: 예전 어댑터는 `session.pendingApprovals` 를 읽었다. 그건 **아직 누르지 않은 카드**다.
 * 대기 목록에 있다는 사실이 권한이 되면 매듭 하나가 통째로 깨진다 — `승인 전 계획 ≠ 실제 실행`.
 * 그래서 그 어댑터는 대체가 아니라 **제거**했고, 이 원장이 자리를 대신한다.
 *
 * 무엇이 들어오는가:
 *  · 사용자가 실제로 승인해 커널이 **소비한** 결정만(`approvalConsumed.approved === true`)
 *  · 그중 **재사용 가능한 범위**를 가진 것만 — 제품의 `grantScope.kind` 는 `once|session|persist` 이고
 *    `session`/`persist` 만 bounded 로 승격한다. `once` 는 소비돼도 권한이 아니다(재사용 불가).
 *  · 행동·대상·범위가 **모두** 있는 것만. 하나라도 없으면 무엇을 허락했는지 말할 수 없다.
 */
export const GRANT_REUSABLE_KINDS = Object.freeze(['session', 'persist']);

/** 조회 키 — `admission` 이 같은 규칙으로 만든 키로 찾는다(`l1-intent/turn-facts.js` `grantKey`). */
export function grantLedgerKey({ action, target, scope } = {}) {
  const s = (v) => (typeof v === 'string' && v ? v : null);
  return (s(action) && s(target) && s(scope)) ? `grant:${action}:${target}:${scope}` : null;
}

/**
 * 소비된 승인 하나 → 원장 기록(또는 `null`). **없는 bounded 를 만들어내지 않는다.**
 * @param {{grantScope?:object, plan?:object, sendArgs?:object, intent?:object}} saved 소비된 대기 항목
 * @param {{scope?:string, now?:number}} ctx 범위 식별자와 시각(호출자가 사실로 준다)
 */
export function grantFromConsumedApproval(saved, { scope = null, now = 0 } = {}) {
  const g = saved?.grantScope;
  if (!g || !GRANT_REUSABLE_KINDS.includes(g.kind)) return null; // once 는 여기서 끝난다
  const action = saved?.plan?.toolsToUse?.[0] ?? saved?.plan?.needsApproval?.[0]?.action ?? null;
  const target = (action && saved?.sendArgs?.[action]?.target)
    ?? saved?.intent?.sendTarget?.target ?? null;
  const key = grantLedgerKey({ action, target, scope });
  if (!key) return null; // 무엇을·어디에·어느 범위에서 중 하나라도 모르면 권한으로 남기지 않는다
  return {
    key, kind: 'bounded', action, target, scope,
    grantedAt: now,
    expiresAt: typeof g.expiresAt === 'number' ? g.expiresAt : null,
    revoked: false,
  };
}

/**
 * 원장 → 동기 조회기. 같은 키가 여러 번 부여됐으면 **가장 최근 것**이 이긴다.
 * 만료·철회 판정은 여기서 하지 않는다 — admission 의 권한판정이 `now` 를 들고 다시 본다
 * (두 곳에서 같은 사실을 계산하면 덜 아는 쪽이 이긴다).
 */
export function grantSnapshotFromLedger(grants) {
  const m = new Map();
  for (const g of Array.isArray(grants) ? grants : []) {
    if (!g?.key || g.kind !== 'bounded') continue;
    const prev = m.get(g.key);
    if (!prev || (g.grantedAt ?? 0) >= (prev.grantedAt ?? 0)) m.set(g.key, g);
  }
  return Object.freeze({ get: (k) => m.get(k) ?? null });
}
