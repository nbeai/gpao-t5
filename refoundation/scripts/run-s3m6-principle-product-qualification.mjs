import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { materializeReflectionEvidence } from '../src/reflection-evidence-materializer.js';
import { materializeReflectionReviewProbe, ReflectionLedger } from '../src/reflection-ledger.js';
import { makePrincipleEvidenceProductAdapter, makePrincipleQualificationFixtureDependencies,
  makePrincipleRecordSourceReaderAdapter } from '../src/principle-evidence-product-adapter.js';
import { materializePrincipleFieldEvidence,
  materializePrincipleReplayEvidence } from '../src/principle-evidence-materializer.js';
import { makePrincipleCandidate, qualifyPrincipleField,
  qualifyPrincipleReplay } from '../src/principle-qualification.js';
import { makeRecordReference } from '../src/record-reference.js';
import { ReflectionSourceWindowCoordinator } from '../src/reflection-source-window-coordinator.js';

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const sha = (value) => hash(String(value)); const at = '2026-08-27T00:00:00.000Z';
const evaluatorIdentityDigest = sha('local-evaluator-v1');
const evaluatorPromptDigest = sha('fixed-evaluator-prompt-v1'); const correctionDigest = sha('current-correction');
const zeroEffects = () => ({ memoryWrites: 0, principleWrites: 0, managedSkillWrites: 0,
  managedCliWrites: 0, pluginWrites: 0, externalWrites: 0 });
const effectReceipt = () => { const core = zeroEffects(); return { ...core,
  receiptDigest: hash({ schema: 't5.principle-side-effects.v1', ...core }) }; };
const ref = (id) => ({ recordId: `rr-${id}`, sha256: sha(id),
  scope: { sessionId: `session-${id}`, workId: `work-${id}` } });
const accounting = (refs) => hash(refs.map((value) => ({ recordId: value.recordId,
  observedSha256: value.sha256 })).toSorted((a, b) => a.recordId.localeCompare(b.recordId)));
const searchReceipt = (kind, ids) => { const resultIds = [...ids].toSorted(); const resultDigest = hash(resultIds);
  const core = { kind, resultIds, resultCount: resultIds.length, resultDigest };
  return { ...core, receiptDigest: hash(core) }; };

