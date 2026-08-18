const TERMINAL_TOOLS = new Set(['exec', 'process_start', 'pty_start', 'process_control']);
const RESULT_KEYS = [
  'state', 'stdout', 'stderr', 'truncated', 'omittedChars', 'exitCode', 'processExitCode',
  'signal', 'error', 'stopped', 'stopReason', 'terminationConfirmed', 'processId', 'cursor',
  'cwd', 'pendingId', 'reason', 'command', 'toolName', 'inputAccepted', 'cols', 'rows',
];
export const DEFAULT_MAX_INLINE_HISTORICAL_OUTPUT_CHARS = 8_000;
export const DEFAULT_HISTORICAL_OUTPUT_PREVIEW_CHARS = 1_000;

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

function projectLargeOutput(value, { messageId, stream, largeOutputMode, maxInlineOutputChars, previewChars }) {
  if (largeOutputMode !== 'recoverable' || !messageId || typeof value !== 'string'
    || value.length <= maxInlineOutputChars) return null;
  const head = value.slice(0, previewChars);
  const tail = value.slice(-previewChars);
  return {
    text: `${head}\n…[${value.length - head.length - tail.length} historical characters omitted; use conversation_recall]…\n${tail}`,
    projection: {
      state: 'recoverable', messageId, stream, totalChars: value.length,
      inlineChars: head.length + tail.length,
      omittedChars: value.length - head.length - tail.length,
      recallTool: 'conversation_recall',
    },
    ref: { messageId, stream, totalChars: value.length },
  };
}

function compactResult(result, options) {
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
  const recoverable = [];
  for (const stream of ['stdout', 'stderr']) {
    const projected = projectLargeOutput(result[stream], { ...options, stream });
    if (!projected) continue;
    compact[stream] = projected.text;
    compact[`${stream}Projection`] = projected.projection;
    recoverable.push(projected.ref);
  }
  return { result: compact, recoverable };
}

function projectToolMessage(message, options = {}) {
  if (message?.role !== 'tool' || !TERMINAL_TOOLS.has(message.name)) {
    return { message: clone(message), recoverable: [] };
  }
  let receipt;
  try { receipt = JSON.parse(message.content); }
  catch { return { message: clone(message), recoverable: [] }; }
  if (!receipt || typeof receipt !== 'object' || !receipt.toolCallId
    || typeof receipt.outcome !== 'string') return { message: clone(message), recoverable: [] };
  const compacted = compactResult(receipt.result, options);
  if (!compacted) return { message: clone(message), recoverable: [] };
  const tool = receipt.actualCall?.name ?? receipt.requestedCall?.name ?? message.name;
  const projected = {
    schema: 't5.historical-tool-receipt.v1',
    toolCallId: receipt.toolCallId,
    tool,
    outcome: receipt.outcome,
    actualCall: receipt.actualCall ? true : false,
    result: compacted.result,
  };
  return {
    message: { ...clone(message), content: JSON.stringify(projected) },
    recoverable: compacted.recoverable,
  };
}

function interruptedToolMessage(call) {
  return {
    role: 'tool', toolCallId: String(call.id), name: String(call.name),
    content: JSON.stringify({
      schema: 't5.interrupted-tool-result.v1',
      toolCallId: String(call.id),
      requestedCall: { id: String(call.id), name: String(call.name), args: clone(call.args ?? {}) },
      outcome: 'interrupted_unknown',
      result: {
        state: 'interrupted', executionKnown: false,
        reason: 'The runtime ended before a completed tool receipt was recorded. Do not assume the effect ran or did not run; inspect current reality before retrying.',
      },
    }),
  };
}

/** Repair provider call/result structure without rewriting canonical conversation truth. */
export function repairIncompleteToolCallMessages(messages = []) {
  const output = [];
  const pending = new Map();
  const flush = () => {
    for (const call of pending.values()) output.push(interruptedToolMessage(call));
    pending.clear();
  };
  for (const source of messages) {
    const message = clone(source);
    if (pending.size && message?.role !== 'tool') flush();
    output.push(message);
    if (message?.role === 'assistant') {
      for (const call of message.toolCalls ?? []) {
        if (call?.id && call?.name) pending.set(String(call.id), clone(call));
      }
    } else if (message?.role === 'tool' && message.toolCallId) {
      pending.delete(String(message.toolCallId));
    }
  }
  if (pending.size) flush();
  return output;
}

/** Build model-visible history without changing the canonical Conversation ledger. */
export function projectHistoricalConversation(messages = []) {
  return repairIncompleteToolCallMessages(
    messages.map((message) => projectToolMessage(message).message),
  );
}

/** Project canonical entries and retain refs for large outputs available to conversation_recall. */
export function projectHistoricalConversationEntries(entries = [], {
  largeOutputMode = 'inline',
  maxInlineOutputChars = DEFAULT_MAX_INLINE_HISTORICAL_OUTPUT_CHARS,
  previewChars = DEFAULT_HISTORICAL_OUTPUT_PREVIEW_CHARS,
} = {}) {
  const projected = entries.map((entry) => projectToolMessage(entry.message, {
    messageId: entry.messageId, largeOutputMode, maxInlineOutputChars, previewChars,
  }));
  return {
    messages: repairIncompleteToolCallMessages(projected.map((entry) => entry.message)),
    recoverable: projected.flatMap((entry) => entry.recoverable),
  };
}
