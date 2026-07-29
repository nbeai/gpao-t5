// L4 · T-cell 관찰 저장소 + shadow 관찰자 (TG-1, 명세 §6·§16) — **관찰은 영향이 아니다.**
// growth/observations.jsonl 에 append-only 로만 쌓인다. 어떤 코드도 여기서 읽어 TaskContext 에
// 넣지 않는다(영향 0). 관찰 생성·기록 실패는 어떤 경로로도 사용자 답변을 실패시키지 않는다.
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  makeObservationEvent, observationFromReceipt, observationFromCorrection,
  observationFromApproval, validateObservationEvent,
} from '../kernel/l0-evidence/tcell-observation.js';

// 같은 receipt 로 두 번 관찰하지 않는다(명세 TG-1). 프로세스 수명 안에서만 기억하면 충분하다 —
// 재시작 뒤 같은 receipt 가 다시 투영될 일은 없다(투영은 턴 완료 순간에만 일어난다).
const DEDUP_CAP = 1000;

export class TCellObserver {
  constructor(dir) {
    this.dir = join(dir, 'growth');
    this.file = join(this.dir, 'observations.jsonl');
    this.seen = new Set();
    this.lastError = null; // 정직한 상태 — 조용히 삼키되 사실은 남긴다(진단용)
  }

  /** 관찰 1건 기록 — **절대 던지지 않는다.** 검증 실패·손상 입력은 기록하지 않고 사실만 남긴다. */
  async record(event) {
    try {
      const v = validateObservationEvent(event);
      if (!v.ok) { this.lastError = v.errors.join(' · '); return { recorded: false, why: 'invalid' }; }
      const key = event.receiptRefs?.length ? `r:${event.receiptRefs.join(',')}` : `id:${event.id}`;
      if (this.seen.has(key)) return { recorded: false, why: 'duplicate' };
      this.seen.add(key);
      if (this.seen.size > DEDUP_CAP) this.seen.delete(this.seen.values().next().value);
      await mkdir(this.dir, { recursive: true });
      await appendFile(this.file, `${JSON.stringify(event)}\n`, 'utf8');
      return { recorded: true };
    } catch (e) {
      this.lastError = e?.message ?? String(e);
      return { recorded: false, why: 'io' };
    }
  }

  /**
   * 턴 완료 후 투영(후처리 경로) — hot path 밖에서 부른다. await 하지 않아도 안전하다.
   * ToolReceipt·승인/거절·복구 사실을 ObservationEvent 로 바꾼다. 원문·비밀은 담지 않는다
   * (userSafeSummary 와 참조만). 실패는 내부에 머문다.
   */
  async observeTurn({ sessionId, result, now = 0 } = {}) {
    try {
      const ctx = { sessionId, now, sourceRefs: sessionId ? [`session:${sessionId}`] : [] };
      const jobs = [];
      for (const rec of result?.turnReceipts ?? result?.receipts ?? []) {
        jobs.push(this.record(observationFromReceipt(rec, ctx)));
        // 실패 영수증은 복구 관찰로도 남긴다 — 복구 원리의 원료(명세 §16 TG-1).
        if (rec?.failureState && rec.failureState !== 'none') {
          jobs.push(this.record(makeObservationEvent({
            type: 'recovery', sessionId, occurredAt: now,
            signal: { summary: rec?.nextSafeAction ?? rec?.userSafeSummary ?? '실패 후 다음 길', valence: 'failure' },
            sourceRefs: ctx.sourceRefs, receiptRefs: rec?.id ? [`${rec.id}:recovery`] : [],
          })));
        }
      }
      if (result?.approvalDecision) jobs.push(this.record(observationFromApproval(result.approvalDecision, ctx)));
      if (result?.userCorrection) jobs.push(this.record(observationFromCorrection(result.userCorrection, ctx)));
      const done = await Promise.all(jobs);
      return { recorded: done.filter((d) => d.recorded).length };
    } catch (e) {
      this.lastError = e?.message ?? String(e);
      return { recorded: 0 };
    }
  }

  /** 감사·시험용 읽기 — 손상된 줄은 건너뛰고 나머지를 살린다(명세 §6). TaskContext 로는 안 간다. */
  async load() {
    try {
      const raw = await readFile(this.file, 'utf8');
      const events = [];
      let corrupted = 0;
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try { events.push(JSON.parse(line)); } catch { corrupted += 1; }
      }
      return { events, corrupted };
    } catch {
      return { events: [], corrupted: 0 };
    }
  }
}
