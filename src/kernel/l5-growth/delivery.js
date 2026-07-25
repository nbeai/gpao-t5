// L5 · Delivery Ledger (P6-14). 결과 "생성"과 결과 "전달"을 분리한다. 전달이 실패해도 만들어 둔 산출물
// (artifact)은 durable하게 남고, 처음부터 다시 하지 않고 **이어서 재전달**한다.
// 절대 원칙: **완료는 실제 전달 확인(delivered) 이후에만.** "생성했다"·"보냈다고 시도했다"는 완료가 아니다.
//   외부 전송은 A2 유지(원 승인 범위의 재전달이지 새 외부 행동이 아니다). 실패는 정직하게 원장에 남긴다.
// 근거: P6-12 EventLog(durable truth), P6-13 VerificationReceipt, §7 ToolReceipt.lifecycle, P6-6 ChannelSender.

export const DELIVERY_STATES = Object.freeze(['attempting', 'delivered', 'failed']);

/**
 * 전달 기록 생성(attempting). artifact는 이미 만들어진 산출물 — 재전달 시 재생성하지 않는다.
 * sessionId는 이 전달을 승인·생성한 세션 — 조회·재전달은 이 세션에서만 허용한다(세션/권한 경계).
 * @param {{id:string, sessionId?:string, tool:string, channel?:string, target:string, artifact:object, now?:number}} p
 */
export function makeDelivery(p) {
  return {
    id: p.id,
    sessionId: p.sessionId ?? null, // 소유 세션 — 다른 세션의 조회·재전달을 막는 권한 경계
    tool: p.tool,                 // 전달 수단(slack.post 등) — 재전달에 그대로 쓴다
    channel: p.channel ?? p.tool,
    target: p.target,
    artifact: p.artifact,         // { text } 등 — durable, 재생성 없음
    state: 'attempting',
    attempts: 0,
    lastError: null,
    retriable: false,
    createdAt: p.now ?? 0,
  };
}

/**
 * 전달 시도 결과를 반영(순수). failureState(§7): none=전달됨 / failed·timeout=재시도 가능 / blocked·cancelled=
 * 재시도로 안 풀림(연결/권한 등, 원인 해소 후 재전달). 어느 쪽이든 산출물은 보존한다.
 * @returns {object} 갱신된 delivery
 */
export function applyDeliveryResult(delivery, failureState, userSafeSummary, now = 0) {
  const attempts = (delivery.attempts ?? 0) + 1;
  if (failureState === 'none') {
    return { ...delivery, state: 'delivered', attempts, deliveredAt: now, lastError: null, retriable: false };
  }
  const needsFix = failureState === 'blocked' || failureState === 'cancelled'; // 연결/권한 등 원인 해소 필요
  return {
    ...delivery,
    state: 'failed',
    attempts,
    lastError: { failureState, userSafeSummary: userSafeSummary ?? '전달에 실패했어요.' },
    retriable: true,          // 산출물은 남았으니 재전달 자체는 가능
    needsFix,                 // true면 "연결/권한부터 고치고 다시"
  };
}

/** 재전달 가능한가(산출물이 남아 있고 아직 전달 안 됨). */
export function isRetriable(d) {
  return d?.state === 'failed' && d?.retriable === true;
}

/** 실제 전달 확인됨 — 완료 주장은 이 이후에만. */
export function isDelivered(d) {
  return d?.state === 'delivered';
}