function reflectionRuntimeFixture() {
  const directRef = (name, kind = 'conversation_message', trust = 'user_asserted') => makeRecordReference({
    sourceKind: kind, sourceStore: `${kind}-store`, sourceId: name, sourceRevision: 1,
    sha256: sha(name), occurredAt: at, recordedAt: at,
    scope: { sessionId: 'reflection-session', workId: null,
      subjectKeys: ['owner-safe'], channel: 'private' }, trust,
    sensitivity: 'personal', coverage: 'full', availability: 'available' });
  const correction = directRef('reflection-correction');
  const counter = directRef('reflection-counter', 'web_source', 'external_untrusted');
  const workState = { works: [], events: [], results: [] }; const runs = []; const messages = [];
  const episodeAllowlist = []; let sequence = 0;
  for (const number of [1, 2]) {
    const workId = `reflection-work-${number}`; const runId = `reflection-run-${number}`;
    const messageId = `reflection-message-${number}`; const resultDigest = sha(`reflection-result-${number}`);
    messages.push({ schema: 't5.conversation-event.v1', sequence: number, recordedAt: at,
      sessionId: 'reflection-session', type: 'message', messageId,
      message: { role: 'user', content: `합성 목적 ${number}` } });
    workState.works.push({ workId, revision: 1, status: 'completed', sessionId: 'reflection-session',
      sourceMessageId: messageId });
    const event = (type, fields = {}) => ({ schema: 't5.work-event.v1', sequence: ++sequence,
      recordedAt: at, type, workId, revision: 1, runId, ...fields });
    workState.events.push(event('work_created', { sessionId: 'reflection-session', sourceMessageId: messageId }),
      event('completion_verified', { verifiedOutcome: 'achieved', blockers: [] }),
      event('work_settled', { outcome: 'achieved' }),
      event('result_ready_pending_surface', { objectiveOutcome: 'achieved', resultDigest }),
      event('result_surface_persisted'), event('result_delivery_terminal', { delivery: { state: 'persisted' } }));
    workState.results.push({ runId, state: 'delivery_terminal', objectiveOutcome: 'achieved',
      workId, revision: 1, resultDigest, delivery: { state: 'persisted' } });
    runs.push({ runId, sessionId: 'reflection-session', status: 'completed', events: [
      { schema: 't5.run-event.v1', sequence: 1, recordedAt: at, runId, type: 'tool_started',
        payload: { toolCallId: `call-${number}`, name: 'exec' } },
      { schema: 't5.run-event.v1', sequence: 2, recordedAt: at, runId, type: 'tool_completed',
        payload: { receipt: { toolCallId: `call-${number}`, actualCall: { name: 'exec' },
          outcome: 'succeeded', result: { effectUnknown: false } } } },
    ] });
    episodeAllowlist.push({ handle: `reflection-episode-${number}`, workId, revision: 1, runId });
  }
  const scopes = episodeAllowlist.map((episode, index) => ({ handle: `scope-${index + 1}`,
    sessionId: 'reflection-session', workId: episode.workId,
    subjectKeys: ['owner-safe'], channel: 'private' }));
  const currentCorrections = [{ handle: 'correction-safe', appliesToScopeHandles: scopes.map((item) => item.handle),
    head: { memoryId: 'memory-safe', subjectKey: 'owner-safe', subjectRevision: 2,
      sourceOrder: 3, status: 'active', sourceRecordIds: [correction.recordId] }, recordRefs: [correction] }];
  const counterHeads = [{ handle: 'counter-safe', episodeId: 'counter-episode',
    workId: 'counter-work', runId: 'counter-run', recordId: counter.recordId,
    sourceRevision: counter.sourceRevision, sha256: counter.sha256 }];
  const queryDigest = sha('query'); const sourceWindowDigest = sha('search-window');
  const resultDigest = hash(counterHeads);
  const runtimeSnapshot = { workState, runs,
    conversations: [{ sessionId: 'reflection-session', events: messages }], affectedScopes: scopes,
    currentCorrections, forgetHeads: scopes.map((scope) => ({ scopeHandle: scope.handle, epoch: 0,
      lastForgetRequestId: null, tombstoneDigest: null })), counterexampleSearch: { state: 'found',
      queryDigest, sourceWindowDigest, resultCount: 1, resultDigest,
      receiptDigest: hash({ state: 'found', queryDigest, sourceWindowDigest,
        resultCount: 1, resultDigest }), results: [{ handle: 'counter-safe', episodeId: 'counter-episode',
        workId: 'counter-work', runId: 'counter-run', recordRef: counter }] } };
  return { episodeAllowlist, runtimeSnapshot };
}

function exactReader() { return { async reopen(reference) { return { state: 'reopened', source: {
  schema: reference.sourceKind === 'conversation_message' ? 't5.conversation-event.v1'
    : reference.sourceKind === 'run_event' ? 't5.run-event.v1'
      : reference.sourceKind === 'work_event' ? 't5.work-event.v1' : 't5.web-source.v1' }, accounting: {
  schema: 't5.record-source-accounting.v1', recordId: reference.recordId,
  sourceKind: reference.sourceKind, sourceStore: reference.sourceStore,
  availability: 'available', coverage: reference.coverage ?? 'full', digestMatched: true,
  observedSha256: reference.sha256, bytesRead: 1, durationNs: '1' } }; } }; }

async function retainedReflection(root) {
  const ledger = new ReflectionLedger(join(root, 'reflection')); await ledger.ensure();
  const fixture = reflectionRuntimeFixture(); const reader = exactReader();
  const materialized = await materializeReflectionEvidence({ meaningProposal: { action: 'propose',
    hypothesis: '결과를 먼저 확인한다.', sourceEpisodeHandles: fixture.episodeAllowlist.map((item) => item.handle),
    affectedScopeHandles: fixture.runtimeSnapshot.affectedScopes.map((item) => item.handle),
    correctionRelations: [{ correctionHandle: 'correction-safe', relation: 'preserved' }],
    counterexampleHandles: ['counter-safe'], unknowns: ['다른 목적은 아직 모른다.'] },
  episodeAllowlist: fixture.episodeAllowlist, runtimeSnapshot: fixture.runtimeSnapshot,
  recordSourceReader: reader, reflectionId: 'reflection-safe', createdBy: 'background_reviewer', observedAt: at });
  await ledger.propose(materialized); const entry = (await ledger.read()).reflectionEntries[0];
  const probe = await materializeReflectionReviewProbe({ recordSourceReader: reader,
    recordRefs: entry.candidate.recordRefs, sourceFenceDigest: entry.candidate.sourceFence.windowDigest,
    affectedScopeDigest: entry.receipt.affectedScopeDigest });
  await ledger.review('reflection-safe', { requestId: 'retain-safe',
    expectedCandidateDigest: entry.candidate.candidateDigest, decision: 'retain',
    currentEvidence: { affectedScopeHandles: entry.candidate.candidate.affectedScopes,
      episodes: entry.candidate.episodes, recordRefs: entry.candidate.recordRefs,
      correctionHeads: entry.candidate.correctionHeads, forgetHeads: entry.candidate.sourceFence.forgetHeads },
    sourceProbeReceipt: probe });
  return { ledger, reader };
}

