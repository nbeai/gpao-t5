const PATHOLOGY_SIGNALS = new Set([
  'model_interval_without_new_evidence',
  'repeated_evidence_only',
  'context_growth_without_new_evidence',
]);
const RELIABILITY_SIGNALS = new Set(['provider_retry_observed', 'usage_unknown']);

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}

/**
 * Derives a content-free candidate from facts already observed by ResourceRun.
 * It records evidence; it does not prescribe a limit, action, or model instruction.
 */
export function deriveResourceAnomalyCandidate(snapshot = {}) {
  const metrics = {
    modelCalls: count(snapshot.modelCalls),
    toolCalls: count(snapshot.toolCalls),
    novelEvidence: count(snapshot.novelEvidence),
    repeatedEvidence: count(snapshot.repeatedEvidence),
    noEvidence: count(snapshot.noEvidence),
    intervalsWithoutNewEvidence: count(snapshot.intervalsWithoutNewEvidence),
    repeatedEvidenceOnlyIntervals: count(snapshot.repeatedEvidenceOnlyIntervals),
    contextGrowthWithoutNewEvidenceBytes: count(snapshot.contextGrowthWithoutNewEvidenceBytes),
    requestProjectionGrowthBytes: count(snapshot.requestProjectionGrowthBytes),
    priorRequestBytesAtGrowth: count(snapshot.priorRequestBytesAtGrowth),
    firstEfficiencyCandidateModelCall: count(snapshot.firstEfficiencyCandidateModelCall),
    firstPathologyCandidateModelCall: count(snapshot.firstPathologyCandidateModelCall),
    firstReliabilityCandidateModelCall: count(snapshot.firstReliabilityCandidateModelCall),
    priorFunctionOutputBytesAtNondecreasingProjection: count(
      snapshot.priorFunctionOutputBytesAtNondecreasingProjection,
    ),
    retryAttempts: count(snapshot.retryAttempts),
    unknownSettlements: count(snapshot.unknownSettlements),
  };
  const signals = [];
  if (metrics.intervalsWithoutNewEvidence > 0) signals.push('model_interval_without_new_evidence');
  if (metrics.repeatedEvidenceOnlyIntervals > 0) signals.push('repeated_evidence_only');
  if (metrics.contextGrowthWithoutNewEvidenceBytes > 0) signals.push('context_growth_without_new_evidence');
  if (metrics.retryAttempts > 0) signals.push('provider_retry_observed');
  if (metrics.unknownSettlements > 0) signals.push('usage_unknown');
  if (metrics.requestProjectionGrowthBytes > 0) signals.push('request_projection_growth');
  if (metrics.priorFunctionOutputBytesAtNondecreasingProjection > 0) {
    signals.push('function_output_projection_nondecreasing');
  }
  if (!signals.length) return null;
  return {
    category: signals.some((signal) => PATHOLOGY_SIGNALS.has(signal))
      ? 'pathology_candidate'
      : signals.some((signal) => RELIABILITY_SIGNALS.has(signal))
        ? 'reliability_candidate' : 'efficiency_candidate',
    signals,
    metrics,
    shadow: true,
    intervention: false,
  };
}
