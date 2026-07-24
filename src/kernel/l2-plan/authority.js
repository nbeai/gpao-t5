// L2 · AuthorityGrant (권한 계약, §3) — A0-A3 분류와 실행 직전 게이트.
// UI 는 권한을 부여하지 않고 결정을 보여 주고 승인을 받는다(헌법 §3-1).
// "사용자가 원했다"만으로 A2·A3 우회 불가(헌법 §3-6).
import { TIER } from '../contracts.js';

/**
 * 행동의 비가역성·외부성으로 등급을 판정한다. 애매하면 높은 등급으로.
 * @param {Object} action
 * @param {string} action.kind   read|summarize|search|draft|organize|send|write|publish|delete|pay|promote_memory
 * @returns {import('../contracts.js').AuthorityTier}
 */
export function classifyTier(action) {
  const kind = action?.kind ?? 'read';
  switch (kind) {
    case 'delete':
    case 'pay':
    case 'publish':
    case 'export_sensitive':
    case 'escalate':
      return TIER.A3;
    case 'send':
    case 'write':          // SaaS 쓰기
    case 'automate':       // 자동화 활성화
    case 'promote_memory': // 장기 기억 승격
      return TIER.A2;
    case 'organize':       // 되돌릴 수 있는 로컬 정리
    case 'title':
    case 'archive':
      return TIER.A1;
    case 'read':
    case 'summarize':
    case 'search':
    case 'draft':
    default:
      return TIER.A0;
  }
}

/**
 * 행동에 대한 AuthorityGrant 를 만든다(초기 granted=false).
 * @param {Object} action
 * @param {string} action.label            사용자에게 보일 행동 이름
 * @param {string} action.kind
 * @param {Object} [action.preview]        {impact,scope,duration,cancel}
 * @param {boolean} [action.revocable]
 * @returns {import('../contracts.js').AuthorityGrant}
 */
export function grantFor(action) {
  const tier = classifyTier(action);
  const approvalRequired = tier === TIER.A2 || tier === TIER.A3;
  const revocable = action.revocable ?? (tier !== TIER.A3);
  /** @type {import('../contracts.js').AuthorityGrant} */
  const grant = {
    tier,
    action: action.label ?? action.kind,
    approvalRequired,
    granted: !approvalRequired, // A0·A1 은 자동 허용, A2·A3 은 승인 대기
    revocable,
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
 * 실행 직전 게이트. A0·A1 자동, A2·A3 은 granted=true 여야 통과.
 * @param {import('../contracts.js').AuthorityGrant} grant
 */
export function isExecutionAllowed(grant) {
  if (!grant.approvalRequired) return true;
  return grant.granted === true;
}
