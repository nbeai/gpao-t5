import { createHash } from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function eligibleRuns(report) {
  return new Set((report?.sources ?? []).filter((source) => source.eligible)
    .map((source) => source.pointer.runId));
}

function knownMetrics(arm) {
  return {
    durationMs: arm?.durationMs?.median ?? null,
    modelTurns: arm?.modelTurns?.median ?? null,
    toolCalls: Number.isFinite(arm?.toolCalls) ? arm.toolCalls : null,
    failedToolCalls: Number.isFinite(arm?.failedToolCalls) ? arm.failedToolCalls : null,
    notExecutedToolCalls: Number.isFinite(arm?.notExecutedToolCalls) ? arm.notExecutedToolCalls : null,
  };
}

function pareto(baseline, candidate) {
  const left = knownMetrics(baseline); const right = knownMetrics(candidate);
  const pairs = Object.keys(left).filter((key) => Number.isFinite(left[key]) && Number.isFinite(right[key]));
  return {
    measured: pairs,
    noWorse: pairs.length > 0 && pairs.every((key) => right[key] <= left[key]),
    improved: pairs.filter((key) => right[key] < left[key]),
  };
}

function exactPairEvaluations(comparison, evaluations) {
  const baseline = new Set((comparison?.baseline?.runs ?? []).map((run) => run.runId));
  const candidate = new Set((comparison?.candidate?.runs ?? []).map((run) => run.runId));
  const seenBaseline = new Set(); const seenCandidate = new Set();
  for (const evaluation of evaluations) {
    if (!baseline.has(evaluation.baselineRunId) || !candidate.has(evaluation.candidateRunId)
      || seenBaseline.has(evaluation.baselineRunId) || seenCandidate.has(evaluation.candidateRunId)
      || !String(evaluation.evaluatorRunId ?? '').trim() || !String(evaluation.evaluationDigest ?? '').trim()) {
      return false;
    }
    seenBaseline.add(evaluation.baselineRunId); seenCandidate.add(evaluation.candidateRunId);
  }
  return seenBaseline.size === baseline.size && seenCandidate.size === candidate.size;
}

export function qualifyLearningComparison({ comparison, baselineEligibility, candidateEligibility,
  pairEvaluations = [], triggerEvaluation = null, fieldObservation = null } = {}) {
  if (!comparison?.baseline?.runs?.length || !comparison?.candidate?.runs?.length) {
    throw new Error('learning comparison arms are required');
  }
  if (pairEvaluations.length < 2) throw new Error('repeated distinct Work evaluations are required');
  if (!exactPairEvaluations(comparison, pairEvaluations)) throw new Error('paired evaluation identity mismatch');
  const baselineEligible = eligibleRuns(baselineEligibility); const candidateEligible = eligibleRuns(candidateEligibility);
  const sourceRuns = [...comparison.baseline.runs, ...comparison.candidate.runs];
  if (sourceRuns.some((run) => !(baselineEligible.has(run.runId) || candidateEligible.has(run.runId)))) {
    throw new Error('learning comparison contains ineligible Work source');
  }
  if (pairEvaluations.some((item) => item.samePurpose !== true || item.baselineCorrect !== true
    || item.candidateCorrect !== true || item.baselineComplete !== true
    || item.candidateComplete !== true || item.userCorrectionPreserved !== true)) {
    throw new Error('learning comparison correctness or purpose verification failed');
  }
  if (!triggerEvaluation || !String(triggerEvaluation.evaluatorRunId ?? '').trim()
    || !String(triggerEvaluation.evaluationDigest ?? '').trim()
    || triggerEvaluation.sourceExpressionsReused !== false
    || triggerEvaluation.falsePositiveCount !== 0 || triggerEvaluation.falseNegativeCount !== 0) {
    throw new Error('learning trigger holdout verification failed');
  }
  if (!fieldObservation || !String(fieldObservation.workId ?? '').trim()
    || !String(fieldObservation.runId ?? '').trim()
    || !String(fieldObservation.resultDigest ?? '').trim()
    || fieldObservation.candidateRevisionUsed !== true || fieldObservation.achieved !== true
    || fieldObservation.userCorrectionPreserved !== true || fieldObservation.regressionObserved === true) {
    throw new Error('learning field observation failed');
  }
  const sourceWorkIds = new Set([
    ...(baselineEligibility?.sources ?? []).filter((source) => source.eligible)
      .map((source) => source.pointer.workId),
    ...(candidateEligibility?.sources ?? []).filter((source) => source.eligible)
      .map((source) => source.pointer.workId),
  ]);
  if (sourceWorkIds.has(fieldObservation.workId)) throw new Error('field Work must be independent from qualification sources');
  const performance = pareto(comparison.baseline, comparison.candidate);
  if (!performance.noWorse || !performance.improved.length) {
    throw new Error('candidate has no verified Pareto improvement');
  }
  const evidence = {
    capability: comparison.capability,
    baselineRunIds: comparison.baseline.runs.map((run) => run.runId),
    candidateRunIds: comparison.candidate.runs.map((run) => run.runId),
    pairEvaluations: pairEvaluations.map((item) => ({
      baselineRunId: item.baselineRunId, candidateRunId: item.candidateRunId,
      evaluatorRunId: item.evaluatorRunId, evaluationDigest: item.evaluationDigest,
    })),
    triggerEvaluation: { evaluatorRunId: triggerEvaluation.evaluatorRunId,
      evaluationDigest: triggerEvaluation.evaluationDigest },
    fieldObservation: { workId: fieldObservation.workId, runId: fieldObservation.runId,
      resultDigest: fieldObservation.resultDigest },
    performance,
  };
  return {
    ...structuredClone(comparison),
    comparisonBoundary: { ...(comparison.comparisonBoundary ?? {}),
      samePurposeVerified: true, answerCorrectnessMeasured: true, qualityMeasured: true,
      sourceEligibilityVerified: true, triggerHoldoutVerified: true,
      fieldObservationVerified: true, lifecycleChanges: 0 },
    qualificationReceipt: { state: 'qualified', digest: digest(evidence), evidence },
  };
}
