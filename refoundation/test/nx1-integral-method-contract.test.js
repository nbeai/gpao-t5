import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  NX_INTEGRAL_METHOD_LIMITS, assessIntegralMethodAdmission, compactClaimEvidenceJsonSchema,
  integralMethodCandidateJsonSchema, validateIntegralMethodCandidate,
} from './helpers/nx-integral-method-candidate.js';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('NX-1A는 exact DR-0 source를 재사용하고 없는 first-useful 값을 꾸미지 않는다', async () => {
  const baseline = JSON.parse(await read('refoundation/evidence/nx1-integral-baseline-freeze-2026-09-01.json'));
  assert.equal(baseline.status, 'BASELINE_FROZEN_CANDIDATE_RED');
  assert.equal(baseline.currentHead, '321a032716ae9b2a4b61def94f633f69bd9ee88e');
  assert.equal(baseline.productSourceBaseline, '93adf628527a511106b0a15da19d528ce8541ddb');
  assert.equal(baseline.productSourceChangedSinceBaseline, false);
  assert.equal(baseline.liveReplay.executed, false);
  assert.equal(baseline.baseline.purposes.length, 3);
  assert.equal(baseline.baseline.medians.finalWallMs, 64153.004);
  assert.equal(baseline.baseline.medians.modelCalls, 12);
  assert.equal(baseline.baseline.medians.inputTokens, 212662);
  assert.equal(baseline.baseline.medians.firstUsefulMs, null);
  assert.equal(baseline.requiredCandidateThresholds.firstUsefulComparisonState,
    'REQUIRES_NEW_AB_BA_MEASUREMENT_FOR_BOTH_ARMS');
  assert.equal(baseline.productSourceChanges, 0);
});

test('NX-1A 인간 Oracle은 후보 identity 없이 네 품질 축과 실제 이해 시간·재가공 부담을 잰다', async () => {
  const oracle = JSON.parse(await read('refoundation/fixtures/nx1-integral-human-blind-oracle.json'));
  assert.equal(oracle.status, 'FROZEN_BEFORE_CANDIDATE');
  assert.equal(oracle.candidateIdentityVisibleToEvaluator, false);
  assert.equal(oracle.methodIdentityVisibleToEvaluator, false);
  assert.equal(oracle.packets.length, 3);
  assert.ok(oracle.packets.every((packet) => packet.decisionQuestions.map((item) => item.id).join(',')
    === 'total_difference,largest_cause,immediate_action'));
  for (const dimension of ['humanMeaning', 'strategy', 'technicalReality', 'design']) {
    assert.ok(Array.isArray(oracle.observationForm[dimension]));
    assert.ok(oracle.observationForm[dimension].length >= 3);
  }
  assert.ok(oracle.observationForm.objectiveMeasures.includes('timeToAnswerEachQuestionMs'));
  assert.ok(oracle.observationForm.objectiveMeasures.includes('manualReformatActions'));
  assert.match(oracle.passRule.design, /answer finding time/u);
  assert.ok(oracle.forbidden.some((item) => item.includes('aesthetic preference alone')));
});

const currentWork = { workId: 'work-11111111', revision: 3, status: 'active' };
const sourceManifest = {
  state: 'verified', manifestId: 'sources-11111111',
  inputHandles: ['source-11111111', 'source-22222222', 'source-33333333'],
};
function validCandidate() {
  return {
    schema: 't5.integral-outcome-method.v1',
    work: { workId: currentWork.workId, revision: currentWork.revision },
    human: { purpose: '정산 차이를 확인한다', useContext: '지급 전 검토', audience: '운영 책임자' },
    strategy: {
      primaryOutcome: '실제 누락과 금액 차이만 근거와 함께 제시',
      requestedScope: ['누락', '금액 불일치'], excludedScope: ['정상 대조 행'],
      sufficientWhen: ['전체 결속 source coverage', '모든 핵심 claim의 exact source'],
    },
    reality: {
      sourceManifestId: sourceManifest.manifestId,
      exactInputHandles: [...sourceManifest.inputHandles], unresolvedFacts: [],
    },
    method: {
      operators: ['select', 'join', 'reconcile', 'calculate', 'validate', 'order'],
      checks: ['source coverage', 'normal and excluded separation', 'independent amount calculation'],
      expectedOutputs: [{ name: '정산 결과', kind: 'answer', effect: 'observe' }],
    },
    form: {
      deliverableForms: ['answer'], informationOrder: ['핵심 차이', '근거', '바로 할 행동'],
      visualHierarchyGoals: ['숫자와 단위 우선', '정상 항목 전면화 금지'],
    },
  };
}

