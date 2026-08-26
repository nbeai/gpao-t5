import { createHash } from 'node:crypto';

import {
  consumePrincipleFieldEvidence,
  consumePrincipleReplayEvidence,
  validatePersistedPrincipleFieldMaterialization,
  validatePersistedPrincipleReplayMaterialization,
} from './principle-evidence-materializer.js';

const CANDIDATE_INPUT_FIELDS = new Set([
  'principleId', 'statement', 'scope', 'sourceReflectionIds',
  'independentEpisodeIds', 'counterexampleIds',
]);
const CANDIDATE_FIELDS = new Set([
  'schema', 'principleId', 'statement', 'scope', 'sourceReflectionIds',
  'independentEpisodeIds', 'counterexampleIds', 'baselineRunIds',
  'candidateRunIds', 'fieldRunIds', 'measuredBenefit', 'state',
  'revisionDigest', 'stateHistory',
]);
const BENEFIT_FIELDS = new Set([
  'correctness', 'completeness', 'userCorrections', 'wallMs', 'providerTokens',
]);
const HISTORY_FIELDS = new Set(['from', 'to', 'evidenceDigest']);
const REPLAY_INPUT_FIELDS = new Set([
  'candidate', 'pairs', 'nearMiss', 'counterexamples', 'sideEffects',
]);
const PAIR_FIELDS = new Set([
  'pairId', 'purposeDigest', 'executionOrder', 'baseline', 'candidate', 'evaluation',
]);
const RUN_FIELDS = new Set([
  'episodeId', 'workId', 'runId', 'resultDigest', 'eligibilityDigest',
  'sourceRecordDigest', 'contextReceiptDigest', 'principleRevisionDigest',
  'achieved', 'effectKnown', 'deliveryTerminal',
  'currentCorrectionHeadDigest', 'currentCorrectionReopened', 'metrics',
]);
const METRIC_FIELDS = new Set(['userCorrections', 'wallMs', 'providerTokens']);
const EVALUATION_FIELDS = new Set([
  'pairedEvaluation', 'blind', 'armMappingDigest', 'evaluatorRunId',
  'evaluatorIdentityDigest', 'evaluatorPromptDigest', 'evaluationInputDigest',
  'evaluationDigest', 'taskOracleDigest', 'samePurpose', 'baselineOraclePassed',
  'candidateOraclePassed', 'baselineCorrect', 'candidateCorrect',
  'baselineComplete', 'candidateComplete', 'userCorrectionPreserved',
  'sourceExpressionsReused',
]);
const NEAR_MISS_FIELDS = new Set([
  'nearMissId', 'episodeId', 'workId', 'runId', 'resultDigest',
  'sourceRecordDigest', 'evaluatorIdentityDigest', 'evaluatorPromptDigest',
  'evaluationDigest', 'expectedTrigger', 'observedTrigger', 'sourceExpressionsReused',
]);
const COUNTEREXAMPLE_FIELDS = new Set([
  'counterexampleId', 'episodeId', 'workId', 'runId', 'resultDigest',
  'evidenceDigest', 'disposition',
]);
const SIDE_EFFECT_FIELDS = new Set([
  'memoryWrites', 'principleWrites', 'managedSkillWrites', 'managedCliWrites',
  'pluginWrites', 'externalWrites',
]);
const REPLAY_QUALIFICATION_FIELDS = new Set([
  'schema', 'candidate', 'evidence', 'receipt', 'materializationReceipt',
  'materializationDigest', 'sideEffects', 'qualificationDigest',
]);
const REPLAY_EVIDENCE_FIELDS = new Set(['pairs', 'nearMiss', 'counterexamples']);
const REPLAY_RECEIPT_FIELDS = new Set([
  'schema', 'principleId', 'principleRevisionDigest', 'evaluatorIdentityDigest',
  'evaluatorPromptDigest', 'currentCorrectionHeadDigest', 'pairDigests',
  'nearMissDigest', 'counterexampleDigests', 'pareto', 'receiptDigest',
]);
const PARETO_FIELDS = new Set(['measured', 'noWorse', 'improved', 'advantages']);
const FIELD_INPUT_FIELDS = new Set(['replayQualification', 'field', 'sideEffects']);
const FIELD_FIELDS = new Set([
  'fieldId', 'episodeId', 'workId', 'runId', 'resultDigest', 'eligibilityDigest',
  'sourceRecordDigest', 'contextReceiptDigest', 'principleRevisionDigest',
  'evaluatorIdentityDigest', 'evaluatorPromptDigest', 'evaluationDigest',
  'currentCorrectionHeadDigest', 'candidateRevisionUsed', 'achieved', 'correct',
  'complete', 'currentCorrectionReopened', 'userCorrectionPreserved',
  'effectKnown', 'deliveryTerminal', 'regressionObserved', 'metrics',
]);
const FIELD_QUALIFICATION_FIELDS = new Set([
  'schema', 'candidate', 'replayQualification', 'fieldReceipt', 'materializationReceipt',
  'materializationDigest', 'sideEffects', 'qualificationDigest',
]);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function exact(value, fields, label) {
  object(value, label);
  for (const field of Object.keys(value)) {
    if (!fields.has(field)) throw new TypeError(`${label} has unknown field: ${field}`);
  }
  for (const field of fields) {
    if (!(field in value)) throw new TypeError(`${label}.${field} is required`);
  }
}

