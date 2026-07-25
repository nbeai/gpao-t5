// L2 · ChannelRegistry (P6-16 Slice-1) — 채널/커넥터를 한 곳으로 정리한다.
// **새 기능이 아니라 이미 만든 것을 덜 헤매게 묶는 정리 작업.** 재사용:
//   - connector-profile: 자격(authState)·readiness·전송 승인(auth ≠ approval) — 단일 진실
//   - inbound-gate: mention/allowlist/DM 결정적 게이팅(정책은 여기 선언, 게이팅은 게이트가 수행)
// 이 슬라이스는 registry + 사용자 언어 status + doctor 진단까지. **실제 외부 전송·설정 변경은 하지 않는다.**
// 경계: connected ≠ approved(전송은 항상 A2), 미연결·미자격은 절대 "준비됨(초록)"으로 보이지 않는다.

import { connectorReadiness, sendNeedsApproval } from './connector-profile.js';

// 인바운드 정책(선언) — 어떤 신호에 턴을 여는지. 실제 게이팅은 inbound-gate가 결정적으로 수행한다(중복 아님).
export const INBOUND_POLICIES = Object.freeze(['mention_required', 'dm_open', 'allowlist_only']);

/**
 * 채널 정의(선언형). connector(자격) + inbound 정책 + outbound 도구 + 라벨을 한 서술자로 묶는다.
 * outbound 도구는 **바인딩만** — 이 슬라이스는 실제 전송을 하지 않는다.
 * @param {Object} p
 * @param {string} p.id
 * @param {string} [p.label]
 * @param {{id:string,label:string,authState:string,connected:boolean}} p.connector  connector-profile
 * @param {'mention_required'|'dm_open'|'allowlist_only'} [p.inboundPolicy]
 * @param {string|null} [p.outboundTool]  이 채널로 보낼 때 쓰는 send 도구 id(바인딩)
 */
export function defineChannel(p) {
  return {
    id: p.id,
    label: p.label ?? p.connector?.label ?? p.id,
    connector: p.connector ?? { id: p.id, label: p.id, authState: 'none', connected: false },
    inboundPolicy: p.inboundPolicy ?? 'mention_required',
    outboundTool: p.outboundTool ?? null,
  };
}

// 내부 readiness(생존성 코드) → 사용자 언어 상태. **ok(초록)은 정말 받을 준비가 됐을 때만.**
const STATUS_VIEW = {
  ok:           { status: 'ready',            userSafe: '받을 준비가 됐어요.' },
  needs_auth:   { status: 'needs_auth',       userSafe: '로그인·토큰을 넣어야 받을 수 있어요.' },
  degraded:     { status: 'degraded',         userSafe: '연결이 불안정해요. 잠시 후 다시 해볼게요.' },
  disconnected: { status: 'needs_connection', userSafe: '아직 연결 안 됐어요. 연결하면 받을 수 있어요.' },
};

// doctor — 무엇이 문제고 사용자가 뭘 하면 되는지(개발자식 코드 아님, 사용자 언어).
function channelDiagnosis(readiness, label) {
  switch (readiness) {
    case 'ok': return { ok: true, nextAction: null, detail: `${label}에서 오는 메시지를 받을 수 있어요.` };
    case 'needs_auth': return { ok: false, nextAction: 'authenticate', detail: `${label} 로그인·토큰을 넣어 주세요.` };
    case 'degraded': return { ok: false, nextAction: 'retry', detail: `${label} 연결이 불안정해요. 잠시 후 다시 해주세요.` };
    default: return { ok: false, nextAction: 'connect', detail: `${label}을(를) 먼저 연결해 주세요.` };
  }
}

/**
 * 채널의 사용자 안전 상태 + doctor 진단. 내부 readiness 코드 대신 사용자 언어로.
 * connected ≠ approved: 준비됐어도 전송은 항상 승인(sendNeedsApproval=true).
 * @param {ReturnType<typeof defineChannel>} channel
 */
export function channelStatus(channel) {
  const readiness = connectorReadiness(channel.connector ?? { connected: false, authState: 'none' });
  const view = STATUS_VIEW[readiness] ?? STATUS_VIEW.disconnected;
  return {
    id: channel.id,
    label: channel.label,
    status: view.status,          // UI 로직용 enum
    ready: readiness === 'ok',    // 초록은 이 값이 true일 때만 — 미연결·미자격은 절대 초록 아님
    userSafe: view.userSafe,      // 사용자 언어 상태
    inboundPolicy: channel.inboundPolicy,
    outboundTool: channel.outboundTool,
    sendNeedsApproval: sendNeedsApproval(), // 연결됨 ≠ 보내도 됨(항상 A2)
    diagnosis: channelDiagnosis(readiness, channel.label), // doctor: 다음 안전 행동
  };
}

/** 레지스트리 전체를 사용자 안전 뷰로 투영(채널 표면·doctor). */
export function projectChannels(channels) {
  return (channels ?? []).map(channelStatus);
}
