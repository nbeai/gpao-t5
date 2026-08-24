function bytes(value) { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }

function roleStats(messages = []) {
  const stats = {};
  for (const message of messages) {
    const role = String(message?.role ?? 'other');
    const current = stats[role] ?? { messages: 0, bytes: 0 };
    current.messages += 1; current.bytes += bytes(message); stats[role] = current;
  }
  return stats;
}

function clone(value) { return value == null ? value : structuredClone(value); }

export function projectConversationEntriesForCurrentPurpose(entries = [], { sessionId } = {}) {
  const lastUserIndex = entries.findLastIndex((entry) => entry.message?.role === 'user');
  if (lastUserIndex <= 0) return {
    entries: clone(entries), omittedMessages: 0, omittedBytes: 0, recallHandles: [],
  };
  const projected = []; const recallHandles = []; let omittedMessages = 0; let omittedBytes = 0;
  let index = 0;
  while (index < lastUserIndex) {
    const entry = entries[index];
    if (entry.message?.role === 'user') { projected.push(clone(entry)); index += 1; continue; }
    const omitted = [];
    while (index < lastUserIndex && entries[index].message?.role !== 'user') {
      omitted.push(entries[index]); index += 1;
    }
    if (!omitted.length) continue;
    omittedMessages += omitted.length; omittedBytes += bytes(omitted.map((item) => item.message));
    const first = omitted[0]; const last = omitted.at(-1);
    const handle = {
      sessionId: String(sessionId), firstMessageId: first.messageId,
      lastMessageId: last.messageId, messages: omitted.length,
      includeTools: omitted.some((item) => item.message?.role === 'tool'),
    };
    recallHandles.push(handle);
    projected.push({
      messageId: `information-projection:${first.messageId}:${last.messageId}`,
      runId: last.runId ?? first.runId ?? null, turn: last.turn ?? first.turn ?? null,
      recordedAt: last.recordedAt ?? first.recordedAt ?? null,
      message: { role: 'assistant', content: [
        '[T5 HISTORICAL ASSISTANT/TOOL PROJECTION — canonical events omitted from default model view]',
        `sessionId=${handle.sessionId}`,
        `firstMessageId=${handle.firstMessageId}`,
        `lastMessageId=${handle.lastMessageId}`,
        `messages=${handle.messages}`,
        `includeTools=${handle.includeTools}`,
        'All user messages and corrections remain inline. Use session_search action=read with the exact sessionId and firstMessageId when this older assistant/tool segment is needed.',
      ].join('\n') },
    });
  }
  projected.push(...clone(entries.slice(lastUserIndex)));
  return { entries: projected, omittedMessages, omittedBytes, recallHandles };
}

export function historicalInformation({
  sessionId, conversationMessages = [], memoryItems = [], memoryMessage = null, checkpoint = null,
  relevance = null,
} = {}) {
  return {
    conversation: {
      messages: conversationMessages.length, bytes: bytes(conversationMessages),
      byRole: roleStats(conversationMessages), checkpointPresent: Boolean(checkpoint),
      omittedAssistantToolMessages: relevance?.omittedMessages ?? 0,
      omittedAssistantToolBytes: relevance?.omittedBytes ?? 0,
      recallHandles: relevance?.recallHandles?.length ?? 0,
    },
    memory: {
      items: memoryItems.length,
      bytes: memoryMessage ? bytes(memoryMessage) : 0,
      userItems: memoryItems.filter((item) => item.kind === 'user').length,
      workItems: memoryItems.filter((item) => item.kind === 'work').length,
      currentSessionItems: memoryItems.filter((item) => item.source?.sessionId === sessionId).length,
      otherSessionItems: memoryItems.filter((item) => item.source?.sessionId
        && item.source.sessionId !== sessionId).length,
      unscopedItems: memoryItems.filter((item) => !item.source?.sessionId).length,
    },
  };
}

