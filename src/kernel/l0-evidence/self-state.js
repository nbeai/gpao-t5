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
 * **P5-B-0 진실층: 상태는 enum 하나가 아니라 두 축이다.**
 *
 *   ① 지금 실행 가능한가 (executable: boolean)
 *   ② 아니라면 왜인가     (reason)
 *
 * 왜 나누는가: 하나의 enum 으로 두면 소비자 다섯(selfState·도구함·model schema·능력 문장·
 * 연결 센터)이 **각자 여러 값을 해석해야 하고 반드시 어긋난다.** 2026-07-27 하루에만 그
 * 어긋남이 세 번 났다(능력 문장↔schema, 승인 카드↔인자, 보고↔원장). 두 축이면 불변식이
 * 한 줄로 끝난다: **model tool schema ⊆ executable:true.** 이유가 늘어도 그 줄은 안 바뀐다.
 *
 * **손 없음이 최우선이다.** 자격이 채워져도 실행할 손이 없으면 실행 가능이 아니다 —
 * `mail.send` 가 정확히 그랬다(descriptor 는 있고 handler 는 어디에도 없다). 예전엔
 * `auth:false` 덕에 **우연히** schema 에서 빠져 있었을 뿐이라, 누가 자격만 채우면 곧바로
 * "없는 손을 있다고 말하는 도구"가 됐다. 우연이 아니라 구조로 막는다.
 *
 * @param {{connected?:boolean, executable?:boolean, needs?:string, status?:string, hasHandler?:boolean}} t
 * @returns {{executable:boolean, reason?:'needs_connection'|'needs_setup'|'needs_permission'|'planned'|'disabled'|'error'}}
 */
export function toolReality(t = {}) {
  const status = t.status ?? deriveToolStatus(t);
  // 손이 없다는 사실이 자격보다 깊다. 연결해도 실행할 것이 없으면 "연결하면 가능"이 거짓이 된다.
  if (t.hasHandler === false) return { executable: false, reason: 'planned' };
  if (t.disabled === true) return { executable: false, reason: 'disabled' };
  if (status === 'usable') return { executable: true };
  return {
    executable: false,
    reason: status === 'needs_auth' ? 'needs_permission'
      : status === 'needs_config' ? 'needs_setup'
        : status === 'needs_connection' ? 'needs_connection'
          : 'error', // blocked = 연결됐는데 실행 불가(사유 미상) — 확인 실패로 다룬다
  };
}

/** 실행 불가 이유를 **사용자 말로**. 내부 값이 화면·모델 입력에 그대로 새지 않게. */
export function reasonLabel(reason) {
  switch (reason) {
    case 'needs_connection': return '연결하면 가능해요';
    case 'needs_setup': return '설정을 마치면 가능해요';
    case 'needs_permission': return '권한을 주면 가능해요';
    case 'planned': return '아직 준비 중이에요(연결 흐름이 생기면 가능해져요)';
    case 'disabled': return '꺼두셨어요';
    case 'error': return '최근 확인에 실패했어요';
    default: return undefined;
  }
}

/**
 * @param {Object} env
 * @param {{id:string, strengths?:string, limits?:string, authSignal?:string}} env.model
 * @param {import('../contracts.js').ConnectedTool[]} [env.connections]
 * @param {string[]} [env.grantedAuthorities]
 * @returns {import('../contracts.js').SelfStateSnapshot}
 */