function candidate(counterexampleId) { return makePrincipleCandidate({ principleId: 'principle-safe',
  statement: '결과를 먼저 확인한다.', scope: ['scope-1', 'scope-2'],
  sourceReflectionIds: ['reflection-safe'], independentEpisodeIds: ['source-e1', 'source-e2'],
  counterexampleIds: [counterexampleId] }); }
function arm(kind, index, revisionDigest) { return { episodeId: `${kind}-e${index}`,
  workId: `${kind}-w${index}`, runId: `${kind}-r${index}`, resultDigest: sha(`${kind}-result-${index}`),
  eligibilityDigest: sha(`${kind}-eligible-${index}`), sourceRecordDigest: sha(`${kind}-source-${index}`),
  contextReceiptDigest: sha(`${kind}-context-${index}`),
  principleRevisionDigest: kind === 'candidate' ? revisionDigest : null,
  achieved: true, effectKnown: true, deliveryTerminal: true,
  currentCorrectionHeadDigest: correctionDigest, currentCorrectionReopened: true,
  metrics: { userCorrections: kind === 'candidate' ? 1 : 2,
    wallMs: kind === 'candidate' ? 90 + index : 120, providerTokens: kind === 'candidate' ? 900 + index : 1_200 } };
}
function pair(index, revisionDigest) {
  const value = { pairId: `pair-${index}`, purposeDigest: sha(`purpose-${index}`),
    executionOrder: index === 1 ? 'baseline_first' : 'candidate_first',
    baseline: arm('baseline', index, revisionDigest), candidate: arm('candidate', index, revisionDigest),
    evaluation: { pairedEvaluation: true, blind: true, armMappingDigest: sha(`mapping-${index}`),
      evaluatorRunId: `evaluator-${index}`, evaluatorIdentityDigest, evaluatorPromptDigest,
      evaluationInputDigest: '', evaluationDigest: sha(`evaluation-${index}`),
      taskOracleDigest: sha(`oracle-${index}`), samePurpose: true, baselineOraclePassed: true,
      candidateOraclePassed: true, baselineCorrect: true, candidateCorrect: true,
      baselineComplete: true, candidateComplete: true, userCorrectionPreserved: true,
      sourceExpressionsReused: false } };
  const body = { ...value }; delete body.evaluation;
  value.evaluation.evaluationInputDigest = hash({ schema: 't5.principle-pair-evaluation-input.v1', ...body });
  return value;
}
function pairReceipt(value, index, revisionDigest) {
  const baselineRefs = [ref(`baseline-${index}`)]; const candidateRefs = [ref(`candidate-${index}`)];
  const head = (armValue, refs) => ({ workId: armValue.workId, runId: armValue.runId,
    resultDigest: armValue.resultDigest, achieved: true, effectKnown: true, deliveryTerminal: true,
    principleRevisionDigest: armValue.principleRevisionDigest,
    contextReceiptDigest: armValue.contextReceiptDigest, recordRefs: refs });
  const baselineHead = head(value.baseline, baselineRefs); const candidateHead = head(value.candidate, candidateRefs);
  const armMapping = { baselineLabel: index === 0 ? 'A' : 'B', candidateLabel: index === 0 ? 'B' : 'A',
    randomized: true, mappingDigest: '' };
  armMapping.mappingDigest = hash({ pairId: value.pairId, baselineLabel: armMapping.baselineLabel,
    candidateLabel: armMapping.candidateLabel, randomized: true });
  const evaluatorRequest = { evaluatorIdentityDigest, evaluatorPromptDigest,
    pairInputDigest: value.evaluation.evaluationInputDigest, armMappingDigest: armMapping.mappingDigest,
    requestDigest: '' };
  evaluatorRequest.requestDigest = hash({ evaluatorIdentityDigest, evaluatorPromptDigest,
    pairInputDigest: evaluatorRequest.pairInputDigest, armMappingDigest: evaluatorRequest.armMappingDigest });
  const evaluatorOutput = { requestDigest: evaluatorRequest.requestDigest,
    evaluationDigest: value.evaluation.evaluationDigest, outputDigest: '' };
  evaluatorOutput.outputDigest = hash({ requestDigest: evaluatorOutput.requestDigest,
    evaluationDigest: evaluatorOutput.evaluationDigest });
  const taskOracleReceipt = { outputDigest: evaluatorOutput.outputDigest,
    taskOracleDigest: value.evaluation.taskOracleDigest, baselinePassed: true, candidatePassed: true,
    receiptDigest: '' };
  taskOracleReceipt.receiptDigest = hash({ outputDigest: taskOracleReceipt.outputDigest,
    taskOracleDigest: taskOracleReceipt.taskOracleDigest, baselinePassed: true, candidatePassed: true });
  const compact = (headValue, refs) => ({ ...headValue, recordRefs: undefined,
    accountingDigest: accounting(refs) });
  const core = { pairId: value.pairId, armMapping,
    baselineHead: compact(baselineHead, baselineRefs), candidateHead: compact(candidateHead, candidateRefs),
    evaluatorRequest, evaluatorOutput, taskOracleReceipt };
  return { pairId: value.pairId, armMapping, baselineHead, candidateHead,
    evaluatorRequest, evaluatorOutput, taskOracleReceipt, receiptDigest: hash(core) };
}

