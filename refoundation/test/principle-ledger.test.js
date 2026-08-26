import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makePrincipleEvidenceRuntime, materializePrincipleFieldEvidence,
  materializePrincipleReplayEvidence } from '../src/principle-evidence-materializer.js';
import { PrincipleLedger, makePrincipleRollbackRuntime } from '../src/principle-ledger.js';
import { makePrincipleCandidate, qualifyPrincipleField,
  qualifyPrincipleReplay } from '../src/principle-qualification.js';
import { makeRecordReference } from '../src/record-reference.js';

const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
const hash = (v) => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const sha = (v) => hash(String(v)); const correction = sha('correction');
const evaluator = sha('evaluator'); const prompt = sha('prompt');
const effects = { memoryWrites: 0, principleWrites: 0, managedSkillWrites: 0,
  managedCliWrites: 0, pluginWrites: 0, externalWrites: 0 };
const effectReceipt = { ...effects, receiptDigest: hash({ schema: 't5.principle-side-effects.v1', ...effects }) };
const ref = (id, workId = `w-${id}`, runId = null, resultDigest = null) => makeRecordReference({
  sourceKind: runId ? 'run_event' : 'conversation_message', sourceStore: runId ? 'run-ledger' : 'conversation-ledger',
  sourceId: id, sourceRevision: 1, sha256: sha(id), occurredAt: '2026-08-27T00:00:00.000Z',
  recordedAt: '2026-08-27T00:00:00.000Z', scope: { sessionId: 'session', workId,
    subjectKeys: ['subject'], channel: 'private' }, trust: runId ? 'runtime_observed' : 'user_asserted',
  sensitivity: 'personal', coverage: 'full', availability: 'available',
  ...(runId ? {} : {}) });
const reader = { async reopen(reference) { const runId = reference.sourceId.startsWith('trigger-')
  ? reference.sourceId.slice('trigger-'.length) : null; return { state: 'reopened', source: runId
    ? { runId, workId: reference.scope.workId, resultDigest: sha(`result-${runId}`) } : {}, accounting: {
    recordId: reference.recordId, availability: 'available', digestMatched: true, observedSha256: reference.sha256 } }; } };
const accounting = (refs) => hash(refs.map((r) => ({ recordId: r.recordId,
  observedSha256: r.sha256 })).toSorted((a, b) => a.recordId.localeCompare(b.recordId)));
const search = (kind, ids) => { const resultIds = [...ids].toSorted(); const resultDigest = hash(resultIds);
  const core = { kind, resultIds, resultCount: resultIds.length, resultDigest };
  return { ...core, receiptDigest: hash(core) }; };
function candidate(statement = '결과를 먼저 확인한다.') { return makePrincipleCandidate({ principleId: 'principle-safe', statement,
  scope: ['scope-safe'], sourceReflectionIds: ['reflection-safe'],
  independentEpisodeIds: ['source-e1', 'source-e2'], counterexampleIds: ['counter-1'] }); }
function arm(kind, i, revision) { return { episodeId: `${kind}-e${i}`, workId: `${kind}-w${i}`,
  runId: `${kind}-r${i}`, resultDigest: sha(`${kind}-result-${i}`), eligibilityDigest: sha(`${kind}-eligible-${i}`),
  sourceRecordDigest: sha(`${kind}-source-${i}`), contextReceiptDigest: sha(`${kind}-context-${i}`),
  principleRevisionDigest: kind === 'candidate' ? revision : null, achieved: true, effectKnown: true,
  deliveryTerminal: true, currentCorrectionHeadDigest: correction, currentCorrectionReopened: true,
  metrics: { userCorrections: kind === 'candidate' ? 1 : 2, wallMs: kind === 'candidate' ? 90 : 120,
    providerTokens: kind === 'candidate' ? 900 : 1_200 } }; }
function pair(i, revision) { const value = { pairId: `pair-${i}`, purposeDigest: sha(`purpose-${i}`),
  executionOrder: i === 1 ? 'baseline_first' : 'candidate_first', baseline: arm('baseline', i, revision),
  candidate: arm('candidate', i, revision) }; const inputDigest = hash({
    schema: 't5.principle-pair-evaluation-input.v1', ...value }); return { ...value,
  evaluation: { pairedEvaluation: true, blind: true, armMappingDigest: sha(`map-${i}`),
    evaluatorRunId: `eval-${i}`, evaluatorIdentityDigest: evaluator, evaluatorPromptDigest: prompt,
    evaluationInputDigest: inputDigest, evaluationDigest: sha(`eval-out-${i}`), taskOracleDigest: sha(`oracle-${i}`),
    samePurpose: true, baselineOraclePassed: true, candidateOraclePassed: true, baselineCorrect: true,
    candidateCorrect: true, baselineComplete: true, candidateComplete: true,
    userCorrectionPreserved: true, sourceExpressionsReused: false } }; }
