import { createHash } from 'node:crypto';

function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function reject(code, message) { const error = new Error(message); error.code = code; throw error; }
function eligible(report) { return new Set((report?.sources ?? []).filter((source) => source.eligible)
  .map((source) => source.pointer.runId)); }
function metric(arm, name) {
  if (name === 'durationMs' || name === 'modelTurns') return arm?.[name]?.median ?? null;
  return Number.isFinite(arm?.[name]) ? arm[name] : null;
}

export function qualifyLearningReplay({ comparison, baselineEligibility, candidateEligibility,
  pairEvaluations = [], triggerEvaluation = null } = {}) {
  const baselineRuns = comparison?.baseline?.runs ?? []; const candidateRuns = comparison?.candidate?.runs ?? [];
  if (baselineRuns.length < 2 || baselineRuns.length !== candidateRuns.length
    || pairEvaluations.length !== baselineRuns.length) reject('learning_replay_pairing_failed', 'paired repeated replay is required');
  const baselineSet = eligible(baselineEligibility); const candidateSet = eligible(candidateEligibility);
  if (baselineRuns.some((run) => !baselineSet.has(run.runId))
    || candidateRuns.some((run) => !candidateSet.has(run.runId))) reject('learning_replay_source_ineligible', 'replay Work source is ineligible');
  const seen = new Set();
  for (const item of pairEvaluations) {
    const key = `${item.baselineRunId}:${item.candidateRunId}`;
    if (seen.has(key) || !baselineRuns.some((run) => run.runId === item.baselineRunId)
      || !candidateRuns.some((run) => run.runId === item.candidateRunId)
      || item.samePurpose !== true || item.baselineCorrect !== true || item.candidateCorrect !== true
      || item.baselineComplete !== true || item.candidateComplete !== true
      || item.userCorrectionPreserved !== true || !item.evaluatorRunId || !item.evaluationDigest) {
      reject('learning_replay_correctness_failed', 'replay purpose or correctness verification failed');
    }
    seen.add(key);
  }
  if (!triggerEvaluation || triggerEvaluation.sourceExpressionsReused !== false
    || triggerEvaluation.falsePositiveCount !== 0 || triggerEvaluation.falseNegativeCount !== 0
    || !triggerEvaluation.evaluatorRunId || !triggerEvaluation.evaluationDigest) {
    reject('learning_replay_trigger_failed', 'replay trigger holdout failed');
  }
  const measured = ['durationMs', 'modelTurns', 'toolCalls', 'failedToolCalls', 'notExecutedToolCalls']
    .filter((name) => Number.isFinite(metric(comparison.baseline, name))
      && Number.isFinite(metric(comparison.candidate, name)));
  const noWorse = measured.length > 0 && measured.every((name) => (
    metric(comparison.candidate, name) <= metric(comparison.baseline, name)
  ));
  const improved = measured.filter((name) => metric(comparison.candidate, name) < metric(comparison.baseline, name));
  if (!noWorse || !improved.length) reject('learning_replay_pareto_failed', 'replay has no Pareto improvement');
  const evidence = { baselineRunIds: baselineRuns.map((run) => run.runId),
    candidateRunIds: candidateRuns.map((run) => run.runId),
    evaluations: pairEvaluations.map((item) => structuredClone(item)), triggerEvaluation,
    performance: { measured, noWorse, improved } };
  return { state: 'replay_qualified', digest: hash(evidence), evidence,
    comparison: { ...structuredClone(comparison), comparisonBoundary: {
      ...(comparison.comparisonBoundary ?? {}), samePurposeVerified: true,
      answerCorrectnessMeasured: true, qualityMeasured: true,
      sourceEligibilityVerified: true, triggerHoldoutVerified: true,
      fieldObservationVerified: false, lifecycleChanges: 0 } } };
}

export async function executeLearningReplay({ cases = [], executeArm, evaluatePair, evaluateTrigger } = {}) {
  if (cases.length < 2 || typeof executeArm !== 'function' || typeof evaluatePair !== 'function'
    || typeof evaluateTrigger !== 'function') throw new TypeError('learning replay inputs are required');
  const baseline = []; const candidate = []; const evaluations = [];
  for (const [index, item] of cases.entries()) {
    const order = index % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
    const results = {};
    for (const arm of order) results[arm] = await executeArm({ arm, case: structuredClone(item) });
    baseline.push(results.baseline); candidate.push(results.candidate);
    evaluations.push(await evaluatePair({ case: structuredClone(item),
      baseline: results.baseline, candidate: results.candidate }));
  }
  return { baseline, candidate, evaluations,
    triggerEvaluation: await evaluateTrigger({ cases: structuredClone(cases) }) };
}
