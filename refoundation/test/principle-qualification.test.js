import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { makePrincipleEvidenceRuntime, materializePrincipleFieldEvidence,
  materializePrincipleReplayEvidence } from '../src/principle-evidence-materializer.js';
import { makePrincipleCandidate, qualifyPrincipleField, qualifyPrincipleReplay,
  validatePrincipleCandidate, validatePrincipleFieldQualification,
  validatePrincipleReplayQualification } from '../src/principle-qualification.js';

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const sha = (value) => hash(String(value));
const evaluatorIdentityDigest = sha('evaluator'); const evaluatorPromptDigest = sha('prompt');
const correctionDigest = sha('correction');
const effects = () => ({ memoryWrites: 0, principleWrites: 0, managedSkillWrites: 0,
  managedCliWrites: 0, pluginWrites: 0, externalWrites: 0 });
const effectReceipt = (values = effects()) => ({ ...values,
  receiptDigest: hash({ schema: 't5.principle-side-effects.v1', ...values }) });
const ref = (id) => ({ recordId: `rr-${id}`, sha256: sha(id),
  scope: { sessionId: `s-${id}`, workId: `w-${id}` } });
const reader = { async reopen(value) { return { state: 'reopened', source: {}, accounting: {
  recordId: value.recordId, availability: 'available', digestMatched: true, observedSha256: value.sha256,
} }; } };
const accounting = (refs) => hash(refs.map((value) => ({ recordId: value.recordId,
  observedSha256: value.sha256 })).toSorted((a, b) => a.recordId.localeCompare(b.recordId)));
function withRuntime(input) {
  const proof = input.proof; const recordSourceReader = input.recordSourceReader;
  input.runtime = makePrincipleEvidenceRuntime({ withStableWindow: async (callback) => callback(),
    loadReviewedReflections: async () => proof.reviewedReflections,
    loadCanonicalPair: async (_pair, index) => ({ baselineHead: proof.pairReceipts[index].baselineHead,
      candidateHead: proof.pairReceipts[index].candidateHead, recordSourceReader }),
    evaluateBlindPair: async (_pair, _canonical, index) => proof.pairReceipts[index],
    observeCurrentCorrection: async () => ({ proof: proof.currentCorrection, recordSourceReader }),
    searchNearMiss: async () => proof.nearMissSearchReceipt,
    searchCounterexamples: async () => proof.counterexampleSearchReceipt,
    observeSideEffects: async () => proof.sideEffectReceipt,
    loadCanonicalField: async () => ({ fieldHead: proof.fieldHead, recordSourceReader }),
    evaluateField: async () => proof.evaluatorReceipt });
  delete input.proof; delete input.recordSourceReader; return input;
}
const search = (kind, ids) => { const resultIds = [...ids].toSorted(); const resultDigest = hash(resultIds);
  const core = { kind, resultIds, resultCount: resultIds.length, resultDigest };
  return { ...core, receiptDigest: hash(core) }; };

function candidate() { return makePrincipleCandidate({ principleId: 'principle-safe',
  statement: '결과를 먼저 확인한다.', scope: ['scope-safe'], sourceReflectionIds: ['reflection-safe'],
  independentEpisodeIds: ['source-e1', 'source-e2'], counterexampleIds: ['counter-1'] }); }
function arm(kind, index, metrics) { return { episodeId: `${kind}-e${index}`, workId: `${kind}-w${index}`,
  runId: `${kind}-r${index}`, resultDigest: sha(`${kind}-result-${index}`),
  eligibilityDigest: sha(`${kind}-eligible-${index}`), sourceRecordDigest: sha(`${kind}-records-${index}`),
  contextReceiptDigest: sha(`${kind}-context-${index}`),
  principleRevisionDigest: kind === 'candidate' ? candidate().revisionDigest : null,
  achieved: true, effectKnown: true, deliveryTerminal: true,
  currentCorrectionHeadDigest: correctionDigest, currentCorrectionReopened: true, metrics }; }
function sealPair(value) { const body = { ...value }; delete body.evaluation;
  value.evaluation.evaluationInputDigest = hash({ schema: 't5.principle-pair-evaluation-input.v1', ...body }); }
