function effectUnknown(receipt) {
  const state = String(receipt?.result?.state ?? receipt?.result?.reason ?? '');
  return receipt?.result?.effectUnknown === true
    || receipt?.outcome === 'unknown'
    || /effect[_ -]?unknown|delivery[_ -]?unknown|write[_ -]?unknown/iu.test(state);
}

export function observeResourceOptimizationChoice({ response, lastReceipt = null, situation = null } = {}) {
  const calls = response?.toolCalls ?? [];
  if (!calls.length) return { choice: 'settle', toolCalls: 0 };
  if (calls.length > 1) return { choice: 'multiple_calls_selected', toolCalls: calls.length };
  const call = calls[0]; const previous = lastReceipt?.requestedCall;
  const sameExact = previous && previous.name === call.name
    && JSON.stringify(previous.args ?? {}) === JSON.stringify(call.args ?? {});
  if (effectUnknown(lastReceipt)) return {
    choice: sameExact ? 'blind_retry_selected' : 'reobserve_or_change_selected', toolCalls: 1,
  };
  if (lastReceipt && (situation?.evidence?.latestToolEvidence === 'repeated'
    || lastReceipt.result?.state === 'repeated' || lastReceipt.result?.state === 'no_progress')) {
    return { choice: sameExact ? 'same_route_selected' : 'different_route_selected', toolCalls: 1 };
  }
  return { choice: 'continue_observation', toolCalls: 1 };
}