function text(value, label, maximum = 256) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} must be bounded non-empty text`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function identifiers(value, label, { minimum = 0, maximum = 128 } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const result = value.map((item) => text(item, `${label} item`));
  if (new Set(result).size !== result.length) throw new TypeError(`${label} must be unique`);
  return result.toSorted();
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function nonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be non-negative`);
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function zeroSideEffects(input) {
  exact(input, SIDE_EFFECT_FIELDS, 'PrincipleQualification.sideEffects');
  const result = Object.fromEntries([...SIDE_EFFECT_FIELDS].map((field) => [field, input[field]]));
  if (Object.values(result).some((value) => value !== 0)) {
    throw new TypeError('Principle qualification cannot write Memory, capabilities, plugins, or external state');
  }
  return result;
}

function measuredBenefit(input) {
  exact(input, BENEFIT_FIELDS, 'PrincipleCandidate.measuredBenefit');
  const result = {};
  for (const field of BENEFIT_FIELDS) {
    const value = input[field];
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      throw new TypeError(`PrincipleCandidate.measuredBenefit.${field} is invalid`);
    }
    result[field] = value;
  }
  return result;
}

function history(input, state, revisionDigest) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 8) {
    throw new TypeError('Principle stateHistory must be bounded');
  }
  let prior = null;
  for (const [index, item] of input.entries()) {
    exact(item, HISTORY_FIELDS, 'PrincipleStateTransition');
    if (item.from !== prior || !['candidate', 'replay_qualified', 'field_qualified'].includes(item.to)) {
      throw new TypeError('Principle stateHistory is not contiguous');
    }
    digest(item.evidenceDigest, 'PrincipleStateTransition.evidenceDigest');
    if (index === 0 && (item.from !== null || item.to !== 'candidate'
      || item.evidenceDigest !== revisionDigest)) {
      throw new TypeError('Principle stateHistory must start at the exact candidate revision');
    }
    if (index > 0 && !((item.from === 'candidate' && item.to === 'replay_qualified')
      || (item.from === 'replay_qualified' && item.to === 'field_qualified'))) {
      throw new TypeError('Principle stateHistory skips a qualification gate');
    }
    prior = item.to;
  }
  if (prior !== state) throw new TypeError('Principle state does not match stateHistory');
  return structuredClone(input);
}

function semanticCandidate(candidate) {
  return { principleId: candidate.principleId, statement: candidate.statement,
    scope: candidate.scope, sourceReflectionIds: candidate.sourceReflectionIds,
    independentEpisodeIds: candidate.independentEpisodeIds,
    counterexampleIds: candidate.counterexampleIds };
}

