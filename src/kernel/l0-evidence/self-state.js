// L0 · SelfStateSnapshot 조립 (Operational Selfhood 계약, §6)
// T5 는 매 턴 자기 가용 범위를 안다. 추정하지 않고 실제 연결·자격 신호로 채운다.
import { AUTH_STATE } from '../contracts.js';
import { toolLabel } from '../tool-labels.js';

/**
 * provider 자격 신호를 modelAuthState 로 분류한다.
 * T3 사고 재발 방지: billing 과 rate_limit 을 섞지 않는다.
 *  - billing_blocked = 결제 확인 필요(재시도 아님)
 *  - rate_limited    = 잠시 후 재시도
 * @param {string|undefined} signal
 * @returns {import('../contracts.js').ModelAuthState}
 */
export function classifyModelAuth(signal) {
  const s = String(signal ?? 'ok').toLowerCase();
  // billing 먼저 — quota 문구가 rate_limit 로 오분류됐던 T3 회귀를 막는다.
  if (/insufficient_quota|billing|payment|exceeded your current quota|hard limit/.test(s)) {
    return AUTH_STATE.BILLING_BLOCKED;
  }
  if (/rate.?limit|429|too many requests|overloaded|slow.?down/.test(s)) {
    return AUTH_STATE.RATE_LIMITED;
  }
  if (/invalid.?api.?key|unauthorized|401|auth.?fail|forbidden/.test(s)) {
    return AUTH_STATE.AUTH_FAILED;
  }
  return AUTH_STATE.USABLE;
}

/**
 * 자격 상태에 맞는 다음 안전 행동 문구(막다른 답 금지).
 * @param {import('../contracts.js').ModelAuthState} state
 */
function nextActionForAuth(state) {
  switch (state) {
    case AUTH_STATE.BILLING_BLOCKED:
      return '지금 모델은 결제 확인이 필요해요. 다른 모델로 이어갈게요.';
    case AUTH_STATE.RATE_LIMITED:
      return '지금 잠깐 몰렸어요. 잠시 후 다시 할게요.';
    case AUTH_STATE.AUTH_FAILED:
      return '모델 연결이 풀렸어요. 다시 연결하면 이어갈 수 있어요.';
    default:
      return undefined;
  }
}

/**
 * @param {Object} env
 * @param {{id:string, strengths?:string, limits?:string, authSignal?:string}} env.model
 * @param {import('../contracts.js').ConnectedTool[]} [env.connections]
 * @param {string[]} [env.grantedAuthorities]
 * @returns {import('../contracts.js').SelfStateSnapshot}
 */
export function buildSelfState(env) {
  const model = env.model ?? { id: 'unknown' };
  const modelAuthState = classifyModelAuth(model.authSignal);
  const connectedTools = (env.connections ?? []).map((t) => ({
    id: t.id,
    connected: Boolean(t.connected),
    executable: Boolean(t.executable),
    note: t.note,
  }));

  const limits = [];
  if (modelAuthState !== AUTH_STATE.USABLE) {
    limits.push(`모델 상태: ${modelAuthState}`);
  }
  for (const t of connectedTools) {
    // 목록에 있으나 실행 불가한 도구는 한계로 정직하게 표시한다(헌법 §3-3).
    if (t.connected && !t.executable) limits.push(`${toolLabel(t.id)}: 연결됨, 아직 실행 준비 안 됨`);
    if (!t.connected) limits.push(`${toolLabel(t.id)}: 연결하면 가능`);
  }

  return {
    currentModel: { id: model.id, strengths: model.strengths, limits: model.limits },
    modelAuthState,
    connectedTools,
    grantedAuthorities: env.grantedAuthorities ?? [],
    riskyActions: [],
    limits,
    nextSafeAction: nextActionForAuth(modelAuthState),
  };
}

/**
 * 도구가 지금 실제 실행 가능한지(목록 존재 ≠ 실행 가능).
 * @param {import('../contracts.js').SelfStateSnapshot} selfState
 * @param {string} toolId
 */
export function isToolExecutable(selfState, toolId) {
  const t = selfState.connectedTools.find((c) => c.id === toolId);
  return Boolean(t && t.executable);
}

/**
 * 화면 칩용 짧은 요약(대화 흐름 비점유, 헌법 §5 / UX §1.1).
 * @param {import('../contracts.js').SelfStateSnapshot} selfState
 */
export function selfStateSummary(selfState) {
  return {
    model: selfState.currentModel.id,
    modelAuthState: selfState.modelAuthState,
    // 사용자면에는 내부 도구 id 대신 라벨만 노출한다(안티 대시보드, 감사 지적).
    ready: selfState.connectedTools.filter((t) => t.executable).map((t) => toolLabel(t.id)),
    limits: selfState.limits,
    nextSafeAction: selfState.nextSafeAction,
  };
}
