// L0 · TurnEvent (P6-12). 스트리밍은 durable truth 위의 투영이다. 이 계약이 그 투영 단위를 정한다.
// 절대 원칙: 모델 숨은 사고 원문 노출 금지 — payload는 사용자용 상태/근거/도구/복구뿐. 각 이벤트는
//   turnId·eventId(단조)·type·createdAt·payload·durable을 가진다. durable=true만 EventLog에 남아 재접속 복구된다.

export const EVENT_TYPES = Object.freeze([
  'trace_status',      // 요청 이해/확인 중/정리 중/작성 중(사용자 언어)
  'tool_progress',     // 도구 실행 진행
  'evidence_added',    // 출처/근거 추가
  'approval_required', // 승인 필요
  'capability_needed', // 연결/설정/도구 준비 필요
  'blocked',           // 막힘/차단
  'recoverable_error', // 복구 가능한 오류(+다음 안전 행동)
  'partial_result',    // 일부 결과
  'answer_delta',      // 최종 답변 본문 조각(비지속)
  // 답을 **다시 쓴다**는 신호(비지속). 되돌림은 이어감이 아니라 대체이므로, 앞서 흐른 말을
  // 지우고 다시 시작한다. 이게 없으면 어긋나는 두 답이 한 답으로 보인다(F-8).
  'answer_reset',
  'complete',          // 완료(turn 종료)
  'heartbeat',         // 연결 생존 신호(비지속)
]);

// durable=true → EventLog에 남아 lastEventId 재접속으로 복구. answer_delta/heartbeat은 비지속
//   (끊기면 durable 상태에서 재구성 — 조각은 진실의 출처가 아니다).
const DURABLE = new Set([
  'trace_status', 'tool_progress', 'evidence_added', 'approval_required',
  'capability_needed', 'blocked', 'recoverable_error', 'partial_result', 'complete',
]);

export function isDurable(type) {
  return DURABLE.has(type);
}

/**
 * `turnRef`(S0 · 계획 §4.1)는 저장된 턴과 이 이벤트를 잇는 **불변 신분**이다. `turnId` 는
 * 스트림 한 회의 상관 ID 일 뿐이라 저장된 transcript·ledger 와 이어지지 않았다 — 그래서
 * 관찰 워커가 "이 이벤트가 어느 저장된 턴의 것인가"를 물을 수 없었다(S0 감사 P1).
 * @param {{turnId:string, eventId:number, type:string, payload?:*, now?:number,
 *   turnRef?:{sessionId:string, turnSeq:number}}} p
 */
export function makeTurnEvent(p) {
  if (!EVENT_TYPES.includes(p.type)) throw new Error(`알 수 없는 이벤트 유형: ${p.type}`);
  if (!Number.isInteger(p.eventId)) throw new Error('eventId는 정수여야 한다(단조 증가).');
  return {
    turnId: p.turnId,
    ...(p.turnRef ? { turnRef: p.turnRef } : {}),
    eventId: p.eventId,
    type: p.type,
    payload: p.payload ?? null,
    durable: isDurable(p.type),
    createdAt: p.now ?? 0,
  };
}

/** 종료 이벤트인가(무한 대기 금지 — 모든 turn은 이 중 하나로 닫힌다). */
export function isTerminal(type) {
  return type === 'complete' || type === 'blocked';
}