export function makePrincipleCandidate(input = {}) {
  exact(input, CANDIDATE_INPUT_FIELDS, 'PrincipleCandidateInput');
  const semantic = {
    principleId: text(input.principleId, 'principleId'),
    statement: text(input.statement, 'statement', 4_000),
    scope: identifiers(input.scope, 'scope', { minimum: 1, maximum: 32 }),
    sourceReflectionIds: identifiers(input.sourceReflectionIds, 'sourceReflectionIds', { minimum: 1 }),
    independentEpisodeIds: identifiers(input.independentEpisodeIds, 'independentEpisodeIds', { minimum: 2 }),
    counterexampleIds: identifiers(input.counterexampleIds, 'counterexampleIds', { minimum: 1 }),
  };
  const revisionDigest = hash({ schema: 't5.principle-candidate.semantic.v1', ...semantic });
  return deepFreeze({ schema: 't5.principle-candidate.v1', ...semantic,
    baselineRunIds: [], candidateRunIds: [], fieldRunIds: [],
    measuredBenefit: { correctness: null, completeness: null, userCorrections: null,
      wallMs: null, providerTokens: null },
    state: 'candidate', revisionDigest,
    stateHistory: [{ from: null, to: 'candidate', evidenceDigest: revisionDigest }] });
}

export function validatePrincipleCandidate(input) {
  exact(input, CANDIDATE_FIELDS, 'PrincipleCandidate');
  if (input.schema !== 't5.principle-candidate.v1') throw new TypeError('PrincipleCandidate schema is invalid');
  const semantic = semanticCandidate({
    principleId: text(input.principleId, 'principleId'),
    statement: text(input.statement, 'statement', 4_000),
    scope: identifiers(input.scope, 'scope', { minimum: 1, maximum: 32 }),
    sourceReflectionIds: identifiers(input.sourceReflectionIds, 'sourceReflectionIds', { minimum: 1 }),
    independentEpisodeIds: identifiers(input.independentEpisodeIds, 'independentEpisodeIds', { minimum: 2 }),
    counterexampleIds: identifiers(input.counterexampleIds, 'counterexampleIds', { minimum: 1 }),
  });
  const revisionDigest = digest(input.revisionDigest, 'revisionDigest');
  if (revisionDigest !== hash({ schema: 't5.principle-candidate.semantic.v1', ...semantic })) {
    throw new TypeError('Principle candidate revision digest changed');
  }
  if (!['candidate', 'replay_qualified', 'field_qualified'].includes(input.state)) {
    throw new TypeError('Principle candidate state is invalid');
  }
  const result = { schema: input.schema, ...semantic,
    baselineRunIds: identifiers(input.baselineRunIds, 'baselineRunIds'),
    candidateRunIds: identifiers(input.candidateRunIds, 'candidateRunIds'),
    fieldRunIds: identifiers(input.fieldRunIds, 'fieldRunIds'),
    measuredBenefit: measuredBenefit(input.measuredBenefit), state: input.state,
    revisionDigest, stateHistory: history(input.stateHistory, input.state, revisionDigest) };
  if ((result.state === 'candidate' && (result.baselineRunIds.length || result.candidateRunIds.length
      || result.fieldRunIds.length || Object.values(result.measuredBenefit).some((value) => value !== null)))
    || (result.state === 'replay_qualified' && (!result.baselineRunIds.length
      || result.baselineRunIds.length !== result.candidateRunIds.length || result.fieldRunIds.length))
    || (result.state === 'field_qualified' && (!result.baselineRunIds.length
      || result.baselineRunIds.length !== result.candidateRunIds.length || result.fieldRunIds.length !== 1))) {
    throw new TypeError('Principle candidate evidence does not match its state');
  }
  return result;
}

function metrics(input, label) {
  exact(input, METRIC_FIELDS, `${label}.metrics`);
  if (!Number.isSafeInteger(input.userCorrections) || !Number.isSafeInteger(input.providerTokens)) {
    throw new TypeError(`${label} correction and provider-token metrics must be exact integers`);
  }
  return { userCorrections: nonNegative(input.userCorrections, `${label}.userCorrections`),
    wallMs: nonNegative(input.wallMs, `${label}.wallMs`),
    providerTokens: nonNegative(input.providerTokens, `${label}.providerTokens`) };
}