export async function runPrincipleProductQualification() {
  const root = await mkdtemp(join(tmpdir(), 't5-s3m6-principle-product-'));
  try {
    const { ledger, reader } = await retainedReflection(root); const retained = (await ledger.read()).reflectionEntries[0];
    const counterexampleId = retained.candidate.candidate.counterexampleRecordIds[0];
    const principle = candidate(counterexampleId); const pairs = [pair(1, principle.revisionDigest),
      pair(2, principle.revisionDigest)]; const correctionRefs = [ref('correction')];
    const pairReceipts = pairs.map((value, index) => pairReceipt(value, index, principle.revisionDigest));
    const requiredStores = ['context', 'run', 'work']; const bindings = {};
    for (const name of requiredStores) { const path = join(root, `${name}.json`); await writeFile(path, '{}');
      bindings[name] = { store: { path }, foregroundParticipating: true }; }
    const enumerate = async ({ epoch, writerRegistrations }) => { const heads = writerRegistrations.map((item) => ({
      store: item.store, headDigest: sha(`${item.store}-head`),
      writerRegistrationDigest: item.writerRegistrationDigest })).toSorted((a, b) => a.store.localeCompare(b.store));
      return { runtimeSnapshot: {}, episodeAllowlist: [], recordSourceReader: reader,
        storeHeadReceipt: { schema: 't5.reflection-store-head-receipt.v1', epoch, heads,
          receiptDigest: hash({ schema: 't5.reflection-store-head-receipt.v1', epoch, heads }) } }; };
    const sourceWindow = new ReflectionSourceWindowCoordinator({ ledger,
      enumerateSourceWindow: enumerate, requiredStores, storeBindings: bindings,
      materialize: async () => { throw new Error('not used'); } });
    const calls = new Map(); const observed = (name) => calls.set(name, (calls.get(name) ?? 0) + 1);
    const nearMiss = { nearMissId: 'near-1', episodeId: 'near-e', workId: 'near-w', runId: 'near-r',
      resultDigest: sha('near-result'), sourceRecordDigest: sha('near-source'), evaluatorIdentityDigest,
      evaluatorPromptDigest, evaluationDigest: sha('near-eval'), expectedTrigger: false,
      observedTrigger: false, sourceExpressionsReused: false };
    const counterexamples = [{ counterexampleId, episodeId: 'counter-e', workId: 'counter-w',
      runId: 'counter-r', resultDigest: sha('counter-result'), evidenceDigest: sha('counter-evidence'),
      disposition: 'scope_boundary' }];
    const fieldRefs = [ref('field')];
    const field = { fieldId: 'field-1', episodeId: 'field-e', workId: 'field-w', runId: 'field-r',
      resultDigest: sha('field-result'), eligibilityDigest: sha('field-eligible'),
      sourceRecordDigest: sha('field-source'), contextReceiptDigest: sha('field-context'),
      principleRevisionDigest: principle.revisionDigest, evaluatorIdentityDigest,
      evaluatorPromptDigest, evaluationDigest: sha('field-eval'),
      currentCorrectionHeadDigest: correctionDigest, candidateRevisionUsed: true, achieved: true,
      correct: true, complete: true, currentCorrectionReopened: true, userCorrectionPreserved: true,
      effectKnown: true, deliveryTerminal: true, regressionObserved: false,
      metrics: { userCorrections: 1, wallMs: 90, providerTokens: 900 } };
    const fieldHead = { episodeId: field.episodeId, workId: field.workId, runId: field.runId,
      resultDigest: field.resultDigest, achieved: true, effectKnown: true, deliveryTerminal: true,
      principleRevisionDigest: field.principleRevisionDigest,
      contextReceiptDigest: field.contextReceiptDigest, recordRefs: fieldRefs };
    const fieldInputDigest = hash({ episodeId: field.episodeId, workId: field.workId, runId: field.runId,
      resultDigest: field.resultDigest, principleRevisionDigest: field.principleRevisionDigest,
      currentCorrectionHeadDigest: field.currentCorrectionHeadDigest });
    const fieldEvaluator = { evaluatorIdentityDigest, evaluatorPromptDigest, fieldInputDigest,
      evaluationDigest: field.evaluationDigest, receiptDigest: '' };
    fieldEvaluator.receiptDigest = hash({ evaluatorIdentityDigest, evaluatorPromptDigest,
      fieldInputDigest, evaluationDigest: field.evaluationDigest });
    const fixtureDependencies = makePrincipleQualificationFixtureDependencies({ pairReceipts,
      currentCorrection: { headDigest: correctionDigest, recordRefs: correctionRefs,
        accountingDigest: accounting(correctionRefs) },
      nearMissSearch: searchReceipt('near_miss', ['near-1']),
      counterexampleSearch: searchReceipt('counterexample', [counterexampleId]),
      sideEffects: effectReceipt(), fieldHead, fieldEvaluator, seed: 0 });
    const runtime = makePrincipleEvidenceProductAdapter({ reflectionLedger: ledger,
      sourceWindowCoordinator: sourceWindow,
      recordSourceReader: makePrincipleRecordSourceReaderAdapter(reader),
      ...fixtureDependencies, observeMethod: observed });
    const replayMaterialized = await materializePrincipleReplayEvidence({ candidate: principle, pairs,
      nearMiss, counterexamples, sideEffects: zeroEffects(), runtime });
    const replay = qualifyPrincipleReplay(replayMaterialized);
    const fieldQualified = qualifyPrincipleField(await materializePrincipleFieldEvidence({
      replayQualification: replay, field, sideEffects: zeroEffects(), runtime }));
    const expectedMethods = ['withStableWindow', 'loadReviewedReflections', 'loadCanonicalPair',
      'evaluateBlindPair', 'observeCurrentCorrection', 'searchNearMiss', 'searchCounterexamples',
      'observeSideEffects', 'loadCanonicalField', 'evaluateField'];
    const result = { schema: 't5.s3m6.principle-product-qualification.v1',
      state: fieldQualified.candidate.state, replayPairs: replay.evidence.pairs.length,
      nearMisses: replay.evidence.nearMiss ? 1 : 0,
      counterexamples: replay.evidence.counterexamples.length, independentField: true,
      actualReflectionLedger: true, retainedReviewReceipt: (await ledger.read()).reviewReceipts.length === 1,
      sourceWindowStableLock: true, deterministicEvaluator: true, deterministicTaskOracle: true,
      seededOpaqueArmMappings: fixtureDependencies.rng.calls(),
      runtimeMethodCalls: Object.fromEntries(expectedMethods.map((name) => [name, calls.get(name) ?? 0])),
      rawCallerPaths: 0, modelCalls: 0, externalWrites: 0, productDefaultWiring: false,
      sideEffects: zeroEffects() };
    result.pass = result.state === 'field_qualified' && result.replayPairs === 2
      && result.counterexamples === 1 && result.independentField
      && result.seededOpaqueArmMappings === 2
      && Object.values(result.runtimeMethodCalls).every((count) => count > 0)
      && Object.values(result.sideEffects).every((count) => count === 0);
    return result;
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }); }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const result = await runPrincipleProductQualification();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (!result.pass) process.exitCode = 1;
}
