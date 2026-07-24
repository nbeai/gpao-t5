// GPAO-T5 Kernel Contracts — 봉인된 GPAO-T5-KERNEL-CONTRACT 를 코드 타입으로 옮긴 것.
// 이 파일은 런타임 코드가 없다. 계약 필드·의미·경계를 JSDoc 타입으로 고정한다.
// 화면·오케스트레이터·런타임은 여기 정의된 계약만 주고받는다(발명 금지).

/**
 * @typedef {'usable'|'billing_blocked'|'rate_limited'|'auth_failed'} ModelAuthState
 * billing_blocked 와 rate_limited 는 반드시 구분한다. billing 은 재시도가 아니라 결제 확인.
 */

/**
 * @typedef {Object} ConnectedTool
 * @property {string} id                 도구·앱 식별자
 * @property {boolean} connected          연결됨 여부
 * @property {boolean} executable         지금 실제 실행 가능 여부(목록에 있다고 실행 가능 아님, 헌법 §3-3)
 * @property {string} [note]              사용자용 짧은 상태 메모
 */

/**
 * @typedef {Object} SelfStateSnapshot   §6 Operational Selfhood 계약
 * @property {{id:string, strengths?:string, limits?:string}} currentModel
 * @property {ModelAuthState} modelAuthState
 * @property {ConnectedTool[]} connectedTools
 * @property {string[]} grantedAuthorities
 * @property {string[]} [riskyActions]
 * @property {string[]} limits            못 하는 것과 그 이유
 * @property {string} [nextSafeAction]    막다른 답 대신 제시할 다음 안전 행동
 */

/**
 * @typedef {'A0'|'A1'|'A2'|'A3'} AuthorityTier
 * A0 즉시 자동 / A1 조용한 확인·되돌릴 수 있는 자동 / A2 짧은 승인 / A3 강한 승인 또는 차단
 */

/**
 * @typedef {Object} IntentPacket        §2 말귀 / Input Kernel 계약
 * @property {string} currentRequest      사용자 원문(보존, 왜곡 금지)
 * @property {string[]} [relatedContext]  admitted context 만
 * @property {string} desiredOutcome      방법이 아니라 목적
 * @property {string} [unwantedRisk]
 * @property {string[]} [neededTools]     후보만. 실행 가능 판정은 SelfState
 * @property {AuthorityTier} authorityBoundary  예상 권한 경계
 * @property {'fast_chat'|'complex_work'} answerMode
 * @property {boolean} needsClarification  true 면 실행 전 멈추고 묻는다
 */

/**
 * @typedef {Object} AuthorityGrant      §3 권한 계약
 * @property {AuthorityTier} tier
 * @property {string} action              대상 행동(ActionPlan 항목 참조)
 * @property {boolean} approvalRequired   A2·A3 는 true. "원했다"만으로 우회 불가
 * @property {{impact:string, scope:string, duration:string, cancel:string}} [approvalPreview]
 * @property {boolean} granted            실행 직전 게이트. 미승인이면 실행 금지
 * @property {{kind:string}} [grantScope] "이번 한 번" / "이 세션" / "지속"
 * @property {boolean} revocable
 */

/**
 * @typedef {Object} ActionPlan          §4 ActionPlan / Authority Kernel 계약
 * @property {string} understoodTask
 * @property {string[]} [contextToUse]    admitted context 만
 * @property {string[]} toolsToUse        SelfState 가 실행 가능 판정한 것만
 * @property {string[]} autoAllowed       A0·A1
 * @property {AuthorityGrant[]} needsApproval  A2·A3
 * @property {string[]} forbidden
 * @property {string} successCriteria
 * @property {string} recoveryCriteria
 */

/**
 * @typedef {'none'|'failed'|'blocked'|'timeout'} FailureState
 */

/**
 * @typedef {Object} ToolReceipt         §7 Tool Execution Truth Ledger 계약
 * @property {string} intended
 * @property {{tool:string, args?:*}|null} actualCall  호출 안 했으면 null
 * @property {*} [result]
 * @property {FailureState} failureState
 * @property {string} userSafeSummary     내부 용어 제외, 사용자면 전용
 * @property {*} [diagnosticTrace]        내부 진단·스택·provider 상태. 사용자면 노출 금지
 * @property {string} [nextSafeAction]
 */

/**
 * @typedef {Object} FollowUpEvent       §8 Follow-up Queue 계약
 * @property {string} runningTask
 * @property {string} incomingInput
 * @property {boolean} conflict
 * @property {'interrupt'|'merge'|'queue'|'reprioritize'} decision
 * @property {string} userNotice
 */

/**
 * @typedef {Object} TaskContextPacket   §11 LLM-ready Task Context Packet(모델 입력 계약)
 * @property {string} currentRequest      원문 보존
 * @property {Object} selfStateFacts      사실만, 지시문 금지
 * @property {string[]} admittedContext
 * @property {Object} authorityFacts      무엇이 자동/승인필요/금지
 * @property {'fast_chat'|'complex_work'} answerMode
 * @property {string} naturalness         과잉 통제 금지 규칙 표식
 */

// 값이 필요한 곳을 위한 열거 상수(문자열 리터럴 오타 방지).
export const AUTH_STATE = Object.freeze({
  USABLE: 'usable',
  BILLING_BLOCKED: 'billing_blocked',
  RATE_LIMITED: 'rate_limited',
  AUTH_FAILED: 'auth_failed',
});

export const TIER = Object.freeze({ A0: 'A0', A1: 'A1', A2: 'A2', A3: 'A3' });

export const FAILURE = Object.freeze({
  NONE: 'none',
  FAILED: 'failed',
  BLOCKED: 'blocked',
  TIMEOUT: 'timeout',
});
