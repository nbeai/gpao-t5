// L0 · Truth Ledger — 도구 실행 원장. 사용자 답변은 이 원장 기준으로
// "확인한 것 / 확인 못한 것 / 추정"을 분리한다(계획서 §5.4).
import { FAILURE } from '../contracts.js';

/**
 * receipt 목록을 확인/미확인/추정으로 투영한다. 사용자면(userSafeSummary)만 노출한다.
 * 순수 함수 — 세션 전체 원장이든 이번 턴 receipt 목록이든 같은 규칙으로 투영한다.
 * @param {import('../contracts.js').ToolReceipt[]} entries
 * @returns {{confirmed:string[], unconfirmed:string[], estimated:string[]}}
 */
export function projectReceipts(entries) {
  const confirmed = [];
  const unconfirmed = [];
  const estimated = [];
  for (const e of entries) {
    if (e.failureState === FAILURE.NONE && e.actualCall && e.result !== undefined) {
      confirmed.push(e.userSafeSummary);
    } else if (e.failureState !== FAILURE.NONE) {
      // blocked/failed/timeout = 확인 못 함. 추정으로 메우지 않는다.
      unconfirmed.push(e.userSafeSummary + (e.nextSafeAction ? ` — ${e.nextSafeAction}` : ''));
    } else {
      // 호출 없이 모델 지식으로만 답한 경우 = 추정으로 정직하게 분리.
      estimated.push(e.userSafeSummary);
    }
  }
  return { confirmed, unconfirmed, estimated };
}

export class TruthLedger {
  constructor() {
    /** @type {import('../contracts.js').ToolReceipt[]} */
    this.entries = [];
  }

  /** @param {import('../contracts.js').ToolReceipt} rec */
  append(rec) {
    this.entries.push(rec);
    return rec;
  }

  /** 세션 전체 원장 투영(감사 표면용). 턴 응답은 이번 턴 receipt 만 투영한다. */
  project() {
    return projectReceipts(this.entries);
  }
}
