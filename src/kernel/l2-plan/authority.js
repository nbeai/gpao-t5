// L2 · AuthorityGrant (권한 계약, §3) — A0-A3 분류와 실행 직전 게이트.
// UI 는 권한을 부여하지 않고 결정을 보여 주고 승인을 받는다(헌법 §3-1).
// "사용자가 원했다"만으로 A2·A3 우회 불가(헌법 §3-6).
// P6-15 Smart Approval: 승인 모드(manual/smart/strict)는 **저위험을 얼마나 자연스럽게 통과시키느냐만** 조절한다.
//   어느 모드도 안전 바닥(SAFETY_FLOOR)을 우회하지 못한다. 그리고 판단 이유를 사용자 언어로 설명한다(정책 불변).
import { TIER, DEFAULT_APPROVAL_MODE } from '../contracts.js';

// kind 누락·미상은 **자동 진행 금지**로 취급한다(감사 blocker). "권한 종류가 비어 있는 것"도 안전하지 않은 것 —
//   allowlist에 없고 classifyTier가 A2로 올려 auto가 새지 않는다. read로 흘리지 않는다.
export const UNKNOWN_KIND = 'unknown_kind';

/**
 * 안전 바닥(Safety Floor) — 모드와 무관하게 **항상 승인(A2+)**. Smart라도 자동 승인 금지.
 * 외부 전송·SaaS 쓰기·자동화 활성화·장기 기억 승격·삭제·결제·게시·민감 내보내기·권한 상승/변경·비밀/계정 접근.
 * 이 집합은 tier 분류가 흔들려도 auto-grant를 막는 독립 불변식이다(방어적 이중화).
 */
export const SAFETY_FLOOR_KINDS = Object.freeze([
  'send', 'write', 'automate', 'promote_memory',
  'delete', 'pay', 'publish', 'export_sensitive', 'escalate',
  'grant_permission', 'access_secret', 'connect_account',
]);

/** 이 행동이 안전 바닥인가(항상 승인). */
export function isSafetyFloor(kind) {
  return SAFETY_FLOOR_KINDS.includes(kind);
}

/**
 * 행동의 비가역성·외부성으로 등급을 판정한다. 애매하면 높은 등급으로.
 * @param {Object} action
 * @param {string} action.kind   read|summarize|search|draft|organize|send|write|publish|delete|pay|promote_memory|
 *                               automate|grant_permission|access_secret|connect_account
 * @returns {import('../contracts.js').AuthorityTier}
 */
export function classifyTier(action) {
  const kind = action?.kind ?? UNKNOWN_KIND;
  switch (kind) {
    case 'delete':
    case 'pay':
    case 'publish':
    case 'export_sensitive':
    case 'escalate':
    case 'grant_permission': // 권한 변경/상승
      return TIER.A3;
    case 'send':
    case 'write':          // SaaS 쓰기
    case 'automate':       // 자동화 활성화
    case 'promote_memory': // 장기 기억 승격
    case 'access_secret':  // 비밀 접근
    case 'connect_account':// 계정 접근/연결
      return TIER.A2;
    case 'organize':       // 되돌릴 수 있는 로컬 정리
    case 'title':
    case 'archive':
      return TIER.A1;
    case 'read':
    case 'summarize':
    case 'search':
    case 'draft':
      return TIER.A0;
    default:
      // 애매하면 높은 등급. 모르는 kind(새 도구·플러그인·커넥터의 toolKind)를 A0로 흘리지 않는다 —
      // Smart Approval에서 unknown 자동 진행은 안전 바닥 철학과 정면으로 어긋난다(감사 blocker).
      return TIER.A2;
  }
}

// 자동 진행 저위험 allowlist — **명시된 것만** 자연 진행한다. 모르는 kind는 여기에 없으므로 자동 진행 안 함.
//   tier가 낮게 나와도(회귀·오분류) 이 allowlist가 독립적으로 auto를 막는다(안전 바닥과 같은 방어적 이중화).
export const AUTO_SAFE_KINDS = Object.freeze({
  always: ['read', 'summarize', 'search', 'draft'],   // A0 — 모든 모드 자연 진행(읽기·요약·검색·초안)
  reversibleLocal: ['organize', 'title', 'archive'],  // A1 — manual/smart 진행, strict는 확인
});

/**
 * 승인 없이 자연 진행할지 결정한다(모드 인지). **안전 바닥은 어느 모드에서도 자동 진행하지 않는다** —
 * tier 검사보다 먼저 걸러 tier 분류가 낮게 회귀해도 새지 않게 한다(독립 불변식).
 * @param {Object} action  {kind}
 * @param {import('../contracts.js').ApprovalMode} [mode]
 * @returns {boolean} true면 승인 없이 진행(저위험).
 */
export function decideAutoGrant(action, mode = DEFAULT_APPROVAL_MODE) {
  const kind = action?.kind ?? UNKNOWN_KIND;
  if (isSafetyFloor(kind)) return false;                      // 안전 바닥 — 모드 무관 항상 승인(우회 불가)
  // 명시된 저위험 allowlist만 자연 진행 — 모르는 kind는 여기에 없으니 승인으로 간다(애매하면 높은 등급).
  if (AUTO_SAFE_KINDS.always.includes(kind)) return true;              // A0: 읽기·요약·검색·초안
  if (AUTO_SAFE_KINDS.reversibleLocal.includes(kind)) return mode !== 'strict'; // A1: strict는 확인
  return false;                                              // 그 외(A2/A3·모르는 kind) → 승인 필요
}

