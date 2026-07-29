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
  makeObservationEvent, observationFromApproval, validateObservationEvent,
} from '../kernel/l0-evidence/tcell-observation.js';

const 비밀일반화 = '비밀이 포함된 실행 사실(원문 비저장)';

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
  async observeTurn({ sessionId, ledgerStart = 0, turnReceipts = [], approvalDecision = null, now = 0 } = {}) {
    try {
      const jobs = [];
      const base = { sessionId, now, sourceRefs: sessionId ? [`session:${sessionId}`] : [] };
      turnReceipts.forEach((rec, i) => {
        const ref = `ledger:${sessionId}:${ledgerStart + i}`;
        const secret = rec?.containsSecret === true;
        jobs.push(this.record(makeObservationEvent({
          type: 'tool_result', sessionId, occurredAt: now,
          signal: { summary: secret ? 비밀일반화 : (rec?.userSafeSummary ?? rec?.action ?? ''), valence: rec?.failureState && rec.failureState !== 'none' ? 'failure' : 'success' },
          sourceRefs: base.sourceRefs, receiptRefs: [ref],
          privacy: { containsSecret: secret },
        })));
        if (rec?.failureState && rec.failureState !== 'none') {
          jobs.push(this.record(makeObservationEvent({
            type: 'recovery', sessionId, occurredAt: now,
            signal: { summary: secret ? 비밀일반화 : (rec?.nextSafeAction ?? '실패 후 다음 길'), valence: 'failure' },
            sourceRefs: base.sourceRefs, receiptRefs: [`${ref}:recovery`],
            privacy: { containsSecret: secret }, // 파생 관찰도 비밀 표식·비가독을 물려받는다
          })));
        }
      });
      if (approvalDecision?.pendingId) {
        jobs.push(this.record(observationFromApproval(approvalDecision, {
          ...base, sourceRefs: [...base.sourceRefs, `approval:${sessionId}:${approvalDecision.pendingId}`],
        })));
      }
      const done = await Promise.all(jobs);
      return { recorded: done.filter((d) => d.recorded).length };
    } catch (e) {
      this.lastError = e?.message ?? String(e);
      return { recorded: 0 };
    }
  }

  /** 사용자 정정(구조화 신호: 되돌리기·철회 행동) — 발화 원문이 아니라 행동 사실과 참조만. */
  async observeCorrection({ sessionId = null, what, ref, now = 0 } = {}) {
    return this.record(makeObservationEvent({
      type: 'user_correction', sessionId, occurredAt: now,
      signal: { summary: what ?? '사용자가 이전 반영을 되돌렸어요', valence: 'correction' },
      sourceRefs: sessionId ? [`session:${sessionId}`] : [], receiptRefs: ref ? [ref] : [],
    }));
  }

  /** 자동화 결과 — 엔진 결과 경계에서 job+실행 번호로 투영한다. */
  async observeAutomationResult({ jobId, executionIndex = 0, receipt, now = 0 } = {}) {
    const secret = receipt?.containsSecret === true;
    return this.record(makeObservationEvent({
      type: 'automation_result', occurredAt: now,
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
import { writeFile, rename } from 'node:fs/promises';
import { validateTCell, makeTCellCandidate } from '../kernel/l5-growth/tcell-core.js';

export class TCellRegistry {
  constructor(dir) {
    this.dir = join(dir, 'growth');
    this.file = join(this.dir, 'tcells.json');
  }

  async load() {
    try {
      const a = JSON.parse(await readFile(this.file, 'utf8'));
      // 알 수 없는 미래 필드는 보존하고 무시한다(명세 §6).
      return { cells: Array.isArray(a.cells) ? a.cells : [], ...a, cells: Array.isArray(a.cells) ? a.cells : [] };
    } catch { return { cells: [] }; }
  }

  async save(a) {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    await writeFile(tmp, JSON.stringify({ ...a, cells: a.cells ?? [] }), { encoding: 'utf8', mode: 0o600 });
    await rename(tmp, this.file);
    return a;
  }

  /** 등록은 검증을 지나서만 — 실패는 던지지 않고 quarantined 사본으로 저장된다(영향 0). */
  async upsert(cell, evidenceStore = null, opts = {}) {
    const v = validateTCell(cell, evidenceStore, opts);
    const a = await this.load();
    const idx = a.cells.findIndex((c) => c.id === v.cell.id);
    if (idx >= 0) a.cells[idx] = v.cell; else a.cells.push(v.cell);
    await this.save(a);
    return v;
  }

  /** rollback 은 삭제가 아니라 상태 전이다 — trace·이력을 지우지 않는다(명세 §6). */
  async rollback(cellId) {
    const a = await this.load();
    const cell = a.cells.find((c) => c.id === cellId);
    if (!cell) return { ok: false, why: 'not_found' };
    cell.growth = { ...(cell.growth ?? {}), previousVersionId: cell.id, lastAuditAt: null };
    cell.state = 'rolled_back';
    cell.authority = { ...(cell.authority ?? {}), allowedInfluence: ['none'], mustNotOverrideCurrentRequest: true };
    await this.save(a);
    return { ok: true, cell };
  }
}

/**
 * legacy adapter — 기존 memory.json 의 promoted 항목을 **읽기 전용으로** 세포 후보로 투영한다.
 * 기존 파일은 절대 쓰지 않는다. 사용자 승인은 성숙도가 아니다(§4.3: 승인이 낮은 maturity 를
 * 사실로 만들지 않는다) — legacy 는 replay 를 통과한 적이 없으므로 **M1_candidate** 로만 들어온다.
 */
export function importLegacyMemory(memory) {
  const cells = [];
  for (const m of memory?.promoted ?? []) {
    if (!m?.statement) continue;
    cells.push(makeTCellCandidate({
      id: `legacy-mem-${m.id ?? m.candidateId ?? cells.length}`,
      principle: { statement: m.statement, type: 'communication', hypothesisConfidence: 0 },
      boundary: {
        validWhen: ['기존 기억이 승인된 범위 그대로'],
        invalidWhen: ['사용자가 철회했거나 현재 지시와 충돌할 때'],
        needsReviewWhen: ['replay 검증 전'], mustNotOverride: ['현재 요청'],
      },
      trace: { observationRefs: [`memory:promoted:${m.id ?? m.candidateId ?? 'unknown'}`], corrections: [] },
    }));
  }
  return cells;
}
