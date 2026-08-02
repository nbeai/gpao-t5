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
 * @param {boolean} [d.reversible]   실행을 되돌릴 수 있는가 — **도구가 아는 사실**이다. 종류로 추측하면
 *   거짓말이 된다(로컬 삭제는 휴지통으로 가서 되돌릴 수 있는데 카드가 "되돌릴 수 없음"이라 했다).
 * @param {string} [d.reversibleNote]  되돌리는 방법 한 줄(사용자 말)
 * @param {{description:string, parameters:object}} [d.schema]  모델이 **직접 고를 수 있게** 보여줄
 *   스키마. 없으면 모델에게 노출하지 않는다 — 고를 수 없는 도구를 보여주면 되는 줄 알고 약속한다.
 *   (오너 실사용: `session.search` 가 이 자리에 없어서 "그 기능은 없습니다"라고 답했다.)
 * @param {string} [d.capability]  이 도구가 **실제로 하는 일** 한 줄(사용자 말). 라벨만 주면 모델이
 *   그럴듯한 하위 기능을 지어낸다(오너 실사용: 미구현 기능 세 개를 약속했다). 구현과 함께 갱신한다.
 * @param {string} [d.operatorFact]  T5가 사용자 대신 맡을 수 있는 운영 사실. 능력 설명과 달리
 *   짧고, 현재 손을 고르는 판단 재료로만 쓴다. 경로나 순서를 처방하지 않는다.
 * @param {string} [d.readReach]  **이 손이 어디까지 볼 수 있는가**(사용자 말 한 줄).
 *   P0-b(오너 결정 2026-08-02 · 능력 유지 + 고지): 파일 손은 작업 폴더 안만 다루지만
 *   터미널 손은 이 컴퓨터에서 읽을 수 있는 자리를 본다 — 그게 있어야 "폴더를 복사해 오세요"
 *   같은 떠넘김이 안 생긴다(recovery-ladder out_of_scope 계약). 능력을 줄이지 않는 대신
 *   **그 사실을 사용자에게 숨기지 않는다.** 작업 폴더보다 넓게 읽는 손은 이 칸을 채운다.
 *   문구를 주입하는 자리가 아니라 손이 자기 사실을 선언하는 자리다(§24: 무슨 말을 할지는 모델이 정한다).
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
    reversible: d.reversible,           // 미선언은 undefined — 모르면 안전하게 "어려울 수 있다"로 말한다
    reversibleNote: d.reversibleNote,
    capability: d.capability,           // 없으면 라벨만 말한다 — 없는 설명을 지어내지 않는다
    operatorFact: d.operatorFact,
    readReach: d.readReach,             // 작업 폴더보다 넓게 읽는 손의 **고지 사실**(P0-b)
    // P5-B-0: **어느 서비스의 손인가.** 커넥터가 도구 목록을 손으로 들면(availableTools) 손발이
    // 늘거나 줄 때 또 어긋난다 — `선언 ⊆ 손` 이 이미 목록으로 새어 본 자리다. 방향을 뒤집는다:
    // 도구가 자기 서비스를 말하고, 커넥터의 도구 목록은 **거기서 파생**된다.
    connector: d.connector,
    // 능력 설명이 "못 한다"고 말하면 **그 한계를 여기 선언한다.** 그래야 게이트가
    // "이미 다른 손이 하고 있는 일을 못 한다고 말하는가"를 검사할 수 있다(§3-④ 반대 방향).
    limits: d.limits,
    schema: d.schema,                   // 없으면 모델에게 안 보인다(고를 수 없는 것을 보여주지 않는다)
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
  const has = (kind) => (descriptor.availability ?? []).some((s) => s.kind === kind);
  // 배열 순서에 의존하지 않도록 고정 우선순위(connected 먼저)로 판정한다(감사 보정).
  if (has('connected') && !facts.connected) return 'needs_connection';
  if (has('auth') && !facts.auth) return 'needs_auth';
  if (has('config') && !facts.config) return 'needs_config';
  if (has('env') && !facts.env) return 'blocked'; // env 미충족은 지금 실행 불가
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
    // 권한 종류를 SelfState까지 실어 보낸다(ActionPlan·send 분리가 descriptor toolKind를 먼저 믿게).
    toolKind: descriptor.toolKind,
    // 되돌리기 가능 여부도 함께. 여기서 떨어뜨리면 승인 카드가 다시 종류로 **추측**하게 된다.
    reversible: descriptor.reversible,
    reversibleNote: descriptor.reversibleNote,
    // P5-B-0.5: **소속을 끝까지 들고 간다.** 여기서 떨어뜨리면 커넥터가 자기 도구를 못 찾아
    // 연결돼 있는데도 "연결 안 됨"으로 말한다 — 검사가 실제로 그걸 잡았다.
    connector: descriptor.connector,
    capability: descriptor.capability,  // 능력 문장도 descriptor 가 진실이다(수동 맵 금지)
    operatorFact: descriptor.operatorFact,
    readReach: descriptor.readReach,    // 고지 사실도 손 이름과 함께 끝까지 간다(P0-b)
    limits: descriptor.limits,          // 선언된 한계 — 손 이름과 함께 다녀야 하는 사실
    schema: descriptor.schema,          // 모델 노출도 같은 선언에서 나온다
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
