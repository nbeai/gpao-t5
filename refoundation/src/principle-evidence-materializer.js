import { createHash } from 'node:crypto';

const REPLAY_MATERIALIZATIONS = new WeakSet();
const FIELD_MATERIALIZATIONS = new WeakSet();
const EVIDENCE_RUNTIMES = new WeakSet();
const REPLAY_FIELDS = new Set([
  'candidate', 'pairs', 'nearMiss', 'counterexamples', 'sideEffects', 'runtime',
]);
const REFLECTION_FIELDS = new Set([
  'reflectionId', 'revisionDigest', 'materializationDigest', 'reviewReceiptDigest',
  'state', 'decision', 'scopeHandles', 'counterexampleIds',
]);
const PAIR_RECEIPT_FIELDS = new Set([
  'pairId', 'armMapping', 'baselineHead', 'candidateHead', 'evaluatorRequest',
  'evaluatorOutput', 'taskOracleReceipt', 'receiptDigest',
]);
const ARM_MAPPING_FIELDS = new Set([
  'baselineLabel', 'candidateLabel', 'randomized', 'mappingDigest',
]);
const RUN_HEAD_FIELDS = new Set([
  'workId', 'runId', 'resultDigest', 'achieved', 'effectKnown', 'deliveryTerminal',
  'principleRevisionDigest', 'contextReceiptDigest', 'recordRefs',
]);
const EVALUATOR_REQUEST_FIELDS = new Set([
  'evaluatorIdentityDigest', 'evaluatorPromptDigest', 'pairInputDigest',
  'armMappingDigest', 'requestDigest',
]);
const EVALUATOR_OUTPUT_FIELDS = new Set(['requestDigest', 'evaluationDigest', 'outputDigest']);
const TASK_ORACLE_FIELDS = new Set([
  'outputDigest', 'taskOracleDigest', 'baselinePassed', 'candidatePassed', 'receiptDigest',
]);
const CORRECTION_FIELDS = new Set(['headDigest', 'recordRefs', 'accountingDigest']);
const SEARCH_FIELDS = new Set(['kind', 'resultIds', 'resultCount', 'resultDigest', 'receiptDigest']);
const SIDE_EFFECT_FIELDS = new Set([
  'memoryWrites', 'principleWrites', 'managedSkillWrites', 'managedCliWrites',
  'pluginWrites', 'externalWrites', 'receiptDigest',
]);
const FIELD_INPUT_FIELDS = new Set([
  'replayQualification', 'field', 'sideEffects', 'runtime',
]);
const FIELD_HEAD_FIELDS = new Set([
  'episodeId', 'workId', 'runId', 'resultDigest', 'achieved', 'effectKnown',
  'deliveryTerminal', 'principleRevisionDigest', 'contextReceiptDigest', 'recordRefs',
]);
const FIELD_EVALUATOR_FIELDS = new Set([
  'evaluatorIdentityDigest', 'evaluatorPromptDigest', 'fieldInputDigest',
  'evaluationDigest', 'receiptDigest',
]);
const REPLAY_RECEIPT_FIELDS = new Set([
  'schema', 'reflectionDigest', 'pairReceiptDigest', 'correctionAccountingDigest',
  'nearMissSearchDigest', 'counterexampleSearchDigest', 'sideEffectDigest',
  'payloadDigest', 'receiptDigest',
]);
const FIELD_RECEIPT_FIELDS = new Set([
  'schema', 'fieldSourceDigest', 'correctionAccountingDigest',
  'evaluatorReceiptDigest', 'payloadDigest', 'receiptDigest',
]);
const RUNTIME_METHODS = [
  'withStableWindow', 'loadReviewedReflections', 'loadCanonicalPair', 'evaluateBlindPair',
  'observeCurrentCorrection', 'searchNearMiss', 'searchCounterexamples',
  'observeSideEffects', 'loadCanonicalField', 'evaluateField',
];

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}
function exact(value, fields, label) {
  object(value, label);
  const keys = Object.keys(value);
  if (keys.length !== fields.size || keys.some((key) => !fields.has(key))) {
    throw new TypeError(`${label} has missing or unknown fields`);
  }
}
function text(value, label) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 256
    || /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}