function runEvidence(input, label, revisionDigest, candidateArm) {
  exact(input, RUN_FIELDS, label);
  const result = { episodeId: text(input.episodeId, `${label}.episodeId`),
    workId: text(input.workId, `${label}.workId`), runId: text(input.runId, `${label}.runId`),
    resultDigest: digest(input.resultDigest, `${label}.resultDigest`),
    eligibilityDigest: digest(input.eligibilityDigest, `${label}.eligibilityDigest`),
    sourceRecordDigest: digest(input.sourceRecordDigest, `${label}.sourceRecordDigest`),
    contextReceiptDigest: digest(input.contextReceiptDigest, `${label}.contextReceiptDigest`),
    principleRevisionDigest: input.principleRevisionDigest === null ? null
      : digest(input.principleRevisionDigest, `${label}.principleRevisionDigest`),
    achieved: input.achieved, effectKnown: input.effectKnown, deliveryTerminal: input.deliveryTerminal,
    currentCorrectionHeadDigest: digest(input.currentCorrectionHeadDigest,
      `${label}.currentCorrectionHeadDigest`),
    currentCorrectionReopened: input.currentCorrectionReopened,
    metrics: metrics(input.metrics, label) };
  if (result.achieved !== true || result.effectKnown !== true || result.deliveryTerminal !== true
    || result.currentCorrectionReopened !== true
    || (candidateArm ? result.principleRevisionDigest !== revisionDigest
      : result.principleRevisionDigest !== null)) {
    throw new TypeError(`${label} is not exact achieved eligible evidence for its arm`);
  }
  return result;
}

function pairInputDigest(pair) {
  return hash({ schema: 't5.principle-pair-evaluation-input.v1', pairId: pair.pairId,
    purposeDigest: pair.purposeDigest, executionOrder: pair.executionOrder,
    baseline: pair.baseline, candidate: pair.candidate });
}

function evaluation(input, pair, correctionDigest) {
  exact(input, EVALUATION_FIELDS, 'PrinciplePairEvaluation');
  const result = { pairedEvaluation: input.pairedEvaluation, blind: input.blind,
    armMappingDigest: digest(input.armMappingDigest, 'armMappingDigest'),
    evaluatorRunId: text(input.evaluatorRunId, 'evaluatorRunId'),
    evaluatorIdentityDigest: digest(input.evaluatorIdentityDigest, 'evaluatorIdentityDigest'),
    evaluatorPromptDigest: digest(input.evaluatorPromptDigest, 'evaluatorPromptDigest'),
    evaluationInputDigest: digest(input.evaluationInputDigest, 'evaluationInputDigest'),
    evaluationDigest: digest(input.evaluationDigest, 'evaluationDigest'),
    taskOracleDigest: digest(input.taskOracleDigest, 'taskOracleDigest'),
    samePurpose: input.samePurpose, baselineOraclePassed: input.baselineOraclePassed,
    candidateOraclePassed: input.candidateOraclePassed, baselineCorrect: input.baselineCorrect,
    candidateCorrect: input.candidateCorrect, baselineComplete: input.baselineComplete,
    candidateComplete: input.candidateComplete, userCorrectionPreserved: input.userCorrectionPreserved,
    sourceExpressionsReused: input.sourceExpressionsReused };
  if (result.pairedEvaluation !== true || result.blind !== true
    || result.evaluationInputDigest !== pairInputDigest(pair)
    || [result.samePurpose, result.baselineOraclePassed, result.candidateOraclePassed,
      result.baselineCorrect, result.candidateCorrect, result.baselineComplete,
      result.candidateComplete, result.userCorrectionPreserved].some((value) => value !== true)
    || result.sourceExpressionsReused !== false
    || pair.baseline.currentCorrectionHeadDigest !== correctionDigest
    || pair.candidate.currentCorrectionHeadDigest !== correctionDigest) {
    throw new TypeError('Principle paired task oracle, correction, or blind evaluation failed');
  }
  return result;
}

function normalizePair(input, revisionDigest, correctionDigest) {
  exact(input, PAIR_FIELDS, 'PrincipleReplayPair');
  if (!['baseline_first', 'candidate_first'].includes(input.executionOrder)) {
    throw new TypeError('Principle replay executionOrder is invalid');
  }
  const pair = { pairId: text(input.pairId, 'pairId'), purposeDigest: digest(input.purposeDigest, 'purposeDigest'),
    executionOrder: input.executionOrder,
    baseline: runEvidence(input.baseline, 'baseline', revisionDigest, false),
    candidate: runEvidence(input.candidate, 'candidate', revisionDigest, true) };
  pair.evaluation = evaluation(input.evaluation, pair, correctionDigest);
  return pair;
}

