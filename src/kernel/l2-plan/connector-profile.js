// L2 · ConnectorProfile (P6-2 Slice-3, Tool&Connector Seal §2·§3 흡수).
// 채널/provider를 선언형 프로필로. 핵심 경계:
//   - auth ≠ approval: 연결·인증됨(authState)이 곧 "보내도 됨"이 아니다. 외부 전송은 항상 승인(A2, 헌법 §3-6).
//   - 채널이 달라도 같은 OS 흐름을 탄다(단일 정규화 이벤트 → InboundEventGate → turn).
//   (Hermes NAS/relay/connector 와이어·config는 복제하지 않는다 — 원리·상태언어만.)

// 자격 상태(로그인·인증 축). Hermes auth_type 흡수.
// none = 인증이 필요 없는 커넥터(공개). "인증 미설정"이 아니다 — 미설정 구분은 다음 slice의 requiresAuth로.
export const AUTH_STATES = Object.freeze(['none', 'api_key', 'oauth', 'session']);
// 준비 상태(연결 생존성 축).
export const READINESS = Object.freeze(['ok', 'degraded', 'needs_auth', 'disconnected']);

/**
 * ConnectorProfile 생성(선언형 — 클라이언트 구성·자격 회전은 소유하지 않음).
 * @param {Object} p
 * @param {string} p.id
 * @param {string} p.label
 * @param {'channel'|'provider'} [p.kind]
 * @param {'none'|'api_key'|'oauth'|'session'} [p.authState]
 * @param {boolean} [p.connected]
 */
export function defineConnector(p) {
  return {
    id: p.id,
    label: p.label ?? p.id,
    kind: p.kind ?? 'channel',
    authState: p.authState ?? 'none',
    connected: p.connected ?? false,
    // ── P5-B-0 진실층 최소판 ───────────────────────────────────────────────
    // **커넥터는 자기만 아는 것을 든다**: 이 서비스가 무엇이고, 어떤 연결·자격·설정이 필요한가.
    // 도구 목록과 승인 정책은 **여기 두지 않는다** — 도구 층(ToolDescriptor·handler·
    // toolActionKind·needsApproval)에서 파생한다. 양쪽에 두면 승인의 진실이 둘이 되고,
    // 그게 이 층을 만든 이유 그 자체다(2026-07-27 하루에 두 진실 사고가 세 번 났다).
    category: p.category,               // 'channel' | 'mail' | 'commerce' | 'calendar' …
    // **사용자가 부르는 말.** 말귀가 별도 목록을 들면 커넥터가 늘 때 또 어긋난다 —
    // 커넥터가 자기 별칭을 든다(P5-B-0.5).
    aliases: p.aliases ?? [],
    userJobs: p.userJobs ?? [],          // 사용자 말로 "이걸로 뭘 할 수 있나"
    requiredSetup: p.requiredSetup ?? [],// 연결 전에 사용자가 갖춰야 하는 것(사람 말)
    scopes: p.scopes ?? [],              // 요청할 권한 범위
    limits: p.limits ?? [],              // 이 서비스로도 못 하는 것(정직한 한계)
    setupGuide: p.setupGuide,            // 연결 방법 한 줄(사람 말)
    localeRelevance: p.localeRelevance,  // 'kr' 등 — 한국 사용자에게 얼마나 가까운가
    lastCheckedAt: p.lastCheckedAt,      // 마지막 연결 확인 시각(추측 금지)
    lastError: p.lastError,              // 마지막 실패 이유(사람 말)
  };
}

/**
 * 준비 상태 판정(연결 생존성). 연결 안 됨 / 인증 필요 / ok를 분리한다(auth와 별개 축).
 * @param {{connected:boolean, authState:string}} profile
 * @returns {'ok'|'degraded'|'needs_auth'|'disconnected'}
 */
export function connectorReadiness(profile) {
  if (!profile.connected) return 'disconnected';
  // oauth/api_key/session 인데 자격이 비어 있으면 needs_auth. 여기선 authState=none이 아닌데
  // 연결만 된 경우를 needs_auth로 본다(자격 미확립). 실제 자격 유무는 P6 실연동에서.
  if (profile.authState !== 'none' && profile.authState !== 'oauth' && profile.authState !== 'session' && profile.authState !== 'api_key') {
    return 'needs_auth';
  }
  return 'ok';
}

/**
 * 외부 전송은 항상 승인 필요(auth≠approval). 연결·인증됐다고 자유롭게 못 보낸다(헌법 §3-6).
 * @returns {true}
 */
export function sendNeedsApproval() {
  return true;
}

/**
 * ConnectorProfile → SelfState가 소비하는 connection 형태(채널을 연결 상태로 표시).
 * 실행 가능성(status)과 전송 승인(needsApproval)을 두 축으로 실어 보낸다.
 * @param {{id:string, label:string, connected:boolean, authState:string}} profile
 */
export function connectorToConnection(profile) {
  const readiness = connectorReadiness(profile);
  const status = readiness === 'disconnected' ? 'needs_connection'
    : readiness === 'needs_auth' ? 'needs_auth'
      : 'usable';
  return {
    id: profile.id,
    label: profile.label,
    connected: profile.connected,
    status,
    executable: status === 'usable',
    needsApproval: sendNeedsApproval(), // 전송은 A2 — 연결됨이 곧 보내도 됨 아님
    toolKind: 'send',
    kind: 'connector',
  };
}