function digest(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function hash(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function makePrincipleEvidenceRuntime(input = {}) {
  object(input, 'PrincipleEvidenceRuntime');
  if (Object.keys(input).length !== RUNTIME_METHODS.length
    || RUNTIME_METHODS.some((name) => typeof input[name] !== 'function')) {
    throw new TypeError('Principle evidence runtime methods are incomplete');
  }
  const runtime = Object.freeze(Object.fromEntries(RUNTIME_METHODS.map((name) => [name,
    (...args) => input[name](...args)])));
  EVIDENCE_RUNTIMES.add(runtime); return runtime;
}

function requireRuntime(value) {
  if (!value || !EVIDENCE_RUNTIMES.has(value)) {
    throw new TypeError('Principle evidence requires a branded product runtime');
  }
  return value;
}
function sameSet(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length
    && [...left].toSorted().every((value, index) => value === [...right].toSorted()[index]);
}
function sideEffectCore(input) {
  exact(input, SIDE_EFFECT_FIELDS, 'PrincipleSideEffectReceipt');
  const core = Object.fromEntries([...SIDE_EFFECT_FIELDS].filter((field) => field !== 'receiptDigest')
    .map((field) => [field, input[field]]));
  if (Object.values(core).some((value) => value !== 0)
    || input.receiptDigest !== hash({ schema: 't5.principle-side-effects.v1', ...core })) {
    throw new TypeError('Principle runtime side effects are not zero or exact');
  }
  return core;
}

async function reopenAll(reader, refs, label) {
  if (typeof reader?.reopen !== 'function' || !Array.isArray(refs) || refs.length === 0) {
    throw new TypeError(`${label} requires exact RecordRefs and reader`);
  }
  const accounting = [];
  for (const reference of refs) {
    if (!reference?.recordId || !reference.sha256) throw new TypeError(`${label} RecordRef is incomplete`);
    const reopened = await reader.reopen(reference, { expectedSessionId: reference.scope?.sessionId ?? null,
      expectedWorkId: reference.scope?.workId ?? null });
    const observed = reopened?.accounting;
    if (reopened?.state !== 'reopened' || !reopened.source
      || observed?.recordId !== reference.recordId || observed?.availability !== 'available'
      || observed?.digestMatched !== true || observed?.observedSha256 !== reference.sha256) {
      throw new TypeError(`${label} source reopen is not exact`);
    }
    accounting.push({ recordId: reference.recordId, observedSha256: observed.observedSha256 });
  }
  return hash(accounting.toSorted((left, right) => left.recordId.localeCompare(right.recordId)));
}

function reflectionProofs(input, candidate) {
  if (!Array.isArray(input) || input.length === 0) throw new TypeError('reviewed Reflection proof is required');
  const normalized = input.map((item) => {
    exact(item, REFLECTION_FIELDS, 'ReviewedReflectionHead');
    if (!Array.isArray(item.scopeHandles) || !Array.isArray(item.counterexampleIds)) {
      throw new TypeError('reviewed Reflection scope and counterexample identities are required');
    }
    const scopeHandles = item.scopeHandles.map((value) => text(value, 'Reflection scope handle')).toSorted();
    const counterexampleIds = item.counterexampleIds
      .map((value) => text(value, 'Reflection counterexample identity')).toSorted();
    if (new Set(scopeHandles).size !== scopeHandles.length
      || new Set(counterexampleIds).size !== counterexampleIds.length) {
      throw new TypeError('reviewed Reflection scope and counterexample identities must be unique');
    }
    const result = { reflectionId: text(item.reflectionId, 'reflectionId'),
      revisionDigest: digest(item.revisionDigest, 'reflection revisionDigest'),
      materializationDigest: digest(item.materializationDigest, 'reflection materializationDigest'),
      reviewReceiptDigest: digest(item.reviewReceiptDigest, 'reflection reviewReceiptDigest'),
      state: item.state, decision: item.decision, scopeHandles, counterexampleIds };
    if (result.state !== 'reviewed' || result.decision !== 'retain') {
      throw new TypeError('Principle source Reflection must have a retained review receipt');
    }
    return result;
  });
  if (!sameSet(normalized.map((item) => item.reflectionId), candidate.sourceReflectionIds)
    || !sameSet([...new Set(normalized.flatMap((item) => item.scopeHandles))], candidate.scope)
    || !sameSet([...new Set(normalized.flatMap((item) => item.counterexampleIds))], candidate.counterexampleIds)) {
    throw new TypeError('Principle candidate omitted reviewed Reflection scope or counterexample evidence');
  }
  return normalized.toSorted((left, right) => left.reflectionId.localeCompare(right.reflectionId));
}

function runHead(input, arm, pair, revisionDigest) {
  exact(input, RUN_HEAD_FIELDS, `PrinciplePairReceipt.${arm}Head`);
  const expected = pair[arm];
  if (input.workId !== expected.workId || input.runId !== expected.runId
    || input.resultDigest !== expected.resultDigest || input.achieved !== true
    || input.effectKnown !== true || input.deliveryTerminal !== true
    || input.contextReceiptDigest !== expected.contextReceiptDigest
    || input.principleRevisionDigest !== expected.principleRevisionDigest
    || (arm === 'candidate' && input.principleRevisionDigest !== revisionDigest)
    || (arm === 'baseline' && input.principleRevisionDigest !== null)) {
    throw new TypeError(`Principle ${arm} canonical Work/Run/result/context proof mismatch`);
  }
  return input;
}

async function pairProof(input, pair, revisionDigest, reader) {
  exact(input, PAIR_RECEIPT_FIELDS, 'PrinciplePairRuntimeReceipt');
  if (input.pairId !== pair.pairId) throw new TypeError('Principle pair receipt identity mismatch');
  exact(input.armMapping, ARM_MAPPING_FIELDS, 'PrincipleArmMapping');
  const mapping = input.armMapping;
  if (!['A', 'B'].includes(mapping.baselineLabel) || !['A', 'B'].includes(mapping.candidateLabel)
    || mapping.baselineLabel === mapping.candidateLabel || mapping.randomized !== true
    || mapping.mappingDigest !== hash({ pairId: pair.pairId, baselineLabel: mapping.baselineLabel,
      candidateLabel: mapping.candidateLabel, randomized: true })) {
    throw new TypeError('Principle A/B mapping is not opaque and runtime-randomized');
  }
  const baselineHead = runHead(input.baselineHead, 'baseline', pair, revisionDigest);
  const candidateHead = runHead(input.candidateHead, 'candidate', pair, revisionDigest);
  const baselineAccounting = await reopenAll(reader, baselineHead.recordRefs, 'baseline replay');
  const candidateAccounting = await reopenAll(reader, candidateHead.recordRefs, 'candidate replay');
  exact(input.evaluatorRequest, EVALUATOR_REQUEST_FIELDS, 'PrincipleEvaluatorRequest');
  const request = input.evaluatorRequest;
  if (request.evaluatorIdentityDigest !== pair.evaluation.evaluatorIdentityDigest
    || request.evaluatorPromptDigest !== pair.evaluation.evaluatorPromptDigest
    || request.pairInputDigest !== pair.evaluation.evaluationInputDigest
    || request.armMappingDigest !== mapping.mappingDigest
    || request.requestDigest !== hash({ evaluatorIdentityDigest: request.evaluatorIdentityDigest,
      evaluatorPromptDigest: request.evaluatorPromptDigest, pairInputDigest: request.pairInputDigest,
      armMappingDigest: request.armMappingDigest })) {
    throw new TypeError('Principle evaluator request is not bound to the paired input');
  }
  exact(input.evaluatorOutput, EVALUATOR_OUTPUT_FIELDS, 'PrincipleEvaluatorOutput');
  const output = input.evaluatorOutput;
  if (output.requestDigest !== request.requestDigest || output.evaluationDigest !== pair.evaluation.evaluationDigest
    || output.outputDigest !== hash({ requestDigest: output.requestDigest,
      evaluationDigest: output.evaluationDigest })) {
    throw new TypeError('Principle evaluator output is not bound to one request');
  }
  exact(input.taskOracleReceipt, TASK_ORACLE_FIELDS, 'PrincipleTaskOracleReceipt');
  const oracle = input.taskOracleReceipt;
  if (oracle.outputDigest !== output.outputDigest || oracle.taskOracleDigest !== pair.evaluation.taskOracleDigest
    || oracle.baselinePassed !== true || oracle.candidatePassed !== true
    || oracle.receiptDigest !== hash({ outputDigest: oracle.outputDigest,
      taskOracleDigest: oracle.taskOracleDigest, baselinePassed: true, candidatePassed: true })) {
    throw new TypeError('Principle task oracle receipt is not exact');
  }
  const core = { pairId: pair.pairId, armMapping: mapping,
    baselineHead: { ...baselineHead, recordRefs: undefined, accountingDigest: baselineAccounting },
    candidateHead: { ...candidateHead, recordRefs: undefined, accountingDigest: candidateAccounting },
    evaluatorRequest: request, evaluatorOutput: output, taskOracleReceipt: oracle };
  if (input.receiptDigest !== hash(core)) throw new TypeError('Principle pair runtime receipt digest mismatch');
  return core;
}

function searchReceipt(input, expectedKind, expectedIds) {
  exact(input, SEARCH_FIELDS, 'PrincipleSearchReceipt');
  const ids = input.resultIds.map((item) => text(item, 'search result identity')).toSorted();
  if (input.kind !== expectedKind || !sameSet(ids, expectedIds)
    || input.resultCount !== ids.length || input.resultDigest !== hash(ids)
    || input.receiptDigest !== hash({ kind: input.kind, resultIds: ids,
      resultCount: ids.length, resultDigest: input.resultDigest })) {
    throw new TypeError(`Principle ${expectedKind} search receipt is incomplete`);
  }
  return { kind: input.kind, resultIds: ids, resultCount: ids.length,
    resultDigest: input.resultDigest, receiptDigest: input.receiptDigest };
}

export async function materializePrincipleReplayEvidence(input = {}) {
  exact(input, REPLAY_FIELDS, 'PrincipleReplayMaterializerInput');
  const runtime = requireRuntime(input.runtime);
  const candidate = input.candidate;
  if (!candidate?.revisionDigest || candidate.state !== 'candidate') throw new TypeError('Principle candidate is required');
  return runtime.withStableWindow(async () => {
    const reflections = reflectionProofs(await runtime.loadReviewedReflections(candidate), candidate);
    if (!Array.isArray(input.pairs) || input.pairs.length < 2) throw new TypeError('Principle pairs are incomplete');
    const pairs = [];
    for (const [index, pair] of input.pairs.entries()) {
      const canonicalPair = await runtime.loadCanonicalPair(pair, index);
      const evaluated = await runtime.evaluateBlindPair(pair, canonicalPair, index);
      if (hash(canonicalPair.baselineHead) !== hash(evaluated.baselineHead)
        || hash(canonicalPair.candidateHead) !== hash(evaluated.candidateHead)) {
        throw new TypeError('Principle evaluator changed canonical pair heads');
      }
      pairs.push(await pairProof(evaluated, pair, candidate.revisionDigest,
        canonicalPair.recordSourceReader));
    }
    if (new Set(input.pairs.map((pair) => pair.evaluation.evaluationDigest)).size !== input.pairs.length) {
      throw new TypeError('Principle pair evaluation digests must be distinct');
    }
    const correctionObserved = await runtime.observeCurrentCorrection(candidate);
    exact(correctionObserved.proof, CORRECTION_FIELDS, 'PrincipleCurrentCorrectionProof');
    const correctionAccounting = await reopenAll(correctionObserved.recordSourceReader,
      correctionObserved.proof.recordRefs, 'current correction');
    if (correctionObserved.proof.headDigest !== input.pairs[0].baseline.currentCorrectionHeadDigest
      || input.pairs.some((pair) => pair.baseline.currentCorrectionHeadDigest
        !== correctionObserved.proof.headDigest
        || pair.candidate.currentCorrectionHeadDigest !== correctionObserved.proof.headDigest)
      || correctionObserved.proof.accountingDigest !== correctionAccounting) {
      throw new TypeError('Principle current correction accounting is stale or incomplete');
    }
    const nearSearch = searchReceipt(await runtime.searchNearMiss(input.nearMiss),
      'near_miss', [input.nearMiss.nearMissId]);
    const counterSearch = searchReceipt(await runtime.searchCounterexamples(input.counterexamples),
      'counterexample', input.counterexamples.map((item) => item.counterexampleId));
    const effects = sideEffectCore(await runtime.observeSideEffects());
    if (hash(effects) !== hash(input.sideEffects)) {
      throw new TypeError('Principle replay side-effect payload does not match runtime receipt');
    }
    const payload = { candidate: structuredClone(candidate), pairs: structuredClone(input.pairs),
      nearMiss: structuredClone(input.nearMiss), counterexamples: structuredClone(input.counterexamples),
      sideEffects: structuredClone(input.sideEffects) };
    const receipt = { schema: 't5.principle-replay-materialization-receipt.v1',
      reflectionDigest: hash(reflections), pairReceiptDigest: hash(pairs),
      correctionAccountingDigest: correctionAccounting, nearMissSearchDigest: nearSearch.receiptDigest,
      counterexampleSearchDigest: counterSearch.receiptDigest,
      sideEffectDigest: hash(effects), payloadDigest: hash(payload) };
    const persistedReceipt = { ...receipt, receiptDigest: hash(receipt) };
    const core = { schema: 't5.principle-replay-materialization.v1', payload,
      receipt: persistedReceipt };
    const wrapper = deepFreeze({ ...core, materializationDigest: hash({ schema: core.schema,
      payloadDigest: receipt.payloadDigest, receipt: persistedReceipt }) });
    REPLAY_MATERIALIZATIONS.add(wrapper); return wrapper;
  });
}

export function consumePrincipleReplayEvidence(input) {
  if (!input || !REPLAY_MATERIALIZATIONS.has(input)) {
    throw new TypeError('Principle replay qualification requires fresh runtime materialization');
  }
  REPLAY_MATERIALIZATIONS.delete(input); return structuredClone(input);
}

function median(values) {
  const sorted = [...values].toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export async function materializePrincipleFieldEvidence(input = {}) {
  exact(input, FIELD_INPUT_FIELDS, 'PrincipleFieldMaterializerInput');
  const runtime = requireRuntime(input.runtime);
  const replay = input.replayQualification;
  if (replay?.candidate?.state !== 'replay_qualified' || !Array.isArray(replay.evidence?.pairs)) {
    throw new TypeError('replay-qualified Principle evidence is required');
  }
  return runtime.withStableWindow(async () => {
  const canonicalField = await runtime.loadCanonicalField(input.field, replay);
  exact(canonicalField.fieldHead, FIELD_HEAD_FIELDS, 'PrincipleFieldHead');
  const head = canonicalField.fieldHead; const field = input.field;
  if (head.episodeId !== field.episodeId || head.workId !== field.workId || head.runId !== field.runId
    || head.resultDigest !== field.resultDigest || head.achieved !== true || head.effectKnown !== true
    || head.deliveryTerminal !== true || head.principleRevisionDigest !== replay.candidate.revisionDigest
    || head.contextReceiptDigest !== field.contextReceiptDigest) {
    throw new TypeError('Principle field canonical source head mismatch');
  }
  await reopenAll(canonicalField.recordSourceReader, head.recordRefs, 'Principle field');
  const correctionObserved = await runtime.observeCurrentCorrection(replay.candidate);
  exact(correctionObserved.proof, CORRECTION_FIELDS, 'PrincipleFieldCurrentCorrection');
  const correctionAccounting = await reopenAll(correctionObserved.recordSourceReader,
    correctionObserved.proof.recordRefs, 'field current correction');
  if (correctionObserved.proof.headDigest !== replay.receipt.currentCorrectionHeadDigest
    || field.currentCorrectionHeadDigest !== correctionObserved.proof.headDigest
    || correctionObserved.proof.accountingDigest !== correctionAccounting) {
    throw new TypeError('Principle field correction was not reobserved after replay');
  }
  const evaluator = await runtime.evaluateField(field, canonicalField, replay);
  exact(evaluator, FIELD_EVALUATOR_FIELDS, 'PrincipleFieldEvaluatorReceipt');
  const fieldInputDigest = hash({ episodeId: field.episodeId, workId: field.workId,
    runId: field.runId, resultDigest: field.resultDigest,
    principleRevisionDigest: field.principleRevisionDigest,
    currentCorrectionHeadDigest: field.currentCorrectionHeadDigest });
  if (evaluator.evaluatorIdentityDigest !== replay.receipt.evaluatorIdentityDigest
    || evaluator.evaluatorPromptDigest !== replay.receipt.evaluatorPromptDigest
    || evaluator.fieldInputDigest !== fieldInputDigest || evaluator.evaluationDigest !== field.evaluationDigest
    || evaluator.receiptDigest !== hash({ evaluatorIdentityDigest: evaluator.evaluatorIdentityDigest,
      evaluatorPromptDigest: evaluator.evaluatorPromptDigest, fieldInputDigest,
      evaluationDigest: evaluator.evaluationDigest })) {
    throw new TypeError('Principle field evaluator receipt mismatch');
  }
  const candidateMetrics = replay.evidence.pairs.map((pair) => pair.candidate.metrics);
  for (const name of ['userCorrections', 'wallMs', 'providerTokens']) {
    if (field.metrics[name] > median(candidateMetrics.map((metrics) => metrics[name]))) {
      throw new TypeError('Principle field metrics are worse than replay candidate median');
    }
  }
  const usedEpisodeIds = new Set([...replay.candidate.independentEpisodeIds,
    ...replay.evidence.pairs.flatMap((pair) => [pair.baseline.episodeId, pair.candidate.episodeId]),
    replay.evidence.nearMiss.episodeId, ...replay.evidence.counterexamples.map((item) => item.episodeId)]);
  if (usedEpisodeIds.has(field.episodeId)) throw new TypeError('Principle field source is not independent');
  const effects = sideEffectCore(await runtime.observeSideEffects());
  if (hash(effects) !== hash(input.sideEffects)) {
    throw new TypeError('Principle field side-effect payload does not match runtime receipt');
  }
  const payload = { replayQualification: structuredClone(replay), field: structuredClone(field),
    sideEffects: structuredClone(input.sideEffects) };
  const core = { schema: 't5.principle-field-materialization-receipt.v1',
    fieldSourceDigest: hash({ ...head, recordRefs: head.recordRefs.map((item) => item.recordId).toSorted() }),
    correctionAccountingDigest: correctionAccounting, evaluatorReceiptDigest: evaluator.receiptDigest,
    payloadDigest: hash(payload) };
  const persistedReceipt = { ...core, receiptDigest: hash(core) };
  const body = { schema: 't5.principle-field-materialization.v1', payload,
    receipt: persistedReceipt };
  const wrapper = deepFreeze({ ...body, materializationDigest: hash({ schema: body.schema,
    payloadDigest: core.payloadDigest, receipt: persistedReceipt }) });
  FIELD_MATERIALIZATIONS.add(wrapper); return wrapper;
  });
}

export function consumePrincipleFieldEvidence(input) {
  if (!input || !FIELD_MATERIALIZATIONS.has(input)) {
    throw new TypeError('Principle field qualification requires fresh runtime materialization');
  }
  FIELD_MATERIALIZATIONS.delete(input); return structuredClone(input);
}

function validatePersistedReceipt(input, fields, schema, materializationSchema, materializationDigest) {
  exact(input, fields, 'Principle persisted materialization receipt');
  if (input.schema !== schema) throw new TypeError('Principle materialization receipt schema is invalid');
  for (const [name, value] of Object.entries(input)) {
    if (name !== 'schema') digest(value, `Principle materialization receipt ${name}`);
  }
  const { receiptDigest, ...core } = input;
  if (receiptDigest !== hash(core)
    || materializationDigest !== hash({ schema: materializationSchema,
      payloadDigest: input.payloadDigest, receipt: input })) {
    throw new TypeError('Principle persisted materialization receipt or digest is invalid');
  }
  return structuredClone(input);
}

export function validatePersistedPrincipleReplayMaterialization(receipt, materializationDigest) {
  return validatePersistedReceipt(receipt, REPLAY_RECEIPT_FIELDS,
    't5.principle-replay-materialization-receipt.v1',
    't5.principle-replay-materialization.v1', materializationDigest);
}

export function validatePersistedPrincipleFieldMaterialization(receipt, materializationDigest) {
  return validatePersistedReceipt(receipt, FIELD_RECEIPT_FIELDS,
    't5.principle-field-materialization-receipt.v1',
    't5.principle-field-materialization.v1', materializationDigest);
}