function nearMiss(input, evaluatorIdentityDigest, evaluatorPromptDigest) {
  exact(input, NEAR_MISS_FIELDS, 'PrincipleNearMiss');
  const result = { nearMissId: text(input.nearMissId, 'nearMissId'),
    episodeId: text(input.episodeId, 'nearMiss.episodeId'), workId: text(input.workId, 'nearMiss.workId'),
    runId: text(input.runId, 'nearMiss.runId'), resultDigest: digest(input.resultDigest, 'nearMiss.resultDigest'),
    sourceRecordDigest: digest(input.sourceRecordDigest, 'nearMiss.sourceRecordDigest'),
    evaluatorIdentityDigest: digest(input.evaluatorIdentityDigest, 'nearMiss.evaluatorIdentityDigest'),
    evaluatorPromptDigest: digest(input.evaluatorPromptDigest, 'nearMiss.evaluatorPromptDigest'),
    evaluationDigest: digest(input.evaluationDigest, 'nearMiss.evaluationDigest'),
    expectedTrigger: input.expectedTrigger, observedTrigger: input.observedTrigger,
    sourceExpressionsReused: input.sourceExpressionsReused };
  if (result.evaluatorIdentityDigest !== evaluatorIdentityDigest
    || result.evaluatorPromptDigest !== evaluatorPromptDigest
    || result.expectedTrigger !== false || result.observedTrigger !== false
    || result.sourceExpressionsReused !== false) {
    throw new TypeError('Principle near-miss holdout failed');
  }
  return result;
}

function counterexample(input) {
  exact(input, COUNTEREXAMPLE_FIELDS, 'PrincipleCounterexample');
  const result = { counterexampleId: text(input.counterexampleId, 'counterexampleId'),
    episodeId: text(input.episodeId, 'counterexample.episodeId'),
    workId: text(input.workId, 'counterexample.workId'), runId: text(input.runId, 'counterexample.runId'),
    resultDigest: digest(input.resultDigest, 'counterexample.resultDigest'),
    evidenceDigest: digest(input.evidenceDigest, 'counterexample.evidenceDigest'),
    disposition: input.disposition };
  if (result.disposition !== 'scope_boundary') {
    throw new TypeError('a Principle contradicted by evidence cannot be replay-qualified');
  }
  return result;
}

function assertDistinctEvidence(candidate, pairs, near, counters) {
  const episodeIds = [...candidate.independentEpisodeIds]; const workIds = []; const runIds = [];
  for (const pair of pairs) for (const arm of [pair.baseline, pair.candidate]) {
    episodeIds.push(arm.episodeId); workIds.push(arm.workId); runIds.push(arm.runId);
  }
  episodeIds.push(near.episodeId); workIds.push(near.workId); runIds.push(near.runId);
  for (const item of counters) {
    episodeIds.push(item.episodeId); workIds.push(item.workId); runIds.push(item.runId);
  }
  if (new Set(episodeIds).size !== episodeIds.length || new Set(workIds).size !== workIds.length
    || new Set(runIds).size !== runIds.length) {
    throw new TypeError('Principle replay, near-miss, counterexample, and source identities must be independent');
  }
}

function pareto(pairs) {
  const names = ['userCorrections', 'wallMs', 'providerTokens'];
  const advantages = Object.fromEntries(names.map((name) => [name,
    pairs.reduce((sum, pair) => sum + pair.baseline.metrics[name] - pair.candidate.metrics[name], 0)]));
  const noWorse = pairs.every((pair) => names.every((name) => (
    pair.candidate.metrics[name] <= pair.baseline.metrics[name]
  )));
  const improved = names.filter((name) => advantages[name] > 0);
  if (!noWorse || improved.length === 0) throw new TypeError('Principle replay has no pairwise Pareto benefit');
  return { measured: names, noWorse: true, improved, advantages };
}

function replayQualificationDigest(value) {
  return hash({ schema: value.schema, candidate: value.candidate, evidence: value.evidence,
    receipt: value.receipt, materializationReceipt: value.materializationReceipt,
    materializationDigest: value.materializationDigest, sideEffects: value.sideEffects });
}