function pair(index, executionOrder) { const value = { pairId: `pair-${index}`,
  purposeDigest: sha(`purpose-${index}`), executionOrder,
  baseline: arm('baseline', index, { userCorrections: 2, wallMs: 120, providerTokens: 1_200 }),
  candidate: arm('candidate', index, { userCorrections: 1, wallMs: index === 1 ? 90 : 110,
    providerTokens: index === 1 ? 900 : 1_100 }),
  evaluation: { pairedEvaluation: true, blind: true, armMappingDigest: sha(`map-${index}`),
    evaluatorRunId: `eval-${index}`, evaluatorIdentityDigest, evaluatorPromptDigest,
    evaluationInputDigest: sha('pending'), evaluationDigest: sha(`evaluation-${index}`),
    taskOracleDigest: sha(`oracle-${index}`), samePurpose: true, baselineOraclePassed: true,
    candidateOraclePassed: true, baselineCorrect: true, candidateCorrect: true,
    baselineComplete: true, candidateComplete: true, userCorrectionPreserved: true,
    sourceExpressionsReused: false } }; sealPair(value); return value; }
function pairReceipt(pairValue, index) {
  const baselineRefs = [ref(`b-${index}`)]; const candidateRefs = [ref(`c-${index}`)];
  const head = (armValue, refs) => ({ workId: armValue.workId, runId: armValue.runId,
    resultDigest: armValue.resultDigest, achieved: true, effectKnown: true, deliveryTerminal: true,
    principleRevisionDigest: armValue.principleRevisionDigest,
    contextReceiptDigest: armValue.contextReceiptDigest, recordRefs: refs });
  const baselineHead = head(pairValue.baseline, baselineRefs); const candidateHead = head(pairValue.candidate, candidateRefs);
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
  const compact = (value, refs) => ({ ...value, recordRefs: undefined, accountingDigest: accounting(refs) });
  const core = { pairId: pairValue.pairId, armMapping,
    baselineHead: compact(baselineHead, baselineRefs), candidateHead: compact(candidateHead, candidateRefs),
    evaluatorRequest, evaluatorOutput, taskOracleReceipt };
  return { pairId: pairValue.pairId, armMapping, baselineHead, candidateHead,
    evaluatorRequest, evaluatorOutput, taskOracleReceipt, receiptDigest: hash(core) };
}
function rawReplay() { const value = candidate(); const pairs = [pair(1, 'baseline_first'), pair(2, 'candidate_first')];
  const correctionRefs = [ref('correction')]; return { candidate: value, pairs,
    nearMiss: { nearMissId: 'near-1', episodeId: 'near-e', workId: 'near-w', runId: 'near-r',
      resultDigest: sha('near-result'), sourceRecordDigest: sha('near-source'), evaluatorIdentityDigest,
      evaluatorPromptDigest, evaluationDigest: sha('near-eval'), expectedTrigger: false,
      observedTrigger: false, sourceExpressionsReused: false },
    counterexamples: [{ counterexampleId: 'counter-1', episodeId: 'counter-e', workId: 'counter-w',
      runId: 'counter-r', resultDigest: sha('counter-result'), evidenceDigest: sha('counter-evidence'),
      disposition: 'scope_boundary' }], sideEffects: effects(), recordSourceReader: reader,
    proof: { reviewedReflections: [{ reflectionId: 'reflection-safe', revisionDigest: sha('reflection-rev'),
      materializationDigest: sha('reflection-mat'), reviewReceiptDigest: sha('review'), state: 'reviewed',
      decision: 'retain', scopeHandles: ['scope-safe'], counterexampleIds: ['counter-1'] }],
    pairReceipts: pairs.map(pairReceipt), currentCorrection: { headDigest: correctionDigest,
      recordRefs: correctionRefs, accountingDigest: accounting(correctionRefs) },
    nearMissSearchReceipt: search('near_miss', ['near-1']),
    counterexampleSearchReceipt: search('counterexample', ['counter-1']),
    sideEffectReceipt: effectReceipt() } }; }
