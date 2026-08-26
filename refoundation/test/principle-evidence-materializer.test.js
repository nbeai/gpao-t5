import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  makePrincipleEvidenceRuntime,
  materializePrincipleFieldEvidence,
  materializePrincipleReplayEvidence,
} from '../src/principle-evidence-materializer.js';
import {
  makePrincipleCandidate, qualifyPrincipleField, qualifyPrincipleReplay,
  validatePrincipleFieldQualification, validatePrincipleReplayQualification,
} from '../src/principle-qualification.js';

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const sha = (value) => hash(String(value));
const evaluatorIdentityDigest = sha('evaluator'); const evaluatorPromptDigest = sha('prompt');
const correctionDigest = sha('correction');
const effects = () => ({ memoryWrites: 0, principleWrites: 0, managedSkillWrites: 0,
  managedCliWrites: 0, pluginWrites: 0, externalWrites: 0 });
const effectReceipt = (override = {}) => {
  const core = { ...effects(), ...override };
  return { ...core, receiptDigest: hash({ schema: 't5.principle-side-effects.v1', ...core }) };
};
function reference(id) { return { recordId: `rr-${id}`, sha256: sha(id),
  scope: { sessionId: `session-${id}`, workId: `work-${id}` } }; }
const reader = { async reopen(ref) { return { state: 'reopened', source: { schema: 'fixture' }, accounting: {
  recordId: ref.recordId, availability: 'available', digestMatched: true, observedSha256: ref.sha256,
} }; } };
const accountingDigest = (refs) => hash(refs.map((ref) => ({ recordId: ref.recordId,
  observedSha256: ref.sha256 })).toSorted((a, b) => a.recordId.localeCompare(b.recordId)));
function withRuntime(input) {
  const proof = input.proof; const recordSourceReader = input.recordSourceReader;
  input.runtime = makePrincipleEvidenceRuntime({
    withStableWindow: async (callback) => callback(),
    loadReviewedReflections: async () => proof.reviewedReflections,
    loadCanonicalPair: async (_pair, index) => ({ baselineHead: proof.pairReceipts[index].baselineHead,
      candidateHead: proof.pairReceipts[index].candidateHead, recordSourceReader }),
    evaluateBlindPair: async (_pair, _canonical, index) => proof.pairReceipts[index],
    observeCurrentCorrection: async () => ({ proof: proof.currentCorrection, recordSourceReader }),
    searchNearMiss: async () => proof.nearMissSearchReceipt,
    searchCounterexamples: async () => proof.counterexampleSearchReceipt,
    observeSideEffects: async () => proof.sideEffectReceipt,
    loadCanonicalField: async () => ({ fieldHead: proof.fieldHead, recordSourceReader }),
    evaluateField: async () => proof.evaluatorReceipt,
  });
  delete input.proof; delete input.recordSourceReader; return input;
}

function candidate() { return makePrincipleCandidate({ principleId: 'principle-safe',
  statement: '불확실한 효과를 반복하기 전에 결과를 확인한다.', scope: ['scope-safe'],
  sourceReflectionIds: ['reflection-safe'], independentEpisodeIds: ['source-e1', 'source-e2'],
  counterexampleIds: ['counter-1'] }); }
function arm(kind, index, metrics) { return { episodeId: `${kind}-e${index}`, workId: `${kind}-w${index}`,
  runId: `${kind}-r${index}`, resultDigest: sha(`${kind}-result-${index}`),
  eligibilityDigest: sha(`${kind}-eligible-${index}`), sourceRecordDigest: sha(`${kind}-records-${index}`),
  contextReceiptDigest: sha(`${kind}-context-${index}`),
  principleRevisionDigest: kind === 'candidate' ? candidate().revisionDigest : null,
  achieved: true, effectKnown: true, deliveryTerminal: true,
  currentCorrectionHeadDigest: correctionDigest, currentCorrectionReopened: true, metrics } }