test('NX-1B/C qualification contract는 6KiB 이하 exact schema를 active Work와 verified source에 결속한다', () => {
  const candidate = validCandidate();
  const validated = validateIntegralMethodCandidate(candidate, { currentWork, sourceManifest });
  assert.deepEqual(validated, candidate);
  assert.equal(Object.isFrozen(validated), true);
  assert.equal(Object.isFrozen(validated.strategy.requestedScope), true);
  assert.equal(NX_INTEGRAL_METHOD_LIMITS.serializedBytes, 6 * 1024);
});

test('Tool input schema는 validator의 operator·effect·deliverable 정본에서 생성돼 drift하지 않는다', () => {
  const schema = integralMethodCandidateJsonSchema();
  assert.deepEqual(schema.properties.method.properties.operators.items.enum, NX_INTEGRAL_METHOD_LIMITS.operators);
  assert.deepEqual(schema.properties.method.properties.expectedOutputs.items.properties.effect.enum,
    NX_INTEGRAL_METHOD_LIMITS.effects);
  assert.deepEqual(schema.properties.form.properties.deliverableForms.items.enum,
    NX_INTEGRAL_METHOD_LIMITS.outputKinds);
  assert.deepEqual(compactClaimEvidenceJsonSchema().properties.claims.items.properties.state.enum,
    ['supported', 'conflict', 'unknown']);
});

test('NX-1B admission은 source manifest가 없거나 source 하나뿐인 Direct·single Hand에 개입하지 않는다', () => {
  assert.deepEqual(assessIntegralMethodAdmission({ currentWork, sourceManifest: null }),
    { eligible: false, reason: 'source_manifest_absent' });
  assert.deepEqual(assessIntegralMethodAdmission({ currentWork, sourceManifest: {
    ...sourceManifest, inputHandles: ['source-11111111'],
  } }), { eligible: false, reason: 'single_source_path' });
  assert.deepEqual(assessIntegralMethodAdmission({ currentWork, sourceManifest }),
    { eligible: true, reason: 'verified_multi_source_reality' });
});

test('NX-1B contract는 stale revision·foreign manifest·source set 부분집합·escape를 실행 전에 거부한다', () => {
  const stale = validCandidate(); stale.work.revision += 1;
  assert.throws(() => validateIntegralMethodCandidate(stale, { currentWork, sourceManifest }), /stale or foreign Work/u);
  const foreignManifest = validCandidate(); foreignManifest.reality.sourceManifestId = 'sources-99999999';
  assert.throws(() => validateIntegralMethodCandidate(foreignManifest, { currentWork, sourceManifest }), /stale or foreign/u);
  const subset = validCandidate(); subset.reality.exactInputHandles.pop();
  assert.throws(() => validateIntegralMethodCandidate(subset, { currentWork, sourceManifest }), /equal the exact source manifest set/u);
  const escape = validCandidate(); escape.reality.exactInputHandles[0] = 'source-99999999';
  assert.throws(() => validateIntegralMethodCandidate(escape, { currentWork, sourceManifest }), /equal the exact source manifest set/u);
});

test('NX-1B contract는 6KiB 초과·열린 schema·raw path·secret·unsupported effect를 거부한다', () => {
  const tooLarge = validCandidate(); tooLarge.human.purpose = '가'.repeat(6 * 1024);
  assert.throws(() => validateIntegralMethodCandidate(tooLarge, { currentWork, sourceManifest }), /6KiB/u);
  const open = validCandidate(); open.intent = 'expense';
  assert.throws(() => validateIntegralMethodCandidate(open, { currentWork, sourceManifest }), /fields are invalid/u);
  const path = validCandidate(); path.human.useContext = '/Users/example/private.xlsx';
  assert.throws(() => validateIntegralMethodCandidate(path, { currentWork, sourceManifest }), /raw path or secret/u);
  const secret = validCandidate(); secret.human.useContext = 'Bearer top-secret-value';
  assert.throws(() => validateIntegralMethodCandidate(secret, { currentWork, sourceManifest }), /raw path or secret/u);
  const effect = validCandidate(); effect.method.expectedOutputs[0].effect = 'external_change';
  assert.throws(() => validateIntegralMethodCandidate(effect, { currentWork, sourceManifest }), /unsupported output or effect/u);
});

test('제품 승격은 Console의 deferred runtime 한 경계만 열고 AgentLoop·전역 Prompt·Work Store를 분기하지 않는다', async () => {
  const [server, loop, modelFactory, workStore] = await Promise.all([
    read('refoundation/src/console-server.js'), read('refoundation/src/agent-loop.js'),
    read('refoundation/src/console-model-factory.js'), read('refoundation/src/work-store.js'),
  ]);
  assert.match(server, /makeIntegralMethodRuntime/u);
  assert.match(server, /onSourcesBound:.*integralMethod\.prepare/su);
  for (const source of [loop, modelFactory, workStore]) assert.doesNotMatch(source,
    /integral[-_]method|integral outcome method/iu);
  assert.doesNotMatch(server, /IntegralMethodStore|intent.*integral|purchase_reconciliation|contract_revision|expense_evidence/iu);
});