async function qualify(raw = rawReplay()) {
  return qualifyPrincipleReplay(await materializePrincipleReplayEvidence(withRuntime(raw)));
}
function rawField(replay) { const fieldRefs = [ref('field')]; const correctionRefs = [ref('field-correction')];
  const field = { fieldId: 'field-1', episodeId: 'field-e', workId: 'field-w', runId: 'field-r',
    resultDigest: sha('field-result'), eligibilityDigest: sha('field-eligible'), sourceRecordDigest: sha('field-source'),
    contextReceiptDigest: sha('field-context'), principleRevisionDigest: replay.candidate.revisionDigest,
    evaluatorIdentityDigest, evaluatorPromptDigest, evaluationDigest: sha('field-eval'),
    currentCorrectionHeadDigest: correctionDigest, candidateRevisionUsed: true, achieved: true,
    correct: true, complete: true, currentCorrectionReopened: true, userCorrectionPreserved: true,
    effectKnown: true, deliveryTerminal: true, regressionObserved: false,
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
      principleRevisionDigest: field.principleRevisionDigest, contextReceiptDigest: field.contextReceiptDigest,
      recordRefs: fieldRefs }, currentCorrection: { headDigest: correctionDigest, recordRefs: correctionRefs,
      accountingDigest: accounting(correctionRefs) }, evaluatorReceipt, sideEffectReceipt: effectReceipt() } }; }