function qualifyPrincipleReplayExact(input = {}, materialization = null) {
  exact(input, REPLAY_INPUT_FIELDS, 'PrincipleReplayInput');
  const sourceCandidate = validatePrincipleCandidate(input.candidate);
  if (sourceCandidate.state !== 'candidate') throw new TypeError('Principle replay requires a candidate');
  if (!Array.isArray(input.pairs) || input.pairs.length < 2 || input.pairs.length > 20) {
    throw new TypeError('Principle replay requires at least two blind pairs');
  }
  const firstCorrection = digest(input.pairs[0]?.baseline?.currentCorrectionHeadDigest,
    'currentCorrectionHeadDigest');
  const pairs = input.pairs.map((pair) => normalizePair(pair, sourceCandidate.revisionDigest, firstCorrection));
  if (new Set(pairs.map((pair) => pair.pairId)).size !== pairs.length
    || pairs.some((pair, index) => index > 0
      && pair.executionOrder === pairs[index - 1].executionOrder)) {
    throw new TypeError('Principle replay must alternate baseline and candidate execution order');
  }
  const evaluatorIdentityDigest = pairs[0].evaluation.evaluatorIdentityDigest;
  const evaluatorPromptDigest = pairs[0].evaluation.evaluatorPromptDigest;
  if (pairs.some((pair) => pair.evaluation.evaluatorIdentityDigest !== evaluatorIdentityDigest
    || pair.evaluation.evaluatorPromptDigest !== evaluatorPromptDigest)) {
    throw new TypeError('Principle replay must use one evaluator identity and prompt');
  }
  const normalizedNearMiss = nearMiss(input.nearMiss, evaluatorIdentityDigest, evaluatorPromptDigest);
  if (!Array.isArray(input.counterexamples) || input.counterexamples.length < 1) {
    throw new TypeError('Principle replay requires counterexample evidence');
  }
  const counters = input.counterexamples.map(counterexample);
  if (new Set(counters.map((item) => item.counterexampleId)).size !== counters.length
    || JSON.stringify(counters.map((item) => item.counterexampleId).toSorted())
      !== JSON.stringify(sourceCandidate.counterexampleIds)) {
    throw new TypeError('Principle replay omitted an authoritative counterexample');
  }
  assertDistinctEvidence(sourceCandidate, pairs, normalizedNearMiss, counters);
  const performance = pareto(pairs);
  const pairDigests = pairs.map((pair) => hash(pair));
  const nearMissDigest = hash(normalizedNearMiss); const counterexampleDigests = counters.map(hash);
  const receiptCore = { schema: 't5.principle-replay-receipt.v1',
    principleId: sourceCandidate.principleId, principleRevisionDigest: sourceCandidate.revisionDigest,
    evaluatorIdentityDigest, evaluatorPromptDigest, currentCorrectionHeadDigest: firstCorrection,
    pairDigests, nearMissDigest, counterexampleDigests, pareto: performance };
  const receipt = { ...receiptCore, receiptDigest: hash(receiptCore) };
  const candidate = { ...structuredClone(sourceCandidate),
    baselineRunIds: pairs.map((pair) => pair.baseline.runId).toSorted(),
    candidateRunIds: pairs.map((pair) => pair.candidate.runId).toSorted(), fieldRunIds: [],
    measuredBenefit: { correctness: 0, completeness: 0,
      userCorrections: performance.advantages.userCorrections,
      wallMs: performance.advantages.wallMs, providerTokens: performance.advantages.providerTokens },
    state: 'replay_qualified', stateHistory: [...sourceCandidate.stateHistory,
      { from: 'candidate', to: 'replay_qualified', evidenceDigest: receipt.receiptDigest }] };
  const result = { schema: 't5.principle-replay-qualification.v1',
    candidate: validatePrincipleCandidate(candidate),
    evidence: { pairs, nearMiss: normalizedNearMiss, counterexamples: counters },
    receipt, materializationReceipt: structuredClone(materialization?.receipt ?? null),
    materializationDigest: digest(materialization?.materializationDigest, 'materializationDigest'),
    sideEffects: zeroSideEffects(input.sideEffects), qualificationDigest: '' };
  result.qualificationDigest = replayQualificationDigest(result);
  return deepFreeze(result);
}

