const TERMINAL_TOOLS = new Set(['exec', 'process_start', 'pty_start', 'process_control']);
const BROWSER_TOOLS = new Set(['browser']);
const RESULT_KEYS = [
  'state', 'stdout', 'stderr', 'truncated', 'omittedChars', 'exitCode', 'processExitCode',
  'signal', 'error', 'stopped', 'stopReason', 'terminationConfirmed', 'processId', 'cursor',
  'cwd', 'pendingId', 'reason', 'command', 'toolName', 'inputAccepted', 'cols', 'rows',
];
export const DEFAULT_MAX_INLINE_HISTORICAL_OUTPUT_CHARS = 8_000;
export const DEFAULT_HISTORICAL_OUTPUT_PREVIEW_CHARS = 1_000;
export const DEFAULT_OLD_BROWSER_OBSERVATION_CHARS = 1_000;

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

function pickObject(source, keys) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined;
  const output = {};
  for (const key of keys) {
    if (source[key] !== undefined) output[key] = clone(source[key]);
  }
  return Object.keys(output).length ? output : undefined;
}

function compactBrowserTab(tab, { preserveInteractionState = false } = {}) {
  return pickObject(tab, preserveInteractionState
    ? ['tabId', 'title', 'url', 'active'] : ['title', 'url', 'active']);
}

function compactBrowserObservation(observation, {
  preserveInteractionState = false,
  oldObservationChars = DEFAULT_OLD_BROWSER_OBSERVATION_CHARS,
} = {}) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) return undefined;
  const compact = pickObject(observation, [
    ...(preserveInteractionState ? ['observationId'] : []),
    'totalChars', 'shownChars', 'truncated', 'omittedChars',
    'trust', 'instructionAuthority',
  ]) ?? {};
  const scope = pickObject(observation.refScope, preserveInteractionState
    ? ['observationId', 'tabId', 'url'] : ['url']);
  if (scope) compact.refScope = scope;
  if (!preserveInteractionState) compact.interactionState = 'historical_reobserve_required';
  if (typeof observation.text === 'string') {
    if (preserveInteractionState || observation.text.length <= oldObservationChars) {
      compact.text = observation.text;
    } else {
      compact.text = observation.text.slice(0, oldObservationChars);
      compact.textProjection = {
        state: 'historical_preview', totalChars: observation.text.length,
        inlineChars: oldObservationChars,
        omittedChars: observation.text.length - oldObservationChars,
      };
    }
  }
  if (preserveInteractionState && observation.refs && typeof observation.refs === 'object') {
    compact.refs = clone(observation.refs);
  }
  return compact;
}

function compactBrowserNetwork(network) {
  if (!network || typeof network !== 'object' || Array.isArray(network)) return undefined;
  const compact = pickObject(network, ['totalRequests', 'truncated']) ?? {};
  if (Array.isArray(network.requests)) {
    compact.requests = network.requests.map((request) => pickObject(request, [
      'method', 'address', 'queryOmitted', 'resourceType', 'status', 'mimeType',
    ]) ?? {});
  }
  return compact;
}

