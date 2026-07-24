// L2 · ActionPlan (§4) — IntentPacket 의 출구. 실행 계획이지 실행이 아니다.
// toolsToUse 는 SelfState 가 실행 가능 판정한 것만. needsApproval 은 A2·A3.
import { isToolExecutable } from '../l0-evidence/self-state.js';
import { toolLabel } from '../tool-labels.js';
import { grantFor } from './authority.js';

// 도구 id → 권한 종류(범주). 실행 종류를 권한 등급으로 잇는다.
const TOOL_KIND = {
  'mail.send': 'send',
  'slack.post': 'send',
  'telegram.send': 'send',
  'local.file': 'organize',
  'web.collect': 'read',
};

/**
 * @param {Object} p
 * @param {import('../contracts.js').IntentPacket} p.intent
 * @param {import('../contracts.js').SelfStateSnapshot} p.selfState
 * @returns {import('../contracts.js').ActionPlan}
 */
export function buildActionPlan(p) {
  const { intent, selfState } = p;
  const needed = intent.neededTools ?? [];

  // 실행 가능한 도구만 계획에 올린다(목록 존재 ≠ 실행 가능).
  const toolsToUse = needed.filter((id) => isToolExecutable(selfState, id));
  const blockedTools = needed.filter((id) => !isToolExecutable(selfState, id));

  const autoAllowed = [];
  /** @type {import('../contracts.js').AuthorityGrant[]} */
  const needsApproval = [];
  for (const id of toolsToUse) {
    // 권한 종류는 descriptor(toolKind)를 먼저 믿는다 — 하드코딩 맵에 없어도 새 도구가 새지 않게.
    const tool = selfState.connectedTools.find((t) => t.id === id);
    let kind = tool?.toolKind ?? TOOL_KIND[id] ?? 'read';
    // 감사 보정(보안): descriptor가 needsApproval=true면 등급이 낮게 나와도 승인 게이트로 올린다.
    // "실행 가능"(availability)과 "실행해도 됨"(needsApproval) 두 축을 끝까지 살린다.
    const preview = (k) => ({
      impact: `${toolLabel(id)} 실행`,
      scope: '이번 요청',
      duration: '이번 한 번',
      cancel: k === 'delete' ? '되돌릴 수 없음(실행 전 확인)' : '되돌릴 수 있음',
    });
    let grant = grantFor({ label: id, kind, preview: preview(kind) });
    if (tool?.needsApproval && !grant.approvalRequired) {
      kind = 'send'; // 최소 A2로 승인 강제(하드코딩 우회 차단)
      grant = grantFor({ label: id, kind, preview: preview(kind) });
    }
    if (grant.approvalRequired) needsApproval.push(grant);
    else autoAllowed.push(id);
  }

  const forbidden = [];
  if (intent.unwantedRisk) forbidden.push(intent.unwantedRisk);

  return {
    understoodTask: intent.desiredOutcome,
    contextToUse: intent.relatedContext ?? [],
    toolsToUse,
    autoAllowed,
    needsApproval,
    forbidden,
    successCriteria: `요청 달성: ${intent.desiredOutcome}`,
    recoveryCriteria: blockedTools.length
      ? `막힌 도구(${blockedTools.map(toolLabel).join(', ')})는 연결·대체 안내로 이어간다`
      : '실패 시 무엇이 안전하고 다음 안전 행동을 제시한다',
    // 실행 불가로 계획에서 빠진 도구를 정직하게 남긴다(죽은 버튼 금지, 복구 근거).
    blockedTools,
  };
}
