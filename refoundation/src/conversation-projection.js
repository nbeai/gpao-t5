const TERMINAL_TOOLS = new Set(['exec', 'process_start', 'pty_start', 'process_control']);
const RESULT_KEYS = [
  'state', 'stdout', 'stderr', 'truncated', 'omittedChars', 'exitCode', 'processExitCode',
  'signal', 'error', 'stopped', 'stopReason', 'terminationConfirmed', 'processId', 'cursor',
  'cwd', 'pendingId', 'reason', 'command', 'toolName', 'inputAccepted', 'cols', 'rows',
];

function clone(value) { return value == null ? value : structuredClone(value); }

function compactEffect(effect, changed) {
  if (!effect || typeof effect !== 'object' || Array.isArray(effect)) return undefined;
  return {
    ...(effect.kind ? { kind: effect.kind } : {}),
    ...(effect.summary ? { summary: effect.summary } : {}),
    ...(Array.isArray(effect.targets) ? { targets: clone(effect.targets) } : {}),
    ...(typeof changed === 'boolean' ? { changed } : {}),
  };
}

function compactResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const compact = {};
  for (const key of RESULT_KEYS) {
    if (result[key] !== undefined) compact[key] = clone(result[key]);
  }
  const observed = compactEffect(result.effectObservation?.declared, result.effectObservation?.changed);
  if (observed) compact.effect = observed;
  else {
    const declared = compactEffect(result.effect ?? result.declaredEffect);
    if (declared) compact.effect = declared;
  }
  return compact;
}

function projectToolMessage(message) {
  if (message?.role !== 'tool' || !TERMINAL_TOOLS.has(message.name)) return clone(message);
  let receipt;
  try { receipt = JSON.parse(message.content); }
  catch { return clone(message); }
  if (!receipt || typeof receipt !== 'object' || !receipt.toolCallId
    || typeof receipt.outcome !== 'string') return clone(message);
  const result = compactResult(receipt.result);
  if (!result) return clone(message);
  const tool = receipt.actualCall?.name ?? receipt.requestedCall?.name ?? message.name;
  const projected = {
    schema: 't5.historical-tool-receipt.v1',
    toolCallId: receipt.toolCallId,
    tool,
    outcome: receipt.outcome,
    actualCall: receipt.actualCall ? true : false,
    result,
  };
  return { ...clone(message), content: JSON.stringify(projected) };
}

/** Build model-visible history without changing the canonical Conversation ledger. */
export function projectHistoricalConversation(messages = []) {
  return messages.map(projectToolMessage);
}