test('Principle candidate는 inactive closed schema로 시작한다', () => {
  const value = candidate(); assert.equal(value.state, 'candidate'); assert.equal('active' in value, false);
  assert.equal(validatePrincipleCandidate(value).revisionDigest, value.revisionDigest);
});
test('fresh runtime replay만 두 blind pair와 동일 evaluator로 replay_qualified된다', async () => {
  const value = await qualify(); assert.equal(value.candidate.state, 'replay_qualified');
  assert.equal(validatePrincipleReplayQualification(value).qualificationDigest, value.qualificationDigest);
});
test('다른 evaluator·prompt와 non-blind/unpaired는 실패한다', async () => {
  for (const mutate of [(x) => { x.pairs[1].evaluation.evaluatorIdentityDigest = sha('other'); },
    (x) => { x.pairs[1].evaluation.evaluatorPromptDigest = sha('other'); },
    (x) => { x.pairs[0].evaluation.blind = false; }, (x) => { x.pairs[0].evaluation.pairedEvaluation = false; }]) {
    const input = rawReplay(); mutate(input); await assert.rejects(qualify(input), /evaluator|blind/u); }
});
test('correctness·completeness task oracle는 faster candidate보다 우선한다', async () => {
  for (const field of ['candidateOraclePassed', 'candidateCorrect', 'candidateComplete']) {
    const input = rawReplay(); input.pairs[0].evaluation[field] = false;
    await assert.rejects(qualify(input), /oracle/u); }
});
test('current correction reopen과 achieved/effect/delivery가 모두 필요하다', async () => {
  for (const mutate of [(x) => { x.pairs[0].candidate.currentCorrectionReopened = false; },
    (x) => { x.pairs[0].candidate.achieved = false; }, (x) => { x.pairs[0].candidate.effectKnown = false; },
    (x) => { x.pairs[0].candidate.deliveryTerminal = false; }]) { const input = rawReplay(); mutate(input);
    await assert.rejects(qualify(input), /eligible evidence|proof mismatch|correction/u); }
});
test('corrections·wall·tokens pairwise Pareto와 strict improvement가 필요하다', async () => {
  const worse = rawReplay(); worse.pairs[0].candidate.metrics.providerTokens = 2_000; sealPair(worse.pairs[0]);
  worse.proof.pairReceipts[0] = pairReceipt(worse.pairs[0], 0);
  await assert.rejects(qualify(worse), /Pareto/u);
  const equal = rawReplay(); for (const [index, value] of equal.pairs.entries()) {
    value.candidate.metrics = { ...value.baseline.metrics }; sealPair(value);
    equal.proof.pairReceipts[index] = pairReceipt(value, index); }
  await assert.rejects(qualify(equal), /Pareto/u);
});
test('replay Work·Run·Episode 독립성과 alternating order가 필요하다', async () => {
  const duplicate = rawReplay(); duplicate.pairs[1].candidate.workId = duplicate.pairs[0].baseline.workId;
  sealPair(duplicate.pairs[1]); duplicate.proof.pairReceipts[1] = pairReceipt(duplicate.pairs[1], 1);
  await assert.rejects(qualify(duplicate), /independent/u);
  const order = rawReplay(); order.pairs[1].executionOrder = 'baseline_first'; sealPair(order.pairs[1]);
  order.proof.pairReceipts[1] = pairReceipt(order.pairs[1], 1);
  await assert.rejects(qualify(order), /alternate/u);
});
test('near-miss trigger·source reuse와 counterexample 누락은 실패한다', async () => {
  const trigger = rawReplay(); trigger.nearMiss.observedTrigger = true;
  await assert.rejects(qualify(trigger), /near-miss/u);
  const missing = rawReplay(); missing.counterexamples = [];
  await assert.rejects(qualify(missing), /counterexample|search/u);
});
test('sideEffects가 하나라도 있으면 replay는 실패한다', async () => {
  const input = rawReplay(); input.sideEffects.externalWrites = 1;
  await assert.rejects(qualify(input), /side-effect/u);
});
test('fresh independent field가 exact revision·same evaluator·correction을 보존하면 field_qualified다', async () => {
  const replay = await qualify(); const materialized = await materializePrincipleFieldEvidence(
    withRuntime(rawField(replay)));
  const field = qualifyPrincipleField(materialized); assert.equal(field.candidate.state, 'field_qualified');
  assert.equal(validatePrincipleFieldQualification(field).qualificationDigest, field.qualificationDigest);
});
test('field dependent source·wrong revision·regression·미완료는 실패한다', async () => {
  for (const mutate of [(x) => { x.field.episodeId = 'baseline-e1'; x.proof.fieldHead.episodeId = 'baseline-e1'; },
    (x) => { x.field.principleRevisionDigest = sha('wrong'); }, (x) => { x.field.regressionObserved = true; },
    (x) => { x.field.achieved = false; }, (x) => { x.field.currentCorrectionReopened = false; }]) {
    const input = rawField(await qualify()); mutate(input);
    await assert.rejects(async () => qualifyPrincipleField(
      await materializePrincipleFieldEvidence(withRuntime(input))),
    /independent|source head|correction|evaluator|did not preserve/u); }
});
test('raw caller와 cloned materialization은 qualification을 우회하지 못한다', async () => {
  assert.throws(() => qualifyPrincipleReplay(rawReplay()), /fresh runtime/u);
  const wrapper = await materializePrincipleReplayEvidence(withRuntime(rawReplay()));
  assert.throws(() => qualifyPrincipleReplay(structuredClone(wrapper)), /fresh runtime/u);
  assert.throws(() => qualifyPrincipleField({}), /fresh runtime/u);
});
test('persisted materialization receipt unknown field와 payload·materialization digest 재작성은 거부한다', async () => {
  const replay = structuredClone(await qualify());
  replay.materializationReceipt.forged = sha('forged');
  replay.qualificationDigest = hash({ schema: replay.schema, candidate: replay.candidate,
    evidence: replay.evidence, receipt: replay.receipt,
    materializationReceipt: replay.materializationReceipt,
    materializationDigest: replay.materializationDigest, sideEffects: replay.sideEffects });
  assert.throws(() => validatePrincipleReplayQualification(replay), /persisted materialization receipt/u);

  const validReplay = await qualify();
  const field = structuredClone(qualifyPrincipleField(await materializePrincipleFieldEvidence(
    withRuntime(rawField(validReplay)))));
  field.materializationReceipt.payloadDigest = sha('changed-payload');
  field.materializationReceipt.receiptDigest = hash(Object.fromEntries(Object.entries(
    field.materializationReceipt).filter(([name]) => name !== 'receiptDigest')));
  field.materializationDigest = sha('rewritten-materialization');
  field.qualificationDigest = hash({ schema: field.schema, candidate: field.candidate,
    replayQualification: field.replayQualification, fieldReceipt: field.fieldReceipt,
    materializationReceipt: field.materializationReceipt,
    materializationDigest: field.materializationDigest, sideEffects: field.sideEffects });
  assert.throws(() => validatePrincipleFieldQualification(field), /materialization receipt or digest/u);
});
test('qualifier는 ledger·rollback·managed capability·model wiring을 import하지 않는다', async () => {
  const source = await readFile(new URL('../src/principle-qualification.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from\s+['"][^'"]*(?:ledger|rollback|managed|capability|model)[^'"]*['"]/iu);
});