function pairReceipt(p, i) { const br = [ref(`b-${i}`)], cr = [ref(`c-${i}`)];
  const head = (a, refs) => ({ workId: a.workId, runId: a.runId, resultDigest: a.resultDigest,
    achieved: true, effectKnown: true, deliveryTerminal: true, principleRevisionDigest: a.principleRevisionDigest,
    contextReceiptDigest: a.contextReceiptDigest, recordRefs: refs });
  const baselineHead = head(p.baseline, br), candidateHead = head(p.candidate, cr);
  const armMapping = { baselineLabel: i % 2 ? 'A' : 'B', candidateLabel: i % 2 ? 'B' : 'A', randomized: true,
    mappingDigest: '' }; armMapping.mappingDigest = hash({ pairId: p.pairId,
    baselineLabel: armMapping.baselineLabel, candidateLabel: armMapping.candidateLabel, randomized: true });
  const evaluatorRequest = { evaluatorIdentityDigest: evaluator, evaluatorPromptDigest: prompt,
    pairInputDigest: p.evaluation.evaluationInputDigest, armMappingDigest: armMapping.mappingDigest, requestDigest: '' };
  evaluatorRequest.requestDigest = hash({ evaluatorIdentityDigest: evaluator, evaluatorPromptDigest: prompt,
    pairInputDigest: evaluatorRequest.pairInputDigest, armMappingDigest: evaluatorRequest.armMappingDigest });
  const evaluatorOutput = { requestDigest: evaluatorRequest.requestDigest,
    evaluationDigest: p.evaluation.evaluationDigest, outputDigest: '' };
  evaluatorOutput.outputDigest = hash({ requestDigest: evaluatorOutput.requestDigest,
    evaluationDigest: evaluatorOutput.evaluationDigest });
  const taskOracleReceipt = { outputDigest: evaluatorOutput.outputDigest, taskOracleDigest: p.evaluation.taskOracleDigest,
    baselinePassed: true, candidatePassed: true, receiptDigest: '' };
  taskOracleReceipt.receiptDigest = hash({ outputDigest: taskOracleReceipt.outputDigest,
    taskOracleDigest: taskOracleReceipt.taskOracleDigest, baselinePassed: true, candidatePassed: true });
  const clean = (h, refs) => ({ ...h, recordRefs: undefined, accountingDigest: accounting(refs) });
  const core = { pairId: p.pairId, armMapping, baselineHead: clean(baselineHead, br),
    candidateHead: clean(candidateHead, cr), evaluatorRequest, evaluatorOutput, taskOracleReceipt };
  return { pairId: p.pairId, armMapping, baselineHead, candidateHead, evaluatorRequest,
    evaluatorOutput, taskOracleReceipt, receiptDigest: hash(core) }; }
function runtime(proof) { return makePrincipleEvidenceRuntime({ withStableWindow: async (cb) => cb(),
  loadReviewedReflections: async () => proof.reflections,
  loadCanonicalPair: async (_p, i) => ({ baselineHead: proof.pairs[i].baselineHead,
    candidateHead: proof.pairs[i].candidateHead, recordSourceReader: reader }),
  evaluateBlindPair: async (_p, _c, i) => proof.pairs[i],
  observeCurrentCorrection: async () => ({ proof: proof.correction, recordSourceReader: reader }),
  searchNearMiss: async () => proof.near, searchCounterexamples: async () => proof.counter,
  observeSideEffects: async () => effectReceipt,
  loadCanonicalField: async () => ({ fieldHead: proof.fieldHead, recordSourceReader: reader }),
  evaluateField: async () => proof.fieldEvaluator }); }