export function validatePrincipleReplayQualification(input) {
  exact(input, REPLAY_QUALIFICATION_FIELDS, 'PrincipleReplayQualification');
  if (input.schema !== 't5.principle-replay-qualification.v1') {
    throw new TypeError('PrincipleReplayQualification schema is invalid');
  }
  validatePersistedPrincipleReplayMaterialization(input.materializationReceipt,
    input.materializationDigest);
  const candidate = validatePrincipleCandidate(input.candidate);
  if (candidate.state !== 'replay_qualified') throw new TypeError('Principle replay candidate state is invalid');
  exact(input.evidence, REPLAY_EVIDENCE_FIELDS, 'PrincipleReplayEvidence');
  exact(input.receipt, REPLAY_RECEIPT_FIELDS, 'PrincipleReplayReceipt');
  exact(input.receipt.pareto, PARETO_FIELDS, 'PrincipleReplayPareto');
  digest(input.qualificationDigest, 'qualificationDigest'); zeroSideEffects(input.sideEffects);
  const initial = makePrincipleCandidate(semanticCandidate(candidate));
  const rebuilt = qualifyPrincipleReplayExact({ candidate: initial,
    pairs: input.evidence.pairs, nearMiss: input.evidence.nearMiss,
    counterexamples: input.evidence.counterexamples, sideEffects: input.sideEffects }, {
    receipt: input.materializationReceipt, materializationDigest: input.materializationDigest });
  if (hash(rebuilt) !== hash(input)) {
    throw new TypeError('Principle replay qualification digest is invalid');
  }
  return structuredClone(rebuilt);
}

function fieldEvidence(input, replay) {
  exact(input, FIELD_FIELDS, 'PrincipleFieldEvidence');
  const result = { fieldId: text(input.fieldId, 'fieldId'), episodeId: text(input.episodeId, 'field.episodeId'),
    workId: text(input.workId, 'field.workId'), runId: text(input.runId, 'field.runId'),
    resultDigest: digest(input.resultDigest, 'field.resultDigest'),
    eligibilityDigest: digest(input.eligibilityDigest, 'field.eligibilityDigest'),
    sourceRecordDigest: digest(input.sourceRecordDigest, 'field.sourceRecordDigest'),
    contextReceiptDigest: digest(input.contextReceiptDigest, 'field.contextReceiptDigest'),
    principleRevisionDigest: digest(input.principleRevisionDigest, 'field.principleRevisionDigest'),
    evaluatorIdentityDigest: digest(input.evaluatorIdentityDigest, 'field.evaluatorIdentityDigest'),
    evaluatorPromptDigest: digest(input.evaluatorPromptDigest, 'field.evaluatorPromptDigest'),
    evaluationDigest: digest(input.evaluationDigest, 'field.evaluationDigest'),
    currentCorrectionHeadDigest: digest(input.currentCorrectionHeadDigest, 'field.currentCorrectionHeadDigest'),
    candidateRevisionUsed: input.candidateRevisionUsed, achieved: input.achieved,
    correct: input.correct, complete: input.complete,
    currentCorrectionReopened: input.currentCorrectionReopened,
    userCorrectionPreserved: input.userCorrectionPreserved, effectKnown: input.effectKnown,
    deliveryTerminal: input.deliveryTerminal, regressionObserved: input.regressionObserved,
    metrics: metrics(input.metrics, 'field') };
  if (result.principleRevisionDigest !== replay.candidate.revisionDigest
    || result.evaluatorIdentityDigest !== replay.receipt.evaluatorIdentityDigest
    || result.evaluatorPromptDigest !== replay.receipt.evaluatorPromptDigest
    || result.currentCorrectionHeadDigest !== replay.receipt.currentCorrectionHeadDigest
    || [result.candidateRevisionUsed, result.achieved, result.correct, result.complete,
      result.currentCorrectionReopened, result.userCorrectionPreserved, result.effectKnown,
      result.deliveryTerminal].some((value) => value !== true)
    || result.regressionObserved !== false) {
    throw new TypeError('independent Principle field Work did not preserve qualification');
  }
  const usedEpisodes = new Set([...replay.candidate.independentEpisodeIds,
    ...replay.evidence.pairs.flatMap((pair) => [pair.baseline.episodeId, pair.candidate.episodeId]),
    replay.evidence.nearMiss.episodeId,
    ...replay.evidence.counterexamples.map((item) => item.episodeId)]);
  const usedWorks = new Set([...replay.evidence.pairs.flatMap((pair) => [pair.baseline.workId,
    pair.candidate.workId]), replay.evidence.nearMiss.workId,
    ...replay.evidence.counterexamples.map((item) => item.workId)]);
  const usedRuns = new Set([...replay.evidence.pairs.flatMap((pair) => [pair.baseline.runId,
    pair.candidate.runId]), replay.evidence.nearMiss.runId,
    ...replay.evidence.counterexamples.map((item) => item.runId)]);
  if (usedEpisodes.has(result.episodeId) || usedWorks.has(result.workId) || usedRuns.has(result.runId)) {
    throw new TypeError('Principle field Work must be independent from all qualification evidence');
  }
  return result;
}

