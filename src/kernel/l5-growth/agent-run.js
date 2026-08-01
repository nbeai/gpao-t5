import { childToolAllowlist } from './automation-contracts.js';

export function sameAgentRunOwner(left, right) {
  return Number.isInteger(left?.pid)
    && left.pid > 0
    && typeof left?.ownerToken === 'string'
    && left.ownerToken.length > 0
    && left.pid === right?.pid
    && left.ownerToken === right?.ownerToken;
}

/**
 * Applies the canonical child deny rules at both the parent and profile bounds.
 * The returned list is a gate result, never a replacement AgentRun envelope.
 */
export function boundedChildToolAllowlist({
  parentToolAllowlist,
  profile,
  requestedTools,
  selfState,
}) {
  const profileBound = childToolAllowlist(
    parentToolAllowlist,
    profile?.toolAllowlist,
    selfState,
  );
  return childToolAllowlist(profileBound, requestedTools, selfState);
}