export function buildSelfState(env, deps = {}) {
  const model = env.model ?? { id: 'unknown' };
  const modelAuthState = classifyModelAuth(model.authSignal);
  // P5-B-0: **손이 있는지는 도구 레지스트리가 안다.** env 가 따로 관리하면 두 진실이 되고,
  // 어긋난 쪽이 모델에게 노출된다(demo 에서 `local.terminal` 등 셋이 실제로 그랬다).
  // 레지스트리를 받으면 그것이 진실이고, 없으면 env 가 실어 보낸 `hasHandler` 를 쓴다.
  const hands = deps.tools?.tools ? new Set(Object.keys(deps.tools.tools)) : undefined;
  const connectedTools = (env.connections ?? []).map((t) => {
    const hasHandler = hands ? hands.has(t.id) : t.hasHandler;
    // descriptor가 availability로 이미 판정한 status를 존중한다(P6-2). 없으면 파생(하위호환).
    const status = t.status ?? deriveToolStatus(t);
    // P5-B-0: 실행 가능성과 그 이유를 **한 곳에서** 판정한다(toolReality). 아래 소비자들은
    // 이 두 필드만 보면 되고, 새 이유가 생겨도 소비자를 고치지 않는다.
    const reality = toolReality({ ...t, status, hasHandler });
    return {
      id: t.id,
      // 1축: **이름은 descriptor 가 진실이다.** 여기서 흘리면 화면·승인 카드가 이름을 다시
      // 손으로 관리하게 된다 — 실제로 그래서 tool-labels.js 의 LABELS 맵이 생겼다(두 진실).
      label: t.label,
      connected: Boolean(t.connected),
      status, // Phase 5.1: usable|needs_auth|needs_config|needs_connection|blocked
      // **2축 진실(P5-B-0).** executable 은 model schema 노출의 유일한 기준이고,
      // reason 은 "왜 아직 아닌가"만 말한다. 손이 없으면 자격과 무관하게 실행 불가다.
      executable: reality.executable,
      reason: reality.reason,
      hasHandler,
      // P6-2 감사 보정: "실행 가능"과 "실행해도 됨"의 두 축을 끝까지 보존한다. descriptor의
      // needsApproval(행동 승인)·toolKind(권한 종류)를 버리지 않고 ActionPlan이 참조하게 실어 보낸다.
      needsApproval: t.needsApproval,
      toolKind: t.toolKind,
      reversible: t.reversible,           // 승인 카드가 사실대로 말하게(추측 금지)
      reversibleNote: t.reversibleNote,
      // 1축: **이름과 하는 일은 descriptor 가 진실이다.** 여기서 흘리면 커널이 알 길이 없어
      // 손으로 관리하는 맵이 생긴다 — 실제로 그래서 LABELS·CAPABILITIES 두 맵이 있었다.
      label: t.label,
      connector: t.connector,          // 어느 서비스의 손인가(커넥터 진실층이 여기서 파생한다)
      capability: t.capability,
      operatorFact: t.operatorFact,
      limits: t.limits,               // 선언된 한계(이름과 함께 다닌다)
      schema: t.schema,                   // 모델에게 보여줄 스키마도 descriptor 파생
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
    // P5-B-0: **왜 못 쓰는지를 이유에서 말한다.** 예전엔 연결 여부만 보고 "연결하면 가능"이라
    // 썼는데, 손이 아예 없는 도구(mail.send)에 그 문장이 붙으면 거짓 약속이 된다 —
    // 연결해도 실행할 것이 없기 때문이다.
    if (!t.executable) limits.push(`${t.label ?? t.id}: ${reasonLabel(t.reason) ?? '지금은 쓸 수 없어요'}`);
  }

  return {
    currentModel: { id: model.id, strengths: model.strengths, limits: model.limits },
    modelAuthState,
    modelHealthState, // 검증 축(P-RT-2): usable|model_missing|unreachable|… / 미검증이면 undefined
    connectedTools,
    grantedAuthorities: env.grantedAuthorities ?? [],
    // 지금 **실행 가능한 손** 가운데 확인이 필요한 것만. 연결도 안 된 손을 위험 목록에
    // 섞으면 사용자는 없는 기능의 승인을 걱정하게 된다. descriptor가 가진 동일 사실에서 파생한다.
    riskyActions: connectedTools
      .filter((t) => t.executable && t.needsApproval)
      .map((t) => t.label ?? t.id),
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
    ready: selfState.connectedTools.filter((t) => t.executable).map((t) => t.label ?? t.id),
    // 모델 입력용: 라벨 + 실제로 하는 일 한 줄. 화면 칩은 위 ready(라벨만)를 그대로 쓴다.
    readyCapabilities: selfState.connectedTools.filter((t) => t.executable).map((t) => toolCapabilityLine(t.id, selfState)),
    approvalRequired: selfState.riskyActions ?? [],
    limits: selfState.limits,
    nextSafeAction: selfState.nextSafeAction,
  };
}
