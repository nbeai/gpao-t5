const READ_ONLY_TOOLS = new Set([
  'web_search', 'web_read', 'web_research', 'session_search', 'conversation_recall',
]);

function clone(value) { return value == null ? value : structuredClone(value); }

function safeObservation(receipt) {
  const tool = receipt?.actualCall?.name ?? receipt?.requestedCall?.name;
  if (READ_ONLY_TOOLS.has(tool)) return true;
  return tool === 'exec' && receipt?.requestedCall?.args?.effect?.kind === 'observe';
}

function executionFacts(receipt) {
  const result = receipt?.result ?? {};
  const facts = {};
  for (const key of [
    'state', 'reason', 'coverage', 'effectObservation', 'declaredEffect', 'effectTruth',
    'exitCode', 'processExitCode', 'signal', 'truncated', 'omittedChars',
  ]) {
    if (result[key] !== undefined) facts[key] = clone(result[key]);
  }
  return facts;
}

/**
 * Replaces only earlier, read-only, byte-identical Evidence families in the model transcript.
 * Canonical receipts and the newest full observation remain untouched.
 */
export function compactDuplicateEvidence({ seen, fingerprint, receipt, message }) {
  if (!fingerprint || !safeObservation(receipt)) return null;
  const prior = seen.get(fingerprint) ?? [];
  let savedBytes = 0; const handles = [];
  for (const item of prior) {
    const compact = JSON.stringify({
      schema: 't5.duplicate-evidence-projection.v1',
      toolCallId: item.toolCallId,
      tool: item.tool,
      outcome: item.outcome,
      executionFacts: item.executionFacts,
      duplicateEvidenceOf: receipt.toolCallId,
      newestFullReceiptAvailable: true,
    });
    if (compact.length >= item.message.content.length) continue;
    savedBytes += item.message.content.length - compact.length;
    item.message.content = compact; handles.push(item.toolCallId);
  }
  prior.push({
    message, toolCallId: receipt.toolCallId,
    tool: receipt.actualCall?.name ?? receipt.requestedCall?.name,
    outcome: receipt.outcome, executionFacts: executionFacts(receipt),
  });
  seen.set(fingerprint, prior);
  if (!handles.length) return null;
  return {
    kind: 'duplicate_evidence', projectedReceipts: handles.length,
    grossSavedBytes: savedBytes, netSavedBytes: savedBytes,
    handles, newestFullReceipt: receipt.toolCallId,
  };
}