function pair(index, order) {
  const base = { pairId: `pair-${index}`, purposeDigest: sha(`purpose-${index}`), executionOrder: order,
    baseline: arm('baseline', index, { userCorrections: 2, wallMs: 120, providerTokens: 1_200 }),
    candidate: arm('candidate', index, { userCorrections: 1, wallMs: index === 1 ? 90 : 110,
      providerTokens: index === 1 ? 900 : 1_100 }) };
  const inputDigest = hash({ schema: 't5.principle-pair-evaluation-input.v1', ...base });
  return { ...base, evaluation: { pairedEvaluation: true, blind: true,
    armMappingDigest: sha(`mapping-${index}`), evaluatorRunId: `eval-${index}`,
    evaluatorIdentityDigest, evaluatorPromptDigest, evaluationInputDigest: inputDigest,
    evaluationDigest: sha(`evaluation-${index}`), taskOracleDigest: sha(`oracle-${index}`),
    samePurpose: true, baselineOraclePassed: true, candidateOraclePassed: true,
    baselineCorrect: true, candidateCorrect: true, baselineComplete: true, candidateComplete: true,
    userCorrectionPreserved: true, sourceExpressionsReused: false } };
}
function search(kind, ids) { const resultIds = [...ids].toSorted(); const resultDigest = hash(resultIds);
  const core = { kind, resultIds, resultCount: resultIds.length, resultDigest };
  return { ...core, receiptDigest: hash(core) }; }
