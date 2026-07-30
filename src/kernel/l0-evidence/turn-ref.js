// L0 · TurnRef — 전 표면 공통의 불변 turn 신분 (T-cell 계획 §4.1).
//
// 왜: 저장된 턴에는 신분이 없었다. 세션 JSON 은 제자리 상태 투영이고, `EventLog` 의 turnId 는
// 스트림 경로에만 있다. 그래서 "이 턴을 이미 처리했는가", "크래시 뒤 어디서 재개하는가" 를
// 물을 대상 자체가 없었다. TurnRef 는 그 대상이다.
//
// 계약:
//   · `turnSeq` 는 **세션 안에서만** 단조 증가한다. 세션 간 전역 순서는 요구하지 않는다 —
//     관찰 파생은 세션 내 순서만 필요하고, 세션 횡단 묶음은 원천 ref 집합의 결정적 ID 로 합친다.
//     (이 비요구를 계약에 적어 둔다. 숨은 가정으로 두면 나중에 "전역 순서가 있다"고 착각한다.)
//   · 한 턴의 user·assistant transcript 항목과 그 턴의 ledger 항목은 같은 TurnRef 를 공유한다.
//   · 발급은 세션 저장과 같은 직렬화 경계(withSessionQueue) 안에서 일어난다.
//   · 기존 세션은 저장 순서로 소급 부여하되 `migrated: true` 를 남긴다. 어느 턴 것인지 알 수
//     없는 과거 항목(ledger)에는 **seq 를 지어내지 않는다** — 소급 표시만 남긴다.

/**
 * 세션 하나의 턴 신분.
 * @typedef {{sessionId: string, turnSeq: number, migrated?: boolean}} TurnRef
 */

/**
 * 이 세션에서 다음에 발급할 turnSeq. 저장된 사실에서만 읽는다(별도 카운터를 두지 않는다 —
 * 카운터와 저장이 갈리면 그 순간 신분이 거짓이 된다).
 * @param {{transcript?: any[]}} session
 * @returns {number}
 */
export function nextTurnSeq(session) {
  let max = 0;
  for (const entry of session?.transcript ?? []) {
    const seq = entry?.turnRef?.turnSeq;
    if (Number.isInteger(seq) && seq > max) max = seq;
  }
  return max + 1;
}

/**
 * 턴 신분을 만든다.
 * @param {string} sessionId
 * @param {number} turnSeq
 * @param {{migrated?: boolean}} [opts]
 * @returns {TurnRef}
 */
export function makeTurnRef(sessionId, turnSeq, opts = {}) {
  if (typeof sessionId !== 'string' || !sessionId) throw new Error('TurnRef 에는 sessionId 가 필요하다');
  if (!Number.isInteger(turnSeq) || turnSeq < 1) throw new Error('turnSeq 는 1 이상의 정수여야 한다');
  return opts.migrated ? { sessionId, turnSeq, migrated: true } : { sessionId, turnSeq };
}

/**
 * 기존(신분 없는) 세션에 소급 신분을 부여한다. 반복 호출해도 결과가 같다(멱등).
 *
 * transcript 는 저장 순서가 곧 대화 순서이므로 user 발화를 턴 경계로 삼아 소급한다.
 * ledger 항목은 어느 턴에 속했는지 저장된 사실이 없다 — seq 없이 `migrated` 표시만 남긴다.
 * @param {{id?: string, transcript?: any[], ledgerEntries?: any[]}} session
 * @returns {typeof session}
 */
export function migrateTurnRefs(session) {
  if (!session || typeof session !== 'object') return session;
  const sessionId = session.id;
  if (typeof sessionId !== 'string' || !sessionId) return session;

  const transcript = session.transcript ?? [];
  let seq = 0;
  let sawAssistantForSeq = false;
  for (const entry of transcript) {
    if (entry?.turnRef) { // 이미 신분이 있으면 건드리지 않는다(멱등).
      if (Number.isInteger(entry.turnRef.turnSeq)) {
        seq = Math.max(seq, entry.turnRef.turnSeq);
        sawAssistantForSeq = entry.role === 'assistant';
      }
      continue;
    }
    // 새 턴의 시작: user 발화이거나, 직전 턴이 이미 assistant 로 닫힌 뒤의 항목.
    if (entry?.role === 'user' || seq === 0 || sawAssistantForSeq) {
      seq += 1;
      sawAssistantForSeq = false;
    }
    entry.turnRef = makeTurnRef(sessionId, seq, { migrated: true });
    if (entry?.role === 'assistant') sawAssistantForSeq = true;
  }

  for (const entry of session.ledgerEntries ?? []) {
    if (!entry || typeof entry !== 'object' || entry.turnRef) continue;
    // 귀속 불가 — 사실을 지어내지 않는다. 소급 표시만 남겨 워커가 "옛 항목"으로 건너뛰게 한다.
    entry.turnRef = { sessionId, migrated: true };
  }
  return session;
}

/**
 * 이번 턴에 새로 붙은 transcript·ledger 항목에 같은 신분을 새긴다.
 * @param {{id: string, transcript?: any[], ledgerEntries?: any[]}} session
 * @param {TurnRef} turnRef
 * @param {{transcriptFrom: number, ledgerFrom: number}} from 이번 턴 시작 시점의 길이
 */
export function stampTurn(session, turnRef, from) {
  for (const entry of (session.transcript ?? []).slice(from.transcriptFrom)) {
    if (entry && typeof entry === 'object' && !entry.turnRef) entry.turnRef = turnRef;
  }
  for (const entry of (session.ledgerEntries ?? []).slice(from.ledgerFrom)) {
    if (entry && typeof entry === 'object' && !entry.turnRef) entry.turnRef = turnRef;
  }
}
