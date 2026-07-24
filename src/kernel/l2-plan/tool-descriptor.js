// L2 · Tool Descriptor + Availability (P6-2, Tool&Connector Seal §1.1·§3 흡수).
// 핵심 원리(복제 아닌 재구성):
//   - 소유(owner)≠실행(executor) 분리.
//   - availability = "왜 실행 가능/불가한지"를 담는 신호(auth|config|env|connected)의 allOf.
//   - auth ≠ approval: availability(로그인·설정·연결)와 needsApproval(행동 승인)은 다른 축이다.
//     "실행할 수 있음"과 "실행해도 됨"을 섞지 않는다(헌법 §3-3 / UX §1.1).
import { FAILURE } from '../contracts.js';

/**
 * ToolDescriptor 생성(계약 형태 고정).
 * @param {Object} d
 * @param {string} d.id
 * @param {string} d.label
 * @param {'core'|'plugin'|'channel'|'mcp'} [d.owner]
 * @param {string} [d.executor]
 * @param {Array<{kind:'auth'|'config'|'env'|'connected'}>} [d.availability]
 * @param {string} [d.toolKind]
 * @param {boolean} [d.needsApproval]
 * @returns {import('../contracts.js').ToolDescriptor}
 */
export function defineTool(d) {
  return {
    id: d.id,
    label: d.label ?? d.id,
    owner: d.owner ?? 'core',
    executor: d.executor ?? d.id,
    availability: d.availability ?? [{ kind: 'connected' }],
    toolKind: d.toolKind ?? 'read',
    needsApproval: d.needsApproval ?? false,
  };
}

/**
 * availability 신호를 환경 사실에 대입해 상태를 판정한다(SelfState.connectedTools.status와 정합).
 * allOf: 하나라도 불만족이면 그 신호의 상태를 돌려준다. 전부 만족이면 usable.
 * @param {import('../contracts.js').ToolDescriptor} descriptor
 * @param {{auth?:boolean, config?:boolean, env?:boolean, connected?:boolean}} facts
 * @returns {'usable'|'needs_auth'|'needs_config'|'needs_connection'|'blocked'}
 */
export function evaluateStatus(descriptor, facts = {}) {
  for (const sig of descriptor.availability ?? []) {
    if (sig.kind === 'connected' && !facts.connected) return 'needs_connection';
    if (sig.kind === 'auth' && !facts.auth) return 'needs_auth';
    if (sig.kind === 'config' && !facts.config) return 'needs_config';
    if (sig.kind === 'env' && !facts.env) return 'blocked'; // env 미충족은 지금 실행 불가
  }
  return 'usable';
}

/**
 * descriptor + 사실 → SelfState가 소비하는 connection 형태. status를 직접 실어 self-state가 그대로 쓴다.
 * @param {import('../contracts.js').ToolDescriptor} descriptor
 * @param {Object} facts
 */
export function toConnection(descriptor, facts = {}) {
  const status = evaluateStatus(descriptor, facts);
  return {
    id: descriptor.id,
    label: descriptor.label,
    connected: status !== 'needs_connection',
    executable: status === 'usable',
    status,
    // auth ≠ approval: 실행 가능해도 승인이 필요할 수 있다(별도 축).
    needsApproval: descriptor.needsApproval,
  };
}

/**
 * 실패 종류를 재시도 성격으로 분류한다(Hermes MCP permanent/transient 흡수).
 * 복구 계층이 "다시 시도할지 / 접어둘지"를 판단하는 힌트. 사용자면 아님.
 * @param {import('../contracts.js').FailureState} failureState
 * @returns {'none'|'permanent'|'transient'}
 */
export function classifyRetry(failureState) {
  switch (failureState) {
    case FAILURE.NONE:
      return 'none';
    case FAILURE.BLOCKED:
    case FAILURE.CANCELLED:
      return 'permanent'; // 차단·취소는 재시도로 풀리지 않는다
    case FAILURE.FAILED:
    case FAILURE.TIMEOUT:
      return 'transient'; // 실패·타임아웃은 backoff 재시도 여지
    default:
      return 'none';
  }
}
