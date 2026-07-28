// GPAO-T5 Kernel Contracts — 봉인된 GPAO-T5-KERNEL-CONTRACT 를 코드 타입으로 옮긴 것.
// 이 파일은 런타임 코드가 없다. 계약 필드·의미·경계를 JSDoc 타입으로 고정한다.
// 화면·오케스트레이터·런타임은 여기 정의된 계약만 주고받는다(발명 금지).

/**
 * @typedef {'usable'|'billing_blocked'|'rate_limited'|'auth_failed'} ModelAuthState
 * billing_blocked 와 rate_limited 는 반드시 구분한다. billing 은 재시도가 아니라 결제 확인.
 */

/**
 * @typedef {'usable'|'needs_auth'|'needs_config'|'needs_connection'|'blocked'} ToolStatus
 * Phase 5.1(§6): 실행 가능성 세분화. "왜 못 쓰는지"를 담는다. executable은 status===usable의 파생.
 */

/**
 * @typedef {Object} ConnectedTool
 * @property {string} id                 도구·앱 식별자
 * @property {boolean} connected          연결됨 여부
 * @property {ToolStatus} status          실행 가능성 세분화(Phase 5.1 §6)
 * @property {boolean} executable         `status === 'usable'`의 파생(하위호환). 목록에 있다고 실행 가능 아님(헌법 §3-3)
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
 * @property {string} [kind]              권한 종류(read/send/delete…) — 안전 바닥 판정·설명에 쓴다
 * @property {string} action              대상 행동(ActionPlan 항목 참조)
 * @property {boolean} [safetyFloor]      안전 바닥(항상 승인) 여부. Smart라도 자동 승인 불가(P6-15)
 * @property {boolean} approvalRequired   A2·A3(+엄격 모드 A1) 는 true. "원했다"만으로 우회 불가
 * @property {{impact:string, scope:string, duration:string, cancel:string, where?:string, what?:string}} [approvalPreview]
 * @property {{tier:string, needsApproval:boolean, safetyFloor:boolean, why:string, whatChanges:string, reversible:string}} [reason] P6-15: A0-A3 판단을 사용자 언어로(왜/무엇이/되돌릴 수 있나)
 * @property {boolean} granted            실행 직전 게이트. 미승인이면 실행 금지
 * @property {{kind:'once'|'session'|'persist', expiresAt?:number}} [grantScope] 승인 범위·수명(Phase 5.1+). once=이번 한 번, session=이 세션, persist=지속. expiresAt 이후는 만료→재승인
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
 * @typedef {'none'|'failed'|'blocked'|'timeout'|'cancelled'} FailureState
 */

/**
 * @typedef {'none'|'attempting'|'delivered'|'failed'|'abandoned'} ReceiptLifecycle
 * Phase 5.1(§7): 실행·전달 수명주기만. 승인 상태(approved/held)는 여기 아니라 AuthorityGrant 소관.
 */

/**
 * @typedef {Object} ToolReceipt         §7 Tool Execution Truth Ledger 계약
 * @property {string} intended
 * @property {{tool:string, args?:*}|null} actualCall  호출 안 했으면 null
 * @property {*} [result]
 * @property {FailureState} failureState
 * @property {ReceiptLifecycle} lifecycle  실행·전달 수명주기(Phase 5.1 §7). 승인 상태는 불허
 * @property {Array<{sourceUrl:string, fetchedAt:number, title:string, excerptHash:string, confidence:number}>} [sources]  출처 근거(P6-2 Slice-2). 웹 도구는 출처 없이 "확인"을 주장하지 못한다
 * @property {string} userSafeSummary     내부 용어 제외, 사용자면 전용
 * @property {*} [diagnosticTrace]        내부 진단·스택·provider 상태. 사용자면 노출 금지
 * @property {string} [nextSafeAction]
 */

/**
 * @typedef {Object} ScheduledJob        §8.2 Automation 계약(P6-3)
 * @property {string} id
 * @property {{tool:string, args?:*}} action  실행할 도구·인자
 * @property {string} statement
 * @property {'scheduled'|'paused'|'cancelled'|'completed'|'expired'|'failed'} state
 * @property {number} createdAt
 * @property {number} nextRunAt
 * @property {number} [intervalMs]        있으면 반복, 없으면 1회
 * @property {{kind:'once'|'session'|'persist', expiresAt?:number}} grantScope  승인 범위·만료(§3.2)
 * @property {boolean} external           외부 전송 자동화(A2 경계 유지) — descriptor needsApproval에서 파생
 * @property {ToolReceipt[]} executions   AutomationLedger — 세션 TruthLedger와 분리된 자동화 실행 원장
 * @property {number} failureCount        연속 실패 횟수(P6-4). 성공 시 0으로 리셋
 * @property {number} maxAttempts         transient 실패 재시도 상한 — 초과 시 정직하게 failed
 * @property {number} backoffBaseMs       지수 백오프 기준(ms)
 * @property {number} backoffCapMs        백오프 상한(ms) — 무한정 벌어지지 않게
 */

