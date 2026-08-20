import { createHash } from 'node:crypto';

const EVIDENCE_SCHEMA = 't5.turn-recovery-evidence.v1';

function normalize(value) {
  return String(value ?? '').normalize('NFKC').replaceAll(/\s+/gu, ' ').trim();
}

function fingerprint(value) {
  return createHash('sha256').update(normalize(value)).digest('hex');
}

function stableDiagnosticValue(value) {
  if (Array.isArray(value)) return value.map(stableDiagnosticValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => (
    ['checkedAt', 'recordedAt', 'startedAt', 'endedAt', 'durationMs'].includes(key)
      ? [] : [[key, stableDiagnosticValue(value[key])]]
  )));
}

function validEvidence(value) {
  return value?.schema === EVIDENCE_SCHEMA
    && /^[0-9a-f]{64}$/u.test(value.userFingerprint ?? '')
    && /^[0-9a-f]{64}$/u.test(value.surfaceFingerprint ?? '')
    && /^[0-9a-f]{64}$/u.test(value.diagnosticFingerprint ?? '')
    && Number.isInteger(value.receiptCount)
    && Number.isInteger(value.executedToolCalls)
    && typeof value.diagnosticOnly === 'boolean';
}

export function recoveryEvidenceForTurn({
  userText, reply, kind, failureCode = null, receipts = [],
} = {}) {
  const items = Array.isArray(receipts) ? receipts : [];
  const diagnosticOnly = items.length > 0 && items.every((receipt) => (
    receipt?.requestedCall?.name === 'connection'
  ));
  return {
    schema: EVIDENCE_SCHEMA,
    userFingerprint: fingerprint(userText),
    surfaceFingerprint: fingerprint(`${kind ?? 'unknown'}\0${failureCode ?? ''}\0${reply ?? ''}`),
    kind: String(kind ?? 'unknown'),
    failureCode: failureCode == null ? null : String(failureCode),
    receiptCount: items.length,
    executedToolCalls: items.filter((receipt) => receipt?.actualCall != null).length,
    changedEffects: items.filter((receipt) => receipt?.result?.effectObservation?.changed === true).length,
    diagnosticOnly,
    diagnosticFingerprint: createHash('sha256')
      .update(JSON.stringify(stableDiagnosticValue(items.map((receipt) => ({
        requestedCall: receipt?.requestedCall ?? null,
        actualCall: receipt?.actualCall ?? null,
        outcome: receipt?.outcome ?? null,
        result: receipt?.result ?? null,
      })))))
      .digest('hex'),
  };
}
function completedExchangesSinceRecovery(transcript = []) {
  const exchanges = [];
  let assistant = null;
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const entry = transcript[index];
    if (entry?.role === 'system_event' && entry.event?.kind === 'session_recovered') break;
    if (!assistant && entry?.role === 'assistant') {
      assistant = entry;
      continue;
    }
    if (assistant && entry?.role === 'user') {
      exchanges.push({ user: entry, assistant });
      assistant = null;
    }
  }
  return exchanges;
}

function madeNoProgress(evidence) {
  return validEvidence(evidence)
    && evidence.changedEffects === 0
    && (evidence.receiptCount === 0
      ? evidence.executedToolCalls === 0
      : evidence.diagnosticOnly && evidence.executedToolCalls === evidence.receiptCount);
}

/**
 * This detector never interprets Korean or provider prose. It only opens a recovery surface when
 * two distinct user turns after the last explicit recovery produce the exact same no-progress
 * surface result. Unrelated successful work between those turns does not hide a recurring dead end.
 * It does not replace, edit, or block the model answer.
 */
export function repeatedNoProgressSignal({ session, currentUserText, currentResult, evidence } = {}) {
  if (!madeNoProgress(evidence)) return null;
  const previous = completedExchangesSinceRecovery(session?.transcript).find((exchange) => {
    const priorEvidence = exchange.assistant?.result?.recoveryEvidence;
    if (!madeNoProgress(priorEvidence)) return false;
    if (priorEvidence.userFingerprint === evidence.userFingerprint) return false;
    if (priorEvidence.surfaceFingerprint !== evidence.surfaceFingerprint) return false;
    if (priorEvidence.diagnosticOnly !== evidence.diagnosticOnly) return false;
    if (evidence.diagnosticOnly
      && priorEvidence.diagnosticFingerprint !== evidence.diagnosticFingerprint) return false;
    if (String(exchange.assistant.result?.kind ?? '') !== String(currentResult?.kind ?? '')) return false;
    if (currentResult?.kind === 'error'
      && String(exchange.assistant.result?.failureCode ?? '') !== String(currentResult?.failureCode ?? '')) return false;
    return true;
  });
  if (!previous) return null;
  return {
    kind: 'repeated_no_progress',
    userSafeSummary: '같은 자리에서 진행되지 않고 있어요.',
    canResetConversation: true,
    canContinueCleanly: true,
  };
}
