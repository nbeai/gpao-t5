// L0 · SelfStateSnapshot 조립 (Operational Selfhood 계약, §6)
// T5 는 매 턴 자기 가용 범위를 안다. 추정하지 않고 실제 연결·자격 신호로 채운다.
import { AUTH_STATE } from '../contracts.js';
import { toolLabel, toolCapabilityLine } from '../tool-labels.js';

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
 * 연결 항목의 실행 가능성을 세분화한다(Phase 5.1, §6 개정). 단일 executable 불리언 대신
 * "왜 못 쓰는지"를 담는다. P5는 도달값(usable/needs_connection/blocked)만 실제로 산출하고,
 * needs_auth/needs_config는 env가 명시할 때만(정의-하되-대부분-미도달).
 * @param {{connected?:boolean, executable?:boolean, needs?:string}} t
 * @returns {'usable'|'needs_auth'|'needs_config'|'needs_connection'|'blocked'}
 */
function deriveToolStatus(t) {
  if (!t.connected) return 'needs_connection';
  if (t.executable) return 'usable';
  if (t.needs === 'auth') return 'needs_auth';
  if (t.needs === 'config') return 'needs_config';
  return 'blocked'; // 연결됐으나 실행 불가(사유 미상)
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
  const connectedTools = (env.connections ?? []).map((t) => {
    // descriptor가 availability로 이미 판정한 status를 존중한다(P6-2). 없으면 파생(하위호환).
    const status = t.status ?? deriveToolStatus(t);
    return {
      id: t.id,
      connected: Boolean(t.connected),
      status, // Phase 5.1: usable|needs_auth|needs_config|needs_connection|blocked
      executable: status === 'usable', // 하위호환 파생(§6)
      // P6-2 감사 보정: "실행 가능"과 "실행해도 됨"의 두 축을 끝까지 보존한다. descriptor의
      // needsApproval(행동 승인)·toolKind(권한 종류)를 버리지 않고 ActionPlan이 참조하게 실어 보낸다.
      needsApproval: t.needsApproval,
      toolKind: t.toolKind,
      reversible: t.reversible,           // 승인 카드가 사실대로 말하게(추측 금지)
      reversibleNote: t.reversibleNote,
      note: t.note,
    };
  });

  const limits = [];
  if (modelAuthState !== AUTH_STATE.USABLE) {
    limits.push(`모델 상태: ${modelAuthState}`);
  }
  // P-RT-2 감사 B1: 자격(auth)과 별도의 모델 readiness 축. doctor 가 env.model.healthState 로 싣는다.
  // model_missing/unreachable 인데 "준비됨"으로 보이면 T3 "보이는 것≠되는 것" 재발 — 한계로 정직 표시.
  const modelHealthState = model.healthState;
  if (modelAuthState === AUTH_STATE.USABLE && modelHealthState === 'model_missing') {
    limits.push('모델 확인 필요: 설정된 모델을 지금 쓸 수 없어요');
  } else if (modelAuthState === AUTH_STATE.USABLE && modelHealthState === 'unreachable') {
    limits.push('모델 확인 필요: 모델 서비스에 연결이 안 돼요');
  }
  for (const t of connectedTools) {
    // 목록에 있으나 실행 불가한 도구는 한계로 정직하게 표시한다(헌법 §3-3).
    if (t.connected && !t.executable) limits.push(`${toolLabel(t.id)}: 연결됨, 아직 실행 준비 안 됨`);
    if (!t.connected) limits.push(`${toolLabel(t.id)}: 연결하면 가능`);
  }

  return {
    currentModel: { id: model.id, strengths: model.strengths, limits: model.limits },
    modelAuthState,
    modelHealthState, // 검증 축(P-RT-2): usable|model_missing|unreachable|… / 미검증이면 undefined
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
    modelHealthState: selfState.modelHealthState, // 칩이 "준비됨" 대신 "모델 확인 필요"를 고를 근거
    // 사용자면에는 내부 도구 id 대신 라벨만 노출한다(안티 대시보드, 감사 지적).
    ready: selfState.connectedTools.filter((t) => t.executable).map((t) => toolLabel(t.id)),
    // 모델 입력용: 라벨 + 실제로 하는 일 한 줄. 화면 칩은 위 ready(라벨만)를 그대로 쓴다.
    readyCapabilities: selfState.connectedTools.filter((t) => t.executable).map((t) => toolCapabilityLine(t.id)),
    limits: selfState.limits,
    nextSafeAction: selfState.nextSafeAction,
  };
}