export function measureModelInformation({
  history = {}, currentRequest, currentRunMessages = [], tools = [], toolExposures = new Map(),
  requiredRecoveryTools = [],
} = {}) {
  let repeatedToolReceiptBytes = 0; let currentRunToolReceiptBytes = 0;
  for (const message of currentRunMessages) {
    if (message?.role !== 'tool' || !message.toolCallId) continue;
    const size = bytes(message); currentRunToolReceiptBytes += size;
    const count = toolExposures.get(String(message.toolCallId)) ?? 0;
    if (count > 0) repeatedToolReceiptBytes += size;
    toolExposures.set(String(message.toolCallId), count + 1);
  }
  return {
    historicalConversationMessages: history.conversation?.messages ?? 0,
    historicalConversationBytes: history.conversation?.bytes ?? 0,
    historicalConversationByRole: history.conversation?.byRole ?? {},
    checkpointPresent: history.conversation?.checkpointPresent === true,
    omittedAssistantToolMessages: history.conversation?.omittedAssistantToolMessages ?? 0,
    omittedAssistantToolBytes: history.conversation?.omittedAssistantToolBytes ?? 0,
    historicalRecallHandles: history.conversation?.recallHandles ?? 0,
    memoryItems: history.memory?.items ?? 0,
    memoryBytes: history.memory?.bytes ?? 0,
    memoryUserItems: history.memory?.userItems ?? 0,
    memoryWorkItems: history.memory?.workItems ?? 0,
    memoryCurrentSessionItems: history.memory?.currentSessionItems ?? 0,
    memoryOtherSessionItems: history.memory?.otherSessionItems ?? 0,
    memoryUnscopedItems: history.memory?.unscopedItems ?? 0,
    currentRequestBytes: bytes(currentRequest),
    currentRunMessages: currentRunMessages.length,
    currentRunBytes: bytes(currentRunMessages),
    currentRunByRole: roleStats(currentRunMessages),
    currentRunToolReceiptBytes,
    repeatedToolReceiptBytes,
    activeToolDefinitions: tools.length,
    activeToolDefinitionBytes: bytes(tools),
    toolDefinitionBytesByName: Object.fromEntries(tools.map((tool) => [tool.name, bytes(tool)])),
    requiredRecoveryTools,
  };
}

export function deriveInformationReport(runEvents = []) {
  const contexts = runEvents.filter((event) => event.type === 'information_context_built');
  const focusTurn = runEvents.find((event) => (
    event.type === 'information_surface_focused'
  ))?.payload?.turn ?? null;
  const usedTools = new Set(runEvents.filter((event) => event.type === 'tool_completed')
    .map((event) => event.payload?.receipt?.actualCall?.name).filter(Boolean));
  const report = {
    modelCalls: contexts.length,
    historicalConversationBytesSupplied: 0, memoryBytesSupplied: 0,
    currentRequestBytesSupplied: 0, currentRunToolReceiptBytesSupplied: 0,
    repeatedToolReceiptBytesSupplied: 0, activeToolDefinitionBytesSupplied: 0,
    unusedToolDefinitionBytesSupplied: 0, usedTools: [...usedTools].toSorted(),
    unusedNonRecoveryToolDefinitionBytesSupplied: 0,
    unusedNonRecoveryAfterFocusBytesSupplied: 0,
  };
  for (const event of contexts) {
    const facts = event.payload ?? {};
    report.historicalConversationBytesSupplied += Number(facts.historicalConversationBytes ?? 0);
    report.memoryBytesSupplied += Number(facts.memoryBytes ?? 0);
    report.currentRequestBytesSupplied += Number(facts.currentRequestBytes ?? 0);
    report.currentRunToolReceiptBytesSupplied += Number(facts.currentRunToolReceiptBytes ?? 0);
    report.repeatedToolReceiptBytesSupplied += Number(facts.repeatedToolReceiptBytes ?? 0);
    report.activeToolDefinitionBytesSupplied += Number(facts.activeToolDefinitionBytes ?? 0);
    for (const [name, size] of Object.entries(facts.toolDefinitionBytesByName ?? {})) {
      if (!usedTools.has(name)) {
        report.unusedToolDefinitionBytesSupplied += Number(size ?? 0);
        if (!(facts.requiredRecoveryTools ?? []).includes(name)) {
          report.unusedNonRecoveryToolDefinitionBytesSupplied += Number(size ?? 0);
          if (focusTurn != null && Number(facts.turn ?? 0) > Number(focusTurn)) {
            report.unusedNonRecoveryAfterFocusBytesSupplied += Number(size ?? 0);
          }
        }
      }
    }
  }
  return report;
}