function compactBrowserResult(result, options) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const compact = pickObject(result, [
    'state', 'pendingId', 'reason', 'error', 'pageObserved', 'secretValuesObserved',
    'secretFieldsPresent', 'continuityEstablished',
  ]) ?? {};
  const operation = options.browserAction;
  const action = pickObject(result.action, ['kind', 'ref', 'textChars']);
  if (action) compact.action = action;
  else if (operation) compact.action = { kind: operation };
  const effect = compactEffect(result.declaredEffect ?? result.effect);
  if (effect) compact.effect = effect;
  else if (typeof result.effect === 'string') compact.effect = { kind: result.effect };
  const tab = compactBrowserTab(result.tab, options);
  if (tab) compact.tab = tab;
  if (Array.isArray(result.tabs)) {
    compact.tabs = result.tabs.map((item) => compactBrowserTab(item, options)).filter(Boolean);
  }
  const handoff = pickObject(result.handoff, [
    'visible', 'inputOwner', 'modelActionsBlocked', 'resumedHeadless',
  ]);
  if (handoff) compact.handoff = handoff;
  const before = pickObject(result.before, options.preserveInteractionState
    ? ['observationId', 'ref', 'refFact'] : ['refFact']);
  if (before) {
    const scope = pickObject(result.before?.refScope, options.preserveInteractionState
      ? ['observationId', 'tabId', 'url'] : ['url']);
    if (scope) before.refScope = scope;
    compact.before = before;
  }
  const observation = compactBrowserObservation(result.observation, options);
  if (observation) compact.observation = observation;
  const after = compactBrowserObservation(result.after, options);
  if (after) compact.after = after;
  const navigation = pickObject(result.navigation, ['changed', 'from', 'to']);
  if (navigation) compact.navigation = navigation;
  const network = compactBrowserNetwork(result.network);
  if (network) compact.network = network;
  const modalAction = pickObject(result.modalAction, ['intent', 'context']);
  if (modalAction) compact.modalAction = modalAction;
  const effectTruth = pickObject(result.effectTruth, ['requestedKind', 'actualKind']);
  if (effectTruth) compact.effectTruth = effectTruth;
  const file = pickObject(result.file, ['path', 'bytes', 'sha256', 'mimeType', 'trust']);
  if (file) compact.file = file;
  const source = pickObject(result.source, ['address', 'queryOmitted']);
  if (source) compact.source = source;
  return { result: compact, recoverable: [] };
}

function browserReceiptInfo(message) {
  if (message?.role !== 'tool' || !BROWSER_TOOLS.has(message.name)) return null;
  try {
    const receipt = JSON.parse(message.content);
    if (!receipt || typeof receipt !== 'object') return null;
    const observation = receipt.result?.after ?? receipt.result?.observation;
    const tabId = receipt.result?.tab?.tabId ?? observation?.refScope?.tabId
      ?? receipt.actualCall?.args?.tabId ?? '__default__';
    return { receipt, tabId: String(tabId), hasObservation: Boolean(observation) };
  } catch {
    return null;
  }
}

function latestBrowserObservationIndexes(messages) {
  const latest = new Map();
  messages.forEach((message, index) => {
    const info = browserReceiptInfo(message);
    if (info?.hasObservation) latest.set(info.tabId, index);
  });
  return new Set(latest.values());
}

function projectToolMessage(message, options = {}) {
  if (message?.role !== 'tool'
    || (!TERMINAL_TOOLS.has(message.name) && !BROWSER_TOOLS.has(message.name))) {
    return { message: clone(message), recoverable: [] };
  }
  let receipt;
  try { receipt = JSON.parse(message.content); }
  catch { return { message: clone(message), recoverable: [] }; }
  if (!receipt || typeof receipt !== 'object' || !receipt.toolCallId
    || typeof receipt.outcome !== 'string') return { message: clone(message), recoverable: [] };
  const browserAction = receipt.actualCall?.args?.action ?? receipt.requestedCall?.args?.action;
  const compacted = BROWSER_TOOLS.has(message.name)
    ? compactBrowserResult(receipt.result, { ...options, browserAction })
    : compactResult(receipt.result, options);
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
  const preserveBrowserIndexes = latestBrowserObservationIndexes(messages);
  return repairIncompleteToolCallMessages(
    messages.map((message, index) => projectToolMessage(message, {
      preserveInteractionState: preserveBrowserIndexes.has(index),
    }).message),
  );
}

/** Project canonical entries and retain refs for large outputs available to conversation_recall. */
export function projectHistoricalConversationEntries(entries = [], {
  largeOutputMode = 'inline',
  maxInlineOutputChars = DEFAULT_MAX_INLINE_HISTORICAL_OUTPUT_CHARS,
  previewChars = DEFAULT_HISTORICAL_OUTPUT_PREVIEW_CHARS,
  preserveBrowserInteractionState = true,
} = {}) {
  const preserveBrowserIndexes = preserveBrowserInteractionState
    ? latestBrowserObservationIndexes(entries.map((entry) => entry.message)) : new Set();
  const projected = entries.map((entry, index) => projectToolMessage(entry.message, {
    messageId: entry.messageId, largeOutputMode, maxInlineOutputChars, previewChars,
    preserveInteractionState: preserveBrowserIndexes.has(index),
  }));
  return {
    messages: repairIncompleteToolCallMessages(projected.map((entry) => entry.message)),
    recoverable: projected.flatMap((entry) => entry.recoverable),
  };
}