function fieldQualificationDigest(value) {
  return hash({ schema: value.schema, candidate: value.candidate,
    replayQualification: value.replayQualification,
    fieldReceipt: value.fieldReceipt, materializationReceipt: value.materializationReceipt,
    materializationDigest: value.materializationDigest, sideEffects: value.sideEffects });
}

function qualifyPrincipleFieldExact(input = {}, materialization = null) {
  exact(input, FIELD_INPUT_FIELDS, 'PrincipleFieldInput');
  const replay = validatePrincipleReplayQualification(input.replayQualification);
  const field = fieldEvidence(input.field, replay);
  const fieldCore = { schema: 't5.principle-field-receipt.v1', ...field };
  const fieldReceipt = { ...fieldCore, receiptDigest: hash(fieldCore) };
  const candidate = { ...structuredClone(replay.candidate), fieldRunIds: [field.runId],
    state: 'field_qualified', stateHistory: [...replay.candidate.stateHistory,
      { from: 'replay_qualified', to: 'field_qualified', evidenceDigest: fieldReceipt.receiptDigest }] };
  const result = { schema: 't5.principle-field-qualification.v1',
    candidate: validatePrincipleCandidate(candidate), replayQualification: structuredClone(replay), fieldReceipt,
    materializationReceipt: structuredClone(materialization?.receipt ?? null),
    materializationDigest: digest(materialization?.materializationDigest, 'materializationDigest'),
    sideEffects: zeroSideEffects(input.sideEffects), qualificationDigest: '' };
  result.qualificationDigest = fieldQualificationDigest(result);
  return deepFreeze(result);
}

export function validatePrincipleFieldQualification(input) {
  exact(input, FIELD_QUALIFICATION_FIELDS, 'PrincipleFieldQualification');
  if (input.schema !== 't5.principle-field-qualification.v1') {
    throw new TypeError('PrincipleFieldQualification schema is invalid');
  }
  validatePersistedPrincipleFieldMaterialization(input.materializationReceipt,
    input.materializationDigest);
  const candidate = validatePrincipleCandidate(input.candidate);
  if (candidate.state !== 'field_qualified') throw new TypeError('Principle field candidate state is invalid');
  const replay = validatePrincipleReplayQualification(input.replayQualification);
  exact(input.fieldReceipt, new Set(['schema', ...FIELD_FIELDS, 'receiptDigest']), 'PrincipleFieldReceipt');
  digest(input.qualificationDigest, 'qualificationDigest'); zeroSideEffects(input.sideEffects);
  const { schema: fieldSchema, receiptDigest, ...field } = input.fieldReceipt;
  if (fieldSchema !== 't5.principle-field-receipt.v1'
    || receiptDigest !== hash({ schema: fieldSchema, ...field })) {
    throw new TypeError('Principle field qualification digest is invalid');
  }
  const rebuilt = qualifyPrincipleFieldExact({ replayQualification: replay, field,
    sideEffects: input.sideEffects }, { receipt: input.materializationReceipt,
    materializationDigest: input.materializationDigest });
  if (hash(rebuilt) !== hash(input) || rebuilt.candidate.revisionDigest !== candidate.revisionDigest) {
    throw new TypeError('Principle field qualification digest is invalid');
  }
  return structuredClone(rebuilt);
}

export function qualifyPrincipleReplay(materialization) {
  const consumed = consumePrincipleReplayEvidence(materialization);
  return qualifyPrincipleReplayExact(consumed.payload, consumed);
}

export function qualifyPrincipleField(materialization) {
  const consumed = consumePrincipleFieldEvidence(materialization);
  return qualifyPrincipleFieldExact(consumed.payload, consumed);
}
