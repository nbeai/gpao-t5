// L0 · T-cell 관찰 계약 (TG-0, 명세 §5.1) — **관찰은 영향이 아니다.**
// ObservationEvent 생성은 A0 로컬 기록이다. 어떤 관찰도 직접 TaskContext에 들어가지 않는다.
// 비밀값·전체 파일 내용·전체 모델 사고 원문을 저장하지 않는다 — 원문이 필요하면 sourceRefs 로
// 세션/원장 위치만 참조한다. 모델에게는 modelReadable === true 만 보낼 수 있다.
import { randomUUID } from 'node:crypto';

/**
 * @typedef {Object} ObservationEvent
 * @property {string} id
 * @property {'user_request'|'user_correction'|'tool_result'|'approval'|'rejection'|'recovery'|'delivery_result'|'context_outcome'|'automation_result'} type
 * @property {string|null} sessionId
 * @property {string|null} turnId
 * @property {string|null} taskId
 * @property {number} occurredAt
 * @property {{workspace:string|null, project:string|null, surface:string|null, subject:string|null}} anchor
 * @property {{summary:string, valence:'success'|'failure'|'correction'|'neutral'}} signal
 * @property {string[]} sourceRefs
 * @property {string[]} receiptRefs
 * @property {{modelReadable:boolean, containsSecret:boolean}} privacy
 * @property {number} schemaVersion
 */

export const TCELL_OBSERVATION_SCHEMA_VERSION = 1;

/**
 * 비밀 모양 선별 — **판단이 아니라 안전망**이다. 목록으로 의미를 판정하지 않는다(길고 무작위한
 * 자격 모양만 본다). 예전엔 이 함수가 저장층(surface/tcell-store)에만 있었고, 그래서 **저장은
 * 막히는데 모델로 나가는 길은 안 막히는** 비대칭이 생겼다(감사 6회차 P0). 사실이 하나면 층도
 * 하나여야 한다 — 관찰 기록과 추출 입력이 같은 이 함수를 본다.
 */
export function looksLikeSecret(text) {
  const t = String(text ?? '');
  if (/\b(sk-|ghp_|gho_|xox[baprs]-|AKIA|ya29\.|Bearer\s+[\w-]{16,})/i.test(t)) return true;
  // 20자 이상의 고엔트로피 토큰(영숫자+기호 혼합) — 사람 문장에는 잘 없다.
  return /[A-Za-z0-9_\-]{28,}/.test(t) && /[0-9]/.test(t) && /[A-Za-z]/.test(t);
}

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

/**
 * ToolReceipt → 관찰(명세 §5.1 필수 생성자). 원문 대신 userSafeSummary 만 담는다.
 * **신분은 호출자가 준다**(`context.ref`) — 실제 ToolReceipt 에는 id 가 없고, 원장 위치가 신분이다
 * (TG-1 감사). 비밀 표식이 있으면 요약을 일반화해 원문이 남지 않게 한다.
 */
export function observationFromReceipt(receipt, context = {}) {
  const secret = receipt?.containsSecret === true;
  return makeObservationEvent({
    type: 'tool_result',
    sessionId: context.sessionId ?? null,
    turnId: context.turnId ?? null,
    occurredAt: context.now ?? 0,
    anchor: context.anchor,
    signal: {
      summary: secret ? context.secretSummary ?? '' : (receipt?.userSafeSummary ?? receipt?.action ?? ''),
      valence: receipt?.failureState && receipt.failureState !== 'none' ? 'failure' : 'success',
    },
    sourceRefs: context.sourceRefs ?? [],
    receiptRefs: context.ref ? [context.ref] : (receipt?.id ? [receipt.id] : []),
    privacy: { containsSecret: secret },
  });
}

/** 실패 영수증 → 복구 관찰(파생) — 비밀 표식·비가독을 그대로 물려받는다. */
export function observationFromRecovery(receipt, context = {}) {
  const secret = receipt?.containsSecret === true;
  return makeObservationEvent({
    type: 'recovery',
    sessionId: context.sessionId ?? null,
    turnId: context.turnId ?? null,
    occurredAt: context.now ?? 0,
    anchor: context.anchor,
    signal: { summary: secret ? context.secretSummary ?? '' : (receipt?.nextSafeAction ?? '실패 후 다음 길'), valence: 'failure' },
    sourceRefs: context.sourceRefs ?? [],
    receiptRefs: context.ref ? [`${context.ref}:recovery`] : [],
    privacy: { containsSecret: secret },
  });
}

/**
 * 사용자 정정 → 관찰(명세 §5.1 필수 생성자). 발화 원문이 아니라 **행동 사실**을 담는다
 * (TG-1 감사: 원문 비저장). 신분은 호출자가 주는 구조화된 참조다.
 */
export function observationFromCorrection(what, context = {}) {
  return makeObservationEvent({
    type: 'user_correction',
    sessionId: context.sessionId ?? null,
    turnId: context.turnId ?? null,
    occurredAt: context.now ?? 0,
    anchor: context.anchor,
    signal: { summary: what, valence: 'correction' },
    sourceRefs: context.sourceRefs ?? [],
    receiptRefs: context.ref ? [context.ref] : [],
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
  try {
    if (!event || typeof event !== 'object') return { ok: false, errors: ['관찰이 비어 있어요'] };
    if (!OBSERVATION_TYPES.includes(event.type)) errors.push(`type 이 계약 밖이에요: ${event.type}`);
    if (!OBSERVATION_VALENCES.includes(event.signal?.valence)) errors.push('valence 가 계약 밖이에요');
    if (typeof event.signal?.summary !== 'string') errors.push('summary 가 없어요');
    else if (event.signal.summary.length > SUMMARY_MAX) errors.push('summary 가 원문 저장 수준으로 길어요');
    const strA = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0);
    if (!strA(event.sourceRefs) || !strA(event.receiptRefs)) errors.push('참조 목록은 비어 있지 않은 문자열 배열이에요');
    if (typeof event.privacy?.modelReadable !== 'boolean' || typeof event.privacy?.containsSecret !== 'boolean') {
      errors.push('privacy 플래그는 불리언이에요');
    } else if (event.privacy.containsSecret && event.privacy.modelReadable) {
      errors.push('비밀이 섞인 관찰은 모델이 읽을 수 없어요');
    }
    if (!(typeof event.occurredAt === 'number' && Number.isFinite(event.occurredAt) && event.occurredAt >= 0)) errors.push('occurredAt 은 0 이상 수예요');
    if (event.schemaVersion !== TCELL_OBSERVATION_SCHEMA_VERSION) errors.push('schemaVersion 불일치');
  } catch (e) { errors.push(`검증기 내부 오류: ${e?.message ?? e}`); }
  return { ok: errors.length === 0, errors };
}