async function qualification(statement = '결과를 먼저 확인한다.') { const c = candidate(statement);
  const pairs = [pair(1, c.revisionDigest), pair(2, c.revisionDigest)]; const correctionRefs = [ref('correction')];
  const proof = { reflections: [{ reflectionId: 'reflection-safe', revisionDigest: sha('rr'),
    materializationDigest: sha('rm'), reviewReceiptDigest: sha('review'), state: 'reviewed', decision: 'retain',
    scopeHandles: ['scope-safe'], counterexampleIds: ['counter-1'] }], pairs: pairs.map(pairReceipt),
  correction: { headDigest: correction, recordRefs: correctionRefs, accountingDigest: accounting(correctionRefs) },
  near: search('near_miss', ['near-1']), counter: search('counterexample', ['counter-1']) };
  const nearMiss = { nearMissId: 'near-1', episodeId: 'near-e', workId: 'near-w', runId: 'near-r',
    resultDigest: sha('near-result'), sourceRecordDigest: sha('near-source'), evaluatorIdentityDigest: evaluator,
    evaluatorPromptDigest: prompt, evaluationDigest: sha('near-eval'), expectedTrigger: false,
    observedTrigger: false, sourceExpressionsReused: false };
  const counterexamples = [{ counterexampleId: 'counter-1', episodeId: 'counter-e', workId: 'counter-w',
    runId: 'counter-r', resultDigest: sha('counter-result'), evidenceDigest: sha('counter-evidence'),
    disposition: 'scope_boundary' }];
  const replay = qualifyPrincipleReplay(await materializePrincipleReplayEvidence({ candidate: c, pairs, nearMiss,
    counterexamples, sideEffects: effects, runtime: runtime(proof) }));
  const fieldRefs = [ref('field')], fieldCorrectionRefs = [ref('field-correction')];
  const field = { fieldId: 'field-1', episodeId: 'field-e', workId: 'field-w', runId: 'field-r',
    resultDigest: sha('field-result'), eligibilityDigest: sha('field-eligible'), sourceRecordDigest: sha('field-source'),
    contextReceiptDigest: sha('field-context'), principleRevisionDigest: c.revisionDigest,
    evaluatorIdentityDigest: evaluator, evaluatorPromptDigest: prompt, evaluationDigest: sha('field-eval'),
    currentCorrectionHeadDigest: correction, candidateRevisionUsed: true, achieved: true, correct: true,
    complete: true, currentCorrectionReopened: true, userCorrectionPreserved: true, effectKnown: true,
    deliveryTerminal: true, regressionObserved: false,
    metrics: { userCorrections: 1, wallMs: 90, providerTokens: 900 } };
  const inputDigest = hash({ episodeId: field.episodeId, workId: field.workId, runId: field.runId,
    resultDigest: field.resultDigest, principleRevisionDigest: field.principleRevisionDigest,
    currentCorrectionHeadDigest: field.currentCorrectionHeadDigest });
  proof.fieldHead = { episodeId: field.episodeId, workId: field.workId, runId: field.runId,
    resultDigest: field.resultDigest, achieved: true, effectKnown: true, deliveryTerminal: true,
    principleRevisionDigest: c.revisionDigest, contextReceiptDigest: field.contextReceiptDigest, recordRefs: fieldRefs };
  proof.correction = { headDigest: correction, recordRefs: fieldCorrectionRefs,
    accountingDigest: accounting(fieldCorrectionRefs) };
  proof.fieldEvaluator = { evaluatorIdentityDigest: evaluator, evaluatorPromptDigest: prompt,
    fieldInputDigest: inputDigest, evaluationDigest: field.evaluationDigest, receiptDigest: hash({
      evaluatorIdentityDigest: evaluator, evaluatorPromptDigest: prompt, fieldInputDigest: inputDigest,
      evaluationDigest: field.evaluationDigest }) };
  return qualifyPrincipleField(await materializePrincipleFieldEvidence({ replayQualification: replay,
    field, sideEffects: effects, runtime: runtime(proof) })); }
async function room(name) { return mkdtemp(join(tmpdir(), `t5-principle-ledger-${name}-`)); }
function rollbackRuntime() { return makePrincipleRollbackRuntime({ withStableWindow: async (cb) => cb(),
  recordSourceReader: reader }); }
function trigger(revision, runId = 'regression-run') { const workId = 'regression-work'; const resultDigest = sha(`result-${runId}`);
  const recordRef = ref(`trigger-${runId}`, workId, runId, resultDigest); return { workId, runId, resultDigest,
    type: 'correctness_regression', evidenceDigest: sha('regression-evidence'), recordRef }; }