/**
 * 행동에 대한 AuthorityGrant 를 만든다. 승인 필요 여부는 모드가 아니라 **행동의 위험**이 정한다 —
 * 모드는 저위험(A0/A1)을 얼마나 통과시키느냐만 조절하고, 안전 바닥은 어느 모드에서도 승인이다.
 * @param {Object} action
 * @param {string} action.label            사용자에게 보일 행동 이름
 * @param {string} action.kind
 * @param {Object} [action.preview]        {impact,scope,duration,cancel}
 * @param {boolean} [action.revocable]
 * @param {import('../contracts.js').ApprovalMode} [mode]
 * @returns {import('../contracts.js').AuthorityGrant}
 */
export function grantFor(action, mode = DEFAULT_APPROVAL_MODE) {
  const tier = classifyTier(action);
  const approvalRequired = !decideAutoGrant(action, mode);
  const revocable = action.revocable ?? (tier !== TIER.A3);
  /** @type {import('../contracts.js').AuthorityGrant} */
  const grant = {
    tier,
    kind: action.kind,
    action: action.label ?? action.kind,
    safetyFloor: isSafetyFloor(action.kind),
    approvalRequired,
    granted: !approvalRequired, // 저위험은 자동 진행, 승인 필요는 대기
    revocable,
    // P6-15: A0-A3 판단을 사용자 언어로. 정책이 아니라 "왜/무엇이/되돌릴 수 있나"를 보여줄 뿐.
    reason: explainAuthority(action, mode),
  };
  if (approvalRequired) {
    grant.approvalPreview = action.preview ?? {
      impact: action.label ?? action.kind,
      scope: '이번 요청',
      duration: '이번 한 번',
      cancel: revocable ? '되돌릴 수 있음' : '되돌릴 수 없음(실행 전 확인)',
    };
  }
  return grant;
}

/**
 * 실행 직전 게이트. 저위험 자동, 승인 필요는 granted=true 여야 통과.
 * 안전 바닥은 승인 필요가 강제되므로(grantFor) granted 없이는 절대 통과하지 않는다.
 * @param {import('../contracts.js').AuthorityGrant} grant
 */
export function isExecutionAllowed(grant) {
  if (!grant.approvalRequired) return true;
  return grant.granted === true;
}

// 승인 이유(사용자 언어) — kind별 한 줄. 개발자식 설명 금지.
const WHY_APPROVAL = {
  send: '메시지를 실제로 밖으로 보내는 일이라 보내기 전에 한 번 확인받아요.',
  write: '외부 서비스에 내용을 남기는 일이라 실행 전에 확인받아요.',
  automate: '앞으로 자동으로 실행될 설정이라 켜기 전에 확인받아요.',
  promote_memory: '오래 기억할 내용이라 저장하기 전에 확인받아요.',
  delete: '되돌리기 어려운 삭제라 실행 전에 확인받아요.',
  pay: '돈이 나가는 일이라 진행 전에 확인받아요.',
  publish: '밖으로 공개되는 일이라 게시 전에 확인받아요.',
  export_sensitive: '민감한 정보를 내보내는 일이라 먼저 확인받아요.',
  escalate: '권한을 올리는 일이라 먼저 확인받아요.',
  grant_permission: '권한을 바꾸는 일이라 먼저 확인받아요.',
  access_secret: '비밀·자격에 접근하는 일이라 먼저 확인받아요.',
  connect_account: '계정에 접근·연결하는 일이라 먼저 확인받아요.',
};

/**
 * A0-A3 판단을 사용자 언어로 설명한다(정책을 바꾸지 않는다 — 판단을 보여줄 뿐, P6-15).
 * @param {Object} action  {kind,label,preview,revocable}
 * @param {import('../contracts.js').ApprovalMode} [mode]
 * @returns {{tier:string, needsApproval:boolean, safetyFloor:boolean, why:string, whatChanges:string, reversible:string}}
 */
export function explainAuthority(action, mode = DEFAULT_APPROVAL_MODE) {
  const kind = action?.kind ?? UNKNOWN_KIND;
  const tier = classifyTier(action);
  const auto = decideAutoGrant(action, mode);
  const floor = isSafetyFloor(kind);
  const irreversible = kind === 'delete' || kind === 'pay' || kind === 'publish' || tier === TIER.A3;
  const reversible = action?.revocable === false || irreversible
    ? '되돌리기 어려워요 — 그래서 미리 확인해요.'
    : (auto ? '되돌릴 수 있어요.' : '되돌릴 수 있어요.');
  let why;
  if (auto) {
    why = tier === TIER.A0
      ? '읽고 정리해 보여드리는 일이라 승인 없이 바로 진행했어요.'
      : '되돌릴 수 있는 가벼운 정리라 승인 없이 바로 진행했어요.';
  } else {
    why = WHY_APPROVAL[kind] ?? '되돌리기 어렵거나 밖으로 나가는 일이라 실행 전에 확인받아요.';
  }
  const whatChanges = auto
    ? '바깥으로 나가거나 되돌리기 어려운 변화는 없어요.'
    : (floor ? '실행하면 밖으로 나가거나 상태가 바뀌어요 — 그래서 먼저 물어봐요.' : '지정한 항목이 바뀌어요.');
  return { tier, needsApproval: !auto, safetyFloor: floor, why, whatChanges, reversible };
}
