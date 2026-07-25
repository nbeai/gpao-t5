// L2 · CapabilityResolution (2.0-C-0). "이거 해줘" 했는데 능력이 없을 때, T5가 스스로 분류해
// 연결/등록/테스트/승인/대안/복귀 중 하나로 자연스럽게 잇는 **통합 패킷**.
// 최상위 원칙(헌법): 사용자를 덜 헤매게 — 막힘을 목적 달성 경로로 바꾼다. 여러 신호(커넥터·도구·대상·권한)를
// 제각기 카드로 흩지 않고 하나의 패킷으로 묶는다. broad memory, narrow influence(관찰은 넓게, 영향은 좁게).
// 비파괴: 기존 connectionNeeded(2.0-B)·toolCandidate(2.0-C)·send clarify(P6-7)·approval을 근거로 재사용한다.

export const CAPABILITY_TYPES = Object.freeze(['tool', 'skill', 'connector', 'profile', 'target', 'permission']);
export const NEXT_ACTIONS = Object.freeze(['connect', 'install', 'register', 'test', 'clarify', 'approve', 'alternative']);

/**
 * @typedef {Object} CapabilityResolution
 * @property {string} requestText        사용자 원문
 * @property {string} desiredOutcome     원하는 결과(있으면)
 * @property {string} missingCapability  부족한 능력(사용자 언어)
 * @property {'tool'|'skill'|'connector'|'profile'|'target'|'permission'} capabilityType
 * @property {string} currentStatus      지금 상태(사용자 언어)
 * @property {string} reason             왜 막혔는지(사용자 언어)
 * @property {'connect'|'install'|'register'|'test'|'clarify'|'approve'|'alternative'} nextAction
 * @property {boolean} requiresApproval  다음 행동에 승인이 필요한가
 * @property {string|null} testPlan      실행/replay 테스트 계획(있으면)
 * @property {string} resumeContext      원래 작업으로 돌아갈 맥락(원문 보존)
 * @property {string[]} alternatives     대안(있으면)
 * @property {object} ref                UI가 다음 행동에 쓸 식별자(비표시): {toolId} | {label,kind} 등
 */

/** 통합 패킷 생성(정규화·기본값). resumeContext는 원래 작업 복귀 경로다(비우지 않는다). */
export function makeCapabilityResolution(p) {
  return {
    requestText: p.requestText ?? '',
    desiredOutcome: p.desiredOutcome ?? '',
    missingCapability: p.missingCapability ?? '',
    capabilityType: p.capabilityType,
    currentStatus: p.currentStatus ?? '',
    reason: p.reason ?? '',
    nextAction: p.nextAction,
    requiresApproval: Boolean(p.requiresApproval),
    testPlan: p.testPlan ?? null,
    resumeContext: p.resumeContext ?? p.requestText ?? '',
    alternatives: Array.isArray(p.alternatives) ? p.alternatives : [],
    ref: p.ref ?? {},
  };
}

/**
 * 턴의 부족-능력 신호 → 통합 패킷(첫 신호 하나만, 누더기 방지). 없으면 null.
 * 우선순위: permission(승인) > connector(연결) > tool(등록) > target(대상 확인). skill/profile은 후속.
 * @param {{text:string, desiredOutcome?:string, permission?:object, connectionNeeded?:object,
 *          toolCandidate?:object, sendClarify?:{reason:string, label:string}}} s
 * @returns {CapabilityResolution|null}
 */
export function resolveCapability(s = {}) {
  const text = s.text ?? '';
  const desiredOutcome = s.desiredOutcome ?? '';

  if (s.permission) {
    return makeCapabilityResolution({
      requestText: text, desiredOutcome, capabilityType: 'permission',
      missingCapability: s.permission.label ?? '외부 실행 승인',
      currentStatus: '승인 필요', reason: '외부로 나가는 행동이라 실행 전에 확인이 필요해요.',
      nextAction: 'approve', requiresApproval: true, resumeContext: text,
      ref: { action: s.permission.action },
    });
  }
  if (s.connectionNeeded) {
    return makeCapabilityResolution({
      requestText: text, desiredOutcome, capabilityType: 'connector',
      missingCapability: s.connectionNeeded.label,
      currentStatus: '연결 필요', reason: '이 작업에 필요한 연결이 아직 안 됐어요.',
      nextAction: 'connect', requiresApproval: false,
      resumeContext: s.connectionNeeded.requestText ?? text,
      ref: { toolId: s.connectionNeeded.toolId },
    });
  }
  if (s.toolCandidate) {
    return makeCapabilityResolution({
      requestText: text, desiredOutcome, capabilityType: 'tool',
      missingCapability: s.toolCandidate.label,
      currentStatus: '준비 전', reason: '이 일을 하려면 개인 도구를 준비해야 해요.',
      nextAction: 'register', requiresApproval: false, testPlan: '설정 확인',
      resumeContext: s.toolCandidate.requestText ?? text,
      ref: { label: s.toolCandidate.label, kind: s.toolCandidate.kind },
    });
  }
  if (s.sendClarify) {
    return makeCapabilityResolution({
      requestText: text, desiredOutcome, capabilityType: 'target',
      missingCapability: s.sendClarify.reason === 'no_message' ? '보낼 내용' : '보낼 대상',
      currentStatus: '확인 필요',
      reason: s.sendClarify.reason === 'no_message' ? '무엇을 보낼지 아직 정해지지 않았어요.' : '어디로 보낼지 아직 정해지지 않았어요.',
      nextAction: 'clarify', requiresApproval: false, resumeContext: text,
      ref: { toolId: s.sendClarify.toolId },
    });
  }
  return null;
}