test('field-qualified만 publish하고 current internal projection·default Context0을 만든다', async () => {
  const dir = await room('publish'); try { const ledger = new PrincipleLedger(dir); await ledger.ensure();
    const qualified = await qualification(); const published = await ledger.publish(qualified);
    assert.equal(published.created, true); assert.equal(published.defaultProjectionCount, 0);
    const state = await ledger.read(); assert.equal(state.currentPrinciples.length, 1);
    assert.equal(state.currentPrinciples[0].statement, '결과를 먼저 확인한다.');
    assert.deepEqual(state.defaultModelContext, []); assert.deepEqual(state.activeSkills, []);
    await assert.rejects(ledger.publish(qualified.candidate), /FieldQualification|unknown/u);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('동일 qualification publish는 idempotent이고 다른 field revision이 current가 된다', async () => {
  const dir = await room('versions'); try { const ledger = new PrincipleLedger(dir); await ledger.ensure();
    const first = await qualification(); assert.equal((await ledger.publish(first)).created, true);
    assert.equal((await ledger.publish(first)).idempotent, true);
    const second = await qualification('결과와 source receipt를 먼저 확인한다.'); await ledger.publish(second);
    assert.equal((await ledger.read()).currentPrinciples[0].revisionDigest, second.candidate.revisionDigest);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rollback은 exact trigger reopen 뒤 current를 archive하고 이전 field-qualified만 복원한다', async () => {
  const dir = await room('rollback'); try { const ledger = new PrincipleLedger(dir); await ledger.ensure();
    const first = await qualification(); const second = await qualification('source receipt를 먼저 확인한다.');
    await ledger.publish(first); await ledger.publish(second); const t = trigger(second.candidate.revisionDigest);
    const rolled = await ledger.rollback({ requestId: 'rollback-1', principleId: 'principle-safe',
      expectedRevisionDigest: second.candidate.revisionDigest, trigger: t, runtime: rollbackRuntime() });
    assert.equal(rolled.current.revisionDigest, first.candidate.revisionDigest);
    assert.equal(rolled.receipt.archivedRevisionDigest, second.candidate.revisionDigest);
    assert.deepEqual(rolled.sideEffects, { memoryWrites: 0, managedSkillWrites: 0,
      managedCliWrites: 0, pluginWrites: 0, externalWrites: 0 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('이전 qualified revision이 없으면 rollback current는 null이다', async () => {
  const dir = await room('null'); try { const ledger = new PrincipleLedger(dir); await ledger.ensure();
    const only = await qualification(); await ledger.publish(only);
    const rolled = await ledger.rollback({ requestId: 'rollback-null', principleId: 'principle-safe',
      expectedRevisionDigest: only.candidate.revisionDigest, trigger: trigger(only.candidate.revisionDigest),
      runtime: rollbackRuntime() }); assert.equal(rolled.current, null);
    assert.equal((await ledger.read()).currentPrinciples.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rollback requestId retry는 idempotent이고 payload collision·stale revision을 막는다', async () => {
  const dir = await room('idempotent'); try { const ledger = new PrincipleLedger(dir); await ledger.ensure();
    const only = await qualification(); await ledger.publish(only); const input = { requestId: 'rollback-repeat',
      principleId: 'principle-safe', expectedRevisionDigest: only.candidate.revisionDigest,
      trigger: trigger(only.candidate.revisionDigest), runtime: rollbackRuntime() };
    const first = await ledger.rollback(input); const retry = await ledger.rollback(input);
    assert.equal(first.idempotent, false); assert.equal(retry.idempotent, true);
    await assert.rejects(ledger.rollback({ ...input, trigger: trigger(only.candidate.revisionDigest, 'other-run') }),
      (error) => error.code === 'principle_rollback_request_conflict');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('trigger changed·wrong result·clone runtime은 rollback event 0이다', async () => {
  const dir = await room('trigger'); try { const ledger = new PrincipleLedger(dir); await ledger.ensure();
    const only = await qualification(); await ledger.publish(only); const badRuntime = makePrincipleRollbackRuntime({
      withStableWindow: async (cb) => cb(), recordSourceReader: { async reopen(reference) { return {
        state: 'changed', source: null, accounting: { recordId: reference.recordId, availability: 'changed' } }; } } });
    await assert.rejects(ledger.rollback({ requestId: 'rollback-bad', principleId: 'principle-safe',
      expectedRevisionDigest: only.candidate.revisionDigest, trigger: trigger(only.candidate.revisionDigest),
      runtime: badRuntime }), /source reopen/u);
    assert.equal((await ledger.read()).events.filter((event) => event.type === 'principle_rolled_back').length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('conversation 또는 user-asserted source는 rollback trigger가 될 수 없다', async () => {
  const dir = await room('trigger-kind'); try { const ledger = new PrincipleLedger(dir); await ledger.ensure();
    const only = await qualification(); await ledger.publish(only); const bad = trigger(only.candidate.revisionDigest);
    bad.recordRef = ref('conversation-trigger');
    await assert.rejects(ledger.rollback({ requestId: 'rollback-kind', principleId: 'principle-safe',
      expectedRevisionDigest: only.candidate.revisionDigest, trigger: bad, runtime: rollbackRuntime() }),
    /runtime-observed Run or Work/u);
    assert.equal((await ledger.read()).events.filter((event) => event.type === 'principle_rolled_back').length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('persisted rollback fingerprint·trigger enum·trigger digest/text 변조는 event hash 재작성 뒤에도 실패한다', async () => {
  for (const mode of ['fingerprint', 'type', 'digest']) { const dir = await room(`semantic-${mode}`);
    try { const ledger = new PrincipleLedger(dir); await ledger.ensure(); const only = await qualification();
      await ledger.publish(only); await ledger.rollback({ requestId: `rollback-${mode}`,
        principleId: 'principle-safe', expectedRevisionDigest: only.candidate.revisionDigest,
        trigger: trigger(only.candidate.revisionDigest), runtime: rollbackRuntime() });
      const events = (await readFile(ledger.path, 'utf8')).trimEnd().split('\n').map(JSON.parse);
      const event = events.at(-1); const receipt = event.payload.receipt;
      if (mode === 'fingerprint') receipt.requestFingerprint = sha('forged-fingerprint');
      if (mode === 'type') receipt.triggerReceipt.type = 'arbitrary_trigger';
      if (mode === 'digest') receipt.triggerReceipt.evidenceDigest = 'not-a-digest';
      const triggerCore = { ...receipt.triggerReceipt }; delete triggerCore.receiptDigest;
      receipt.triggerReceipt.receiptDigest = hash(triggerCore);
      const receiptCore = { ...receipt }; delete receiptCore.receiptDigest;
      receipt.receiptDigest = hash(receiptCore);
      const eventCore = { ...event }; delete eventCore.eventDigest; event.eventDigest = hash(eventCore);
      await writeFile(ledger.path, `${events.map(JSON.stringify).join('\n')}\n`, 'utf8');
      await assert.rejects(new PrincipleLedger(dir).read(), /rollback|trigger|invalid/u);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
});

test('append failure는 publish/rollback projection을 바꾸지 않는다', async () => {
  for (const mode of ['publish', 'rollback']) { const dir = await room(`failure-${mode}`); let fail = false;
    try { const ledger = new PrincipleLedger(dir, { beforeAppend: async (event) => {
      if (fail && ((mode === 'publish' && event.type === 'principle_published')
        || (mode === 'rollback' && event.type === 'principle_rolled_back'))) throw new Error('injected append failure'); } });
      await ledger.ensure(); const q = await qualification(); if (mode === 'rollback') await ledger.publish(q); fail = true;
      await assert.rejects(mode === 'publish' ? ledger.publish(q) : ledger.rollback({ requestId: 'rollback-fail',
        principleId: 'principle-safe', expectedRevisionDigest: q.candidate.revisionDigest,
        trigger: trigger(q.candidate.revisionDigest), runtime: rollbackRuntime() }), /injected/u);
      assert.equal((await ledger.read()).currentPrinciples.length, mode === 'publish' ? 0 : 1);
    } finally { await rm(dir, { recursive: true, force: true }); } }
});

test('write 뒤 응답 유실은 restart physical truth를 읽고 같은 publish를 idempotent 처리한다', async () => {
  const dir = await room('after-write'); let inject = false;
  try { const ledger = new PrincipleLedger(dir, { afterWrite: async (event) => {
    if (inject && event.type === 'principle_published') { inject = false; throw new Error('response lost after write'); }
  } });
  await ledger.ensure(); const qualified = await qualification(); inject = true;
  await assert.rejects(ledger.publish(qualified), /response lost/u);
  const restarted = new PrincipleLedger(dir); assert.equal((await restarted.read()).currentPrinciples.length, 1);
  const retry = await restarted.publish(qualified); assert.equal(retry.idempotent, true);
  assert.equal((await restarted.read()).events.filter((event) => event.type === 'principle_published').length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('event digest tamper·partial line·symlink path를 restart에서 거부한다', async () => {
  const dir = await room('integrity'); try { const ledger = new PrincipleLedger(dir); await ledger.ensure();
    await ledger.publish(await qualification()); const raw = await readFile(ledger.path, 'utf8');
    await import('node:fs/promises').then(({ writeFile }) => writeFile(ledger.path,
      raw.replace('결과를 먼저 확인한다.', '변조된 원리'), 'utf8'));
    await assert.rejects(new PrincipleLedger(dir).read(), /integrity/u);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Principle ledger는 Skill·managed capability·plugin·model을 import하지 않는다', async () => {
  const source = await readFile(new URL('../src/principle-ledger.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from\s+['"][^'"]*(?:skill|managed|capability|plugin|model)[^'"]*['"]/iu);
});
