// L1 · InboundEventGate (Relevance Gate) — Kernel Contract §1.5(Phase 5.1).
// IntentPacket 앞에서 외부·비요청 이벤트가 턴을 열 가치가 있는지 값싼 결정적 판정으로 거른다.
// 모델을 부르지 않는다. Hermes mention-gating 흡수(복제 아님).
//
// 경계(감사 보정 반영):
// - 게이트 대상은 external_channel·automation_trigger 뿐.
// - user_chat은 항상 우회(자연스러움 보존). fast_chat 경로엔 절대 걸리지 않는다.
// - trusted_runtime_event(복구·보안·권한)는 게이트에 걸리지 않는다 — 묻히면 위험하므로 우회해
//   Recovery·Authority로 직행한다.
// - ignore/context_only는 사용자 설명문(userSafeReason)을 만들지 않는다(알림 콘솔화 방지).

const GATED_SOURCES = new Set(['external_channel', 'automation_trigger']);
const TRIGGERS = new Set(['mention', 'allowlisted', 'direct_message', 'dedup_new']);

/**
 * @typedef {Object} InboundEvent
 * @property {'user_chat'|'external_channel'|'automation_trigger'|'trusted_runtime_event'} source
 * @property {string} [text]               이벤트 발화(채널 정규화 시)
 * @property {string[]} [triggerSignals]  결정적 신호(mention/allowlisted/direct_message/dedup_new)
 * @property {boolean} [keepAsContext]     트리거 없을 때 맥락 backfill을 허용할지
 * @property {{channel?:string, chatId?:string, userId?:string}} [channelMeta]  채널 출처(정규화 시)
 */

/**
 * 채널 메시지를 단일 InboundEvent로 정규화한다(P6-2 Slice-3). 채널이 달라도 같은 이벤트 형태로
 * InboundEventGate·turn을 탄다(Hermes MessageEvent 정규화 흡수). 채널별 로직을 커널에 두지 않는다.
 * mention/allowlist/DM 신호만 결정적으로 뽑는다 — 모델 판단 아님.
 * @param {{channel:string, chatId?:string, userId?:string, text:string,
 *   isMention?:boolean, isAllowlistedUser?:boolean, isDirectMessage?:boolean}} msg
 * @returns {InboundEvent}
 */
export function normalizeInboundEvent(msg = {}) {
  const triggerSignals = [];
  if (msg.isMention) triggerSignals.push('mention');
  if (msg.isAllowlistedUser) triggerSignals.push('allowlisted');
  if (msg.isDirectMessage) triggerSignals.push('direct_message');
  return {
    source: 'external_channel',
    text: msg.text,
    triggerSignals,
    channelMeta: { channel: msg.channel, chatId: msg.chatId, userId: msg.userId },
  };
}

/**
 * @param {InboundEvent} event
 * @returns {{source:string, disposition:'respond'|'context_only'|'ignore'|'defer',
 *   admittedAsContext:boolean, userSafeReason?:string, diagnosticReason?:object}}
 */
export function admitInboundEvent(event) {
  const source = event?.source ?? 'user_chat';

  // 우회 1: 직접 사용자 채팅 — 항상 admit.
  if (source === 'user_chat') {
    return { source, disposition: 'respond', admittedAsContext: false };
  }
  // 우회 2: 신뢰 런타임 이벤트(복구·보안·권한) — 게이트에 걸리지 않고 Recovery·Authority로 직행.
  if (source === 'trusted_runtime_event') {
    return {
      source, disposition: 'respond', admittedAsContext: false,
      diagnosticReason: { routedTo: 'recovery_authority', bypass: 'trusted_runtime_event' },
    };
  }

  // 게이트 대상: external_channel·automation_trigger.
  if (!GATED_SOURCES.has(source)) {
    // 알 수 없는 source는 안전하게 무시(사용자 설명문 없음).
    return { source, disposition: 'ignore', admittedAsContext: false, diagnosticReason: { reason: 'unknown_source' } };
  }

  const signals = (event?.triggerSignals ?? []).filter((s) => TRIGGERS.has(s));
  if (signals.length) {
    return { source, disposition: 'respond', admittedAsContext: false, diagnosticReason: { signals } };
  }

  // 트리거 없음: 맥락으로만 backfill하거나 조용히 무시. 어느 쪽이든 사용자 설명문 없음.
  if (event?.keepAsContext) {
    return {
      source, disposition: 'context_only', admittedAsContext: true,
      diagnosticReason: { reason: 'no_trigger_context_backfill' },
    };
  }
  return {
    source, disposition: 'ignore', admittedAsContext: false,
    diagnosticReason: { reason: 'no_trigger_ignored' },
  };
}