function pairReceipt(pairValue, index) {
  const baselineRefs = [reference(`baseline-${index}`)]; const candidateRefs = [reference(`candidate-${index}`)];
  const baselineHead = { workId: pairValue.baseline.workId, runId: pairValue.baseline.runId,
    resultDigest: pairValue.baseline.resultDigest, achieved: true, effectKnown: true, deliveryTerminal: true,
    principleRevisionDigest: null, contextReceiptDigest: pairValue.baseline.contextReceiptDigest,
    recordRefs: baselineRefs };
  const candidateHead = { workId: pairValue.candidate.workId, runId: pairValue.candidate.runId,
    resultDigest: pairValue.candidate.resultDigest, achieved: true, effectKnown: true, deliveryTerminal: true,
    principleRevisionDigest: pairValue.candidate.principleRevisionDigest,
    contextReceiptDigest: pairValue.candidate.contextReceiptDigest, recordRefs: candidateRefs };
  const armMapping = { baselineLabel: index % 2 ? 'A' : 'B', candidateLabel: index % 2 ? 'B' : 'A',
    randomized: true, mappingDigest: '' };
  armMapping.mappingDigest = hash({ pairId: pairValue.pairId, baselineLabel: armMapping.baselineLabel,
    candidateLabel: armMapping.candidateLabel, randomized: true });
  const evaluatorRequest = { evaluatorIdentityDigest, evaluatorPromptDigest,
    pairInputDigest: pairValue.evaluation.evaluationInputDigest, armMappingDigest: armMapping.mappingDigest,
    requestDigest: '' };
  evaluatorRequest.requestDigest = hash({ evaluatorIdentityDigest, evaluatorPromptDigest,
    pairInputDigest: evaluatorRequest.pairInputDigest, armMappingDigest: evaluatorRequest.armMappingDigest });
  const evaluatorOutput = { requestDigest: evaluatorRequest.requestDigest,
    evaluationDigest: pairValue.evaluation.evaluationDigest, outputDigest: '' };
  evaluatorOutput.outputDigest = hash({ requestDigest: evaluatorOutput.requestDigest,
    evaluationDigest: evaluatorOutput.evaluationDigest });
  const taskOracleReceipt = { outputDigest: evaluatorOutput.outputDigest,
    taskOracleDigest: pairValue.evaluation.taskOracleDigest, baselinePassed: true,
    candidatePassed: true, receiptDigest: '' };
  taskOracleReceipt.receiptDigest = hash({ outputDigest: taskOracleReceipt.outputDigest,
    taskOracleDigest: taskOracleReceipt.taskOracleDigest, baselinePassed: true, candidatePassed: true });
  const clean = (head, digestValue) => ({ ...head, recordRefs: undefined, accountingDigest: digestValue });
  const core = { pairId: pairValue.pairId, armMapping,
    baselineHead: clean(baselineHead, accountingDigest(baselineRefs)),
    candidateHead: clean(candidateHead, accountingDigest(candidateRefs)),
    evaluatorRequest, evaluatorOutput, taskOracleReceipt };
  return { pairId: pairValue.pairId, armMapping, baselineHead, candidateHead,
    evaluatorRequest, evaluatorOutput, taskOracleReceipt, receiptDigest: hash(core) };
}
function replayInput() {
  const value = candidate(); const pairs = [pair(1, 'baseline_first'), pair(2, 'candidate_first')];
  const correctionRefs = [reference('correction')];
  return { candidate: value, pairs,
    nearMiss: { nearMissId: 'near-1', episodeId: 'near-e', workId: 'near-w', runId: 'near-r',
      resultDigest: sha('near-result'), sourceRecordDigest: sha('near-record'), evaluatorIdentityDigest,
      evaluatorPromptDigest, evaluationDigest: sha('near-eval'), expectedTrigger: false,
      observedTrigger: false, sourceExpressionsReused: false },
    counterexamples: [{ counterexampleId: 'counter-1', episodeId: 'counter-e', workId: 'counter-w',
      runId: 'counter-r', resultDigest: sha('counter-result'), evidenceDigest: sha('counter-evidence'),
      disposition: 'scope_boundary' }], sideEffects: effects(), recordSourceReader: reader,
    proof: { reviewedReflections: [{ reflectionId: 'reflection-safe', revisionDigest: sha('reflection-rev'),
      materializationDigest: sha('reflection-mat'), reviewReceiptDigest: sha('reflection-review'),
      state: 'reviewed', decision: 'retain', scopeHandles: ['scope-safe'], counterexampleIds: ['counter-1'] }],
    pairReceipts: pairs.map(pairReceipt), currentCorrection: { headDigest: correctionDigest,
      recordRefs: correctionRefs, accountingDigest: accountingDigest(correctionRefs) },
    nearMissSearchReceipt: search('near_miss', ['near-1']),
    counterexampleSearchReceipt: search('counterexample', ['counter-1']),
    sideEffectReceipt: effectReceipt() } };
}
async function replayQualified(input = replayInput()) {
  return qualifyPrincipleReplay(await materializePrincipleReplayEvidence(withRuntime(input)));
}
function fieldInput(replay) {
  const fieldRefs = [reference('field')]; const correctionRefs = [reference('field-correction')];
  const field = { fieldId: 'field-1', episodeId: 'field-e', workId: 'field-w', runId: 'field-r',
    resultDigest: sha('field-result'), eligibilityDigest: sha('field-eligible'),
    sourceRecordDigest: sha('field-records'), contextReceiptDigest: sha('field-context'),
    principleRevisionDigest: replay.candidate.revisionDigest, evaluatorIdentityDigest,
    evaluatorPromptDigest, evaluationDigest: sha('field-eval'), currentCorrectionHeadDigest: correctionDigest,
    candidateRevisionUsed: true, achieved: true, correct: true, complete: true,
    currentCorrectionReopened: true, userCorrectionPreserved: true, effectKnown: true,
    deliveryTerminal: true, regressionObserved: false,
    metrics: { userCorrections: 1, wallMs: 90, providerTokens: 900 } };
  const fieldInputDigest = hash({ episodeId: field.episodeId, workId: field.workId, runId: field.runId,
    resultDigest: field.resultDigest, principleRevisionDigest: field.principleRevisionDigest,
    currentCorrectionHeadDigest: field.currentCorrectionHeadDigest });
  const evaluatorReceipt = { evaluatorIdentityDigest, evaluatorPromptDigest, fieldInputDigest,
    evaluationDigest: field.evaluationDigest, receiptDigest: '' };
  evaluatorReceipt.receiptDigest = hash({ evaluatorIdentityDigest, evaluatorPromptDigest,
    fieldInputDigest, evaluationDigest: field.evaluationDigest });
  return { replayQualification: replay, field, sideEffects: effects(), recordSourceReader: reader,
    proof: { fieldHead: { episodeId: field.episodeId, workId: field.workId, runId: field.runId,
      resultDigest: field.resultDigest, achieved: true, effectKnown: true, deliveryTerminal: true,
      principleRevisionDigest: field.principleRevisionDigest,
      contextReceiptDigest: field.contextReceiptDigest, recordRefs: fieldRefs },
    currentCorrection: { headDigest: correctionDigest, recordRefs: correctionRefs,
      accountingDigest: accountingDigest(correctionRefs) }, evaluatorReceipt,
    sideEffectReceipt: effectReceipt() } };
}

