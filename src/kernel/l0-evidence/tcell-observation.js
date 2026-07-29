// L0 · T-cell 관찰 계약 (TG-0, 명세 §5.1) — **관찰은 영향이 아니다.**
// ObservationEvent 생성은 A0 로컬 기록이다. 어떤 관찰도 직접 TaskContext에 들어가지 않는다.
// 비밀값·전체 파일 내용·전체 모델 사고 원문을 저장하지 않는다 — 원문이 필요하면 sourceRefs 로
// 세션/원장 위치만 참조한다. 모델에게는 modelReadable === true 만 보낼 수 있다.
import { randomUUID } from 'node:crypto';

export const TCELL_OBSERVATION_SCHEMA_VERSION = 1;

export const OBSERVATION_TYPES = Object.freeze([
  'user_request', 'user_correction', 'tool_result', 'approval', 'rejection',
  'recovery', 'delivery_result', 'context_outcome', 'automation_result',
]);

export const OBSERVATION_VALENCES = Object.freeze(['success', 'failure', 'correction', 'neutral']);

// 요약은 짧게 — 관찰 요약이 원문 저장의 뒷문이 되지 않게 한다(명세 §5.1 규칙).
const SUMMARY_MAX = 300;
const 요약 = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, SUMMARY_MAX);

/** @returns {import('./tcell-observation.js').ObservationEvent} */
export function makeObservationEvent(input = {}) {
  return {
    id: input.id ?? randomUUID(),
    type: input.type,
    sessionId: input.sessionId ?? null,
    turnId: input.turnId ?? null,
    taskId: input.taskId ?? null,
    occurredAt: input.occurredAt ?? 0,
    anchor: {
      workspace: input.anchor?.workspace ?? null,
      project: input.anchor?.project ?? null,
      surface: input.anchor?.surface ?? null,
      subject: input.anchor?.subject ?? null,
    },
    signal: { summary: 요약(input.signal?.summary), valence: input.signal?.valence ?? 'neutral' },
    sourceRefs: [...(input.sourceRefs ?? [])],
    receiptRefs: [...(input.receiptRefs ?? [])],
    privacy: {
      // 비밀이 섞였다고 표시된 관찰은 **모델이 읽을 수 없다** — 두 플래그는 함께 움직인다.
      modelReadable: input.privacy?.containsSecret ? false : (input.privacy?.modelReadable ?? true),
      containsSecret: input.privacy?.containsSecret ?? false,
    },
    schemaVersion: TCELL_OBSERVATION_SCHEMA_VERSION,
  };
}

/** ToolReceipt → 관찰. 원문 대신 userSafeSummary 만 담고 원장 위치를 참조로 남긴다. */
export function observationFromReceipt(receipt, context = {}) {
  return makeObservationEvent({
    type: 'tool_result',
    sessionId: context.sessionId ?? null,
    turnId: context.turnId ?? null,
    occurredAt: context.now ?? 0,
    anchor: context.anchor,
    signal: {
      summary: receipt?.userSafeSummary ?? receipt?.action ?? '',
      valence: receipt?.failureState && receipt.failureState !== 'none' ? 'failure' : 'success',
    },
    sourceRefs: context.sourceRefs ?? [],
    receiptRefs: receipt?.id ? [receipt.id] : [],
    privacy: { containsSecret: receipt?.containsSecret ?? false },
  });
}

/** 사용자 정정 → 관찰. 정정은 가장 값진 신호지만, 원문 전체가 아니라 요약으로만 담는다. */
export function observationFromCorrection(userText, context = {}) {
  return makeObservationEvent({
    type: 'user_correction',
    sessionId: context.sessionId ?? null,
    turnId: context.turnId ?? null,
    occurredAt: context.now ?? 0,
    anchor: context.anchor,
    signal: { summary: userText, valence: 'correction' },
    sourceRefs: context.sourceRefs ?? [],
  });
}

/** 승인/거절 결정 → 관찰. */
export function observationFromApproval(decision, context = {}) {
  const approved = decision?.approved === true;
  return makeObservationEvent({
    type: approved ? 'approval' : 'rejection',
    sessionId: context.sessionId ?? null,
    turnId: context.turnId ?? null,
    occurredAt: context.now ?? 0,
    anchor: context.anchor,
    signal: { summary: decision?.summary ?? '', valence: approved ? 'success' : 'neutral' },
    sourceRefs: context.sourceRefs ?? [],
  });
}

/** @returns {{ok:boolean, errors:string[]}} */
export function validateObservationEvent(event) {
  const errors = [];
  if (!event || typeof event !== 'object') return { ok: false, errors: ['관찰이 비어 있어요'] };
  if (!OBSERVATION_TYPES.includes(event.type)) errors.push(`type 이 계약 밖이에요: ${event.type}`);
  if (!OBSERVATION_VALENCES.includes(event.signal?.valence)) errors.push('valence 가 계약 밖이에요');
  if (typeof event.signal?.summary !== 'string') errors.push('summary 가 없어요');
  if (event.signal?.summary?.length > SUMMARY_MAX) errors.push('summary 가 원문 저장 수준으로 길어요');
  if (event.privacy?.containsSecret && event.privacy?.modelReadable) {
    errors.push('비밀이 섞인 관찰은 모델이 읽을 수 없어요');
  }
  if (event.schemaVersion !== TCELL_OBSERVATION_SCHEMA_VERSION) errors.push('schemaVersion 불일치');
  return { ok: errors.length === 0, errors };
}
