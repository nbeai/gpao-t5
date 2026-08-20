import { createHash } from 'node:crypto';

const EVIDENCE_SCHEMA = 't5.turn-recovery-evidence.v1';

function normalize(value) {
  return String(value ?? '').normalize('NFKC').replaceAll(/\s+/gu, ' ').trim();
}

function fingerprint(value) {
  return createHash('sha256').update(normalize(value)).digest('hex');
}

function validEvidence(value) {
  return value?.schema === EVIDENCE_SCHEMA
    && /^[0-9a-f]{64}$/u.test(value.userFingerprint ?? '')
    && /^[0-9a-f]{64}$/u.test(value.surfaceFingerprint ?? '')
    && Number.isInteger(value.receiptCount)
    && Number.isInteger(value.executedToolCalls);
}

export function recoveryEvidenceForTurn({
  userText, reply, kind, failureCode = null, receipts = [],
} = {}) {
  const items = Array.isArray(receipts) ? receipts : [];
  return {
    schema: EVIDENCE_SCHEMA,
    userFingerprint: fingerprint(userText),
    surfaceFingerprint: fingerprint(`${kind ?? 'unknown'}\0${failureCode ?? ''}\0${reply ?? ''}`),
    kind: String(kind ?? 'unknown'),
    failureCode: failureCode == null ? null : String(failureCode),
    receiptCount: items.length,
    executedToolCalls: items.filter((receipt) => receipt?.actualCall != null).length,
    changedEffects: items.filter((receipt) => receipt?.result?.effectObservation?.changed === true).length,
  };
}
function lastCompletedExchange(transcript = []) {
  let assistantIndex = -1;
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    if (transcript[index]?.role === 'assistant') { assistantIndex = index; break; }
  }
  if (assistantIndex < 0) return null;
  let user = null;
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (transcript[index]?.role === 'user') { user = transcript[index]; break; }
  }
  return user ? { user, assistant: transcript[assistantIndex] } : null;
}

function madeNoProgress(evidence) {
  return validEvidence(evidence)
    && evidence.receiptCount === 0
    && evidence.executedToolCalls === 0
    && evidence.changedEffects === 0;
}

/**
 * This detector never interprets Korean or provider prose. It only opens a recovery surface when
 * two distinct user turns produce the exact same surface result with no ToolReceipt in between.
 * It does not replace, edit, or block the model answer.
 */
export function repeatedNoProgressSignal({ session, currentUserText, currentResult, evidence } = {}) {
  if (!madeNoProgress(evidence)) return null;
  const previous = lastCompletedExchange(session?.transcript);
  const priorEvidence = previous?.assistant?.result?.recoveryEvidence;
  if (!madeNoProgress(priorEvidence)) return null;
  if (priorEvidence.userFingerprint === evidence.userFingerprint) return null;
  if (priorEvidence.surfaceFingerprint !== evidence.surfaceFingerprint) return null;
  if (String(previous.assistant.result?.kind ?? '') !== String(currentResult?.kind ?? '')) return null;
  if (currentResult?.kind === 'error'
    && String(previous.assistant.result?.failureCode ?? '') !== String(currentResult?.failureCode ?? '')) return null;
  return {
    kind: 'repeated_no_progress',
    userSafeSummary: '같은 자리에서 진행되지 않고 있어요.',
    canResetConversation: true,
    canContinueCleanly: true,
  };
}