/**
 * @typedef {ToolReceipt[]} AutomationLedger  §8.2 자동화 실행 진실 원장. 세션 TruthLedger와 분리.
 * 세션 밖 백그라운드 실행이라 세션 원장에 섞지 않는다. ToolReceipt 계약을 그대로 쓴다(성공·실패·차단 정직).
 */

/**
 * @typedef {Object} FollowUpEvent       §8 Follow-up Queue 계약
 * @property {string} runningTask
 * @property {string} incomingInput
 * @property {boolean} conflict
 * @property {'interrupt'|'merge'|'queue'|'reprioritize'} decision
 * @property {'none'|'automation'|'retry'|'long_task'} candidateKind  후보 유형(Phase 5.1 §8.1)
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
  CANCELLED: 'cancelled', // P6-2: 사용자·시스템이 실행을 취소(Tool&Connector Seal §3 흡수)
});

/**
 * @typedef {Object} ToolDescriptor      P6-2 Tool 계약(Tool&Connector Seal §1.1 흡수)
 * @property {string} id                  내부 식별자(사용자면 비노출)
 * @property {string} label               사용자 표시명
 * @property {'core'|'plugin'|'channel'|'mcp'} owner  정의 주체(소유)
 * @property {string} executor            실행 주체 참조(소유≠실행 분리)
 * @property {Array<{kind:'auth'|'config'|'env'|'connected'}>} availability  실행 가능 신호(allOf)
 * @property {string} toolKind            권한 종류(read/send/organize…)로 이어짐
 * @property {boolean} [needsApproval]    행동 승인 필요 여부(auth와 분리 — auth≠approval)
 */

// Phase 5.1(§7): ToolReceipt.lifecycle 허용값. 실행·전달만 — 승인(approved/held)은 여기 없다.
export const LIFECYCLE = Object.freeze(['none', 'attempting', 'delivered', 'failed', 'abandoned']);

// Phase 5.1(§6): ConnectedTool.status 허용값.
export const TOOL_STATUS = Object.freeze(['usable', 'needs_auth', 'needs_config', 'needs_connection', 'blocked']);

// Approval Lifecycle: 승인 범위 종류 + 대기 만료. once 만 P5 도달, session/persist는 P6.
export const GRANT_SCOPE = Object.freeze(['once', 'session', 'persist']);
export const APPROVAL_TTL_MS = 30 * 60 * 1000; // 승인 대기 30분 후 만료 → 재승인 요구

/**
 * ApprovalMode (P6-15) — 승인 마찰의 강도. **정책을 느슨하게 하려는 게 아니라 사용자가 덜 헤매게** 하는 표면.
 * 어느 모드도 안전 바닥(SAFETY_FLOOR)을 우회하지 못한다 — 외부 전송·삭제·권한 변경·자동화 활성화·비밀/계정
 * 접근은 항상 승인(A2+). 모드는 저위험(A0/A1)을 얼마나 자연스럽게 통과시키느냐만 조절한다.
 * - manual : 저위험 자연 진행(A0/A1), 그 외 승인. (기존 동작)
 * - smart  : manual과 같되 판단 이유를 사용자 언어로 표면화(기본).
 * - strict : A1(되돌릴 수 있는 로컬 정리)도 확인. A0만 자연 진행.
 * @typedef {'manual'|'smart'|'strict'} ApprovalMode
 */
export const APPROVAL_MODES = Object.freeze(['manual', 'smart', 'strict']);
export const DEFAULT_APPROVAL_MODE = 'smart';

/**
 * P-OP-7 Pass 4 · C7-ACTION-001 — **전송 도구 판정의 단일 기준.**
 * 일반 도구 인자에 `target`이 있다는 이유만으로 sentVia·전달 원장·기본 대상 학습에
 * 편입되어, 로컬 프로세스 확인이 "전달됐어요"로 기록됐다(두 검증선 재현).
 * `target` 필드가 아니라 **현재 도구 현실의 toolKind === 'send'** 만 전송이다.
 * 커널(sentVia)·서버(원장 기록)·재시도·전달 목록이 전부 이 함수 하나로 판정한다.
 * @param {string} toolId
 * @param {{connectedTools?:Array<{id:string,toolKind?:string}>}} selfState
 */
export function isSendTool(toolId, selfState) {
  return selfState?.connectedTools?.find((t) => t.id === toolId)?.toolKind === 'send';
}