test('runtime materialization만 replay qualification으로 한 번 소비된다', async () => {
  await assert.rejects(materializePrincipleReplayEvidence(replayInput()), /missing or unknown fields/u);
  const materialized = await materializePrincipleReplayEvidence(withRuntime(replayInput()));
  assert.throws(() => qualifyPrincipleReplay(structuredClone(materialized)), /fresh runtime/u);
  const qualified = qualifyPrincipleReplay(materialized);
  assert.equal(qualified.candidate.state, 'replay_qualified');
  assert.deepEqual(qualified.materializationReceipt, materialized.receipt);
  assert.equal(qualified.materializationDigest, materialized.materializationDigest);
  assert.equal(validatePrincipleReplayQualification(qualified).qualificationDigest,
    qualified.qualificationDigest);
  assert.throws(() => qualifyPrincipleReplay(materialized), /fresh runtime/u);
});

test('reviewed Reflection scope/counterexample 전체가 아니면 materialize하지 않는다', async () => {
  for (const mutate of [
    (input) => { input.proof.reviewedReflections[0].state = 'proposed'; },
    (input) => { input.proof.reviewedReflections[0].scopeHandles = ['foreign']; },
    (input) => { input.proof.reviewedReflections[0].counterexampleIds = []; },
  ]) { const input = replayInput(); mutate(input);
    await assert.rejects(materializePrincipleReplayEvidence(withRuntime(input)), /review|scope|counterexample/u); }
});

test('source reopen·current correction accounting이 exact하지 않으면 실패한다', async () => {
  const changed = replayInput(); changed.recordSourceReader = { async reopen() {
    return { state: 'changed', source: null, accounting: { availability: 'changed' } };
  } };
  await assert.rejects(materializePrincipleReplayEvidence(withRuntime(changed)), /reopen/u);
  const stale = replayInput(); stale.proof.currentCorrection.accountingDigest = sha('wrong');
  await assert.rejects(materializePrincipleReplayEvidence(withRuntime(stale)), /correction/u);
});

test('A/B mapping·evaluator request/output/oracle 결속과 pair별 distinct evaluation이 필요하다', async () => {
  for (const mutate of [
    (input) => { input.proof.pairReceipts[0].armMapping.randomized = false; },
    (input) => { input.proof.pairReceipts[0].evaluatorRequest.requestDigest = sha('wrong'); },
    (input) => { input.proof.pairReceipts[0].taskOracleReceipt.candidatePassed = false; },
    (input) => { input.pairs[1].evaluation.evaluationDigest = input.pairs[0].evaluation.evaluationDigest; },
  ]) { const input = replayInput(); mutate(input);
    await assert.rejects(materializePrincipleReplayEvidence(withRuntime(input)), /mapping|evaluator|oracle|distinct/u); }
});

test('near-miss/counter search receipt와 side-effect receipt가 payload 전체와 일치해야 한다', async () => {
  const missing = replayInput(); missing.proof.counterexampleSearchReceipt.resultCount = 0;
  await assert.rejects(materializePrincipleReplayEvidence(withRuntime(missing)), /search receipt/u);
  const effect = replayInput(); effect.sideEffects.externalWrites = 1;
  await assert.rejects(materializePrincipleReplayEvidence(withRuntime(effect)), /side-effect/u);
});

test('fresh field materialization은 correction 재관측·exact revision·same evaluator·독립 source를 요구한다', async () => {
  const replay = await replayQualified(); const input = fieldInput(replay);
  const materialized = await materializePrincipleFieldEvidence(withRuntime(input));
  assert.throws(() => qualifyPrincipleField(structuredClone(materialized)), /fresh runtime/u);
  const field = qualifyPrincipleField(materialized);
  assert.equal(field.candidate.state, 'field_qualified');
  assert.deepEqual(field.materializationReceipt, materialized.receipt);
  assert.equal(field.materializationDigest, materialized.materializationDigest);
  assert.equal(validatePrincipleFieldQualification(field).qualificationDigest, field.qualificationDigest);
});

test('field stale correction·wrong context revision·dependent source·worse metrics는 실패한다', async () => {
  for (const mutate of [
    (input) => { input.proof.currentCorrection.headDigest = sha('stale'); },
    (input) => { input.proof.fieldHead.contextReceiptDigest = sha('wrong'); },
    (input) => { input.field.episodeId = 'baseline-e1'; input.proof.fieldHead.episodeId = 'baseline-e1'; },
    (input) => { input.field.metrics.providerTokens = 2_000; },
  ]) { const replay = await replayQualified(); const input = fieldInput(replay); mutate(input);
    await assert.rejects(materializePrincipleFieldEvidence(withRuntime(input)),
      /correction|source head|independent|metrics|evaluator receipt/u); }
});
