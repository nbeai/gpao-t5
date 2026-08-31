import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildNx1ScenarioReality, evaluateNx1Answer, evaluateNx1ClaimEvidence,
  evaluateNx1PresentationCoverage,
  makeNx1HumanClosureTool, makeNx1IntegralTool, nx1CandidateRuntimeContext,
} from './helpers/nx-integral-flagship-qualification.js';

const root = new URL('../../', import.meta.url);
const oracle = JSON.parse(await readFile(new URL(
  'refoundation/evidence/s6-ng5-dr0-hidden-oracle-2026-08-31.json', root), 'utf8'));
const fixtureRoot = new URL('refoundation/fixtures/s6-ng5-dr0/', root).pathname;

test('NX-1 runner source packet은 exact fixture 1 packet만 포함하고 hidden oracle 답은 투영하지 않는다', async () => {
  const definition = oracle.scenarios[0]; const reality = await buildNx1ScenarioReality({ definition, fixtureRoot });
  assert.equal(reality.records.length, definition.sources.length);
  assert.deepEqual(reality.sourceManifest.inputHandles, reality.records.map((record) => record.handle));
  assert.equal(reality.evidenceAtoms[0].atomId, 'atom-0001');
  assert.equal(new Set(reality.evidenceAtoms.map((atom) => atom.atomId)).size, reality.evidenceAtoms.length);
  const context = nx1CandidateRuntimeContext(reality);
  assert.match(context, /PO-2026-104/u);
  assert.doesNotMatch(context, /hidden oracle|purchase_amount_variance|KRW 50,000 excess/u);
  assert.doesNotMatch(context, new RegExp(fixtureRoot.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
});

test('NX-1 machine evaluator는 핵심 정답과 normal·excluded 전면화 금지를 함께 본다', () => {
  assert.equal(evaluateNx1Answer('purchase_reconciliation',
    '120개 중 118개 수락, 2개 부족. 3,000,000원과 2,950,000원의 차이는 50,000원입니다.').passed, true);
  assert.equal(evaluateNx1Answer('purchase_reconciliation',
    'Ordered 120 EA, accepted 118 EA, shortage 2 EA. 3000000 - 2950000 = 50000.').passed, true);
  assert.equal(evaluateNx1Answer('purchase_reconciliation',
    '120개 중 118개 수락, 2개 부족. 3,000,000원과 2,950,000원의 차이는 50,000원입니다. PO-2026-105도 누락입니다.').passed, false);
  assert.equal(evaluateNx1Answer('purchase_reconciliation',
    '120개 중 118개 수락, 2개 부족. 3,000,000원과 2,950,000원의 차이는 50,000원입니다. 참고로 세금계산서와 거래명세는 서로 일치합니다.').passed, false);
  const evidence = { claims: [{ summary: 'C-101 R-101-A 18,700 중복. C-102 42,000 대 41,000, 차이 1,000. C-103 15,500 증빙 누락.',
    evidenceValues: [{ valueId: 'receipt', label: 'receipt', value: 'R-101-A', unit: 'id' },
      { valueId: 'c101', label: 'C-101', value: 18700, unit: 'KRW' },
      { valueId: 'c102-ledger', label: 'C-102 ledger', value: 42000, unit: 'KRW' },
      { valueId: 'c102-evidence', label: 'C-102 evidence', value: 41000, unit: 'KRW' },
      { valueId: 'variance', label: 'variance', value: 1000, unit: 'KRW' },
      { valueId: 'c103', label: 'C-103', value: 15500, unit: 'KRW' },
      { valueId: 'tax', label: 'verification only tax', value: 3727, unit: 'KRW' }],
  }],
    excludedFindings: [{ findingId: 'expense-control-C104', reason: 'C-104 control 대조 제외' }] };
  assert.equal(evaluateNx1ClaimEvidence('expense_evidence', evidence).passed, true);
  evidence.claims[0].summary += ' C-104도 누락.';
  assert.equal(evaluateNx1ClaimEvidence('expense_evidence', evidence).passed, false);
  const projection = { claims: [{ presentationValues: [{ label: 'missing amount', value: 15500, unit: 'KRW' },
    { label: 'verification-only excluded', value: 3727, unit: 'KRW' }] }] };
  assert.equal(evaluateNx1PresentationCoverage(projection, '누락 금액은 15,500원입니다.').passed, false);
  projection.claims[0].presentationValues.pop();
  assert.equal(evaluateNx1PresentationCoverage(projection, '누락 금액은 15,500원입니다.').passed, true);
  const purchase = { claims: [{ summary: '입고 승인 수량이 발주보다 적다.',
    evidenceValues: [
      { label: 'ordered', value: 120, unit: 'units' },
      { label: 'accepted', value: 118, unit: 'units' },
      { label: 'short quantity', value: 2, unit: 'units' },
      { label: 'invoice', value: 3000000, unit: 'KRW' },
      { label: 'accepted basis', value: 2950000, unit: 'KRW' },
      { label: 'difference', value: 50000, unit: 'KRW' },
    ] }], excludedFindings: [{ findingId: 'control', reason: 'control packet 밖 대조 제외' }] };
  assert.equal(evaluateNx1ClaimEvidence('purchase_reconciliation', purchase).passed, true);
});

test('NX-1 live runner는 AB·BA와 product-promotion pending을 명시한다', async () => {
  const source = await readFile(new URL('../scripts/run-nx1-integral-flagship.mjs', import.meta.url), 'utf8');
  assert.match(source, /--order/u); assert.match(source, /\['AB', 'BA'\]/u);
  assert.match(source, /--arms/u);
  assert.match(source, /--human-connections/u);
  assert.match(source, /NON_GATING_OPTIONAL_OBSERVATION/u);
  assert.match(source, /api_key:upstage:solar-pro4/u);
  assert.match(source, /buildNx1ScenarioReality, evaluateNx1Answer, makeNx1HumanClosureTool/u);
  assert.match(source, /requiredToolName: 'integral_method'/u);
  assert.match(source, /requiredToolName: 'human_closure'/u);
  assert.match(source, /closureResult\.finalAnswer/u);
  assert.match(source, /human_closure_failed/u);
  assert.match(source, /instructionsOverride: NX1_REALITY_CLOSURE_INSTRUCTIONS/u);
  assert.match(source, /instructionsOverride: NX1_HUMAN_CLOSURE_INSTRUCTIONS/u);
  assert.doesNotMatch(source, /runAgent/u);
  assert.match(source, /humanBlindEvaluation: 'PENDING'/u);
  assert.match(source, /productPromotion: 'NOT_EVALUATED'/u);
  assert.match(source, /gatingHumanClosuresPassed/u);
  assert.match(source, /baseline_execution_failed/u);
  assert.match(source, /allBaselineExecutionsCompleted/u);
  assert.doesNotMatch(source, /console-server\.js.*writeFile|agent-loop\.js.*writeFile/iu);
});

test('verified Reality projection은 evidence pool만 주고 excluded 내용은 Human Closure에서 숨긴다', () => {
  const reality = { currentWork: { workId: 'work-11111111', revision: 1, status: 'active' },
    sourceManifest: { state: 'verified', manifestId: 'sources-11111111', inputHandles: ['source-11111111', 'source-22222222'] },
    records: [], projections: [], evidenceAtoms: [{ atomId: 'atom-11111111111111111111',
      handle: 'source-11111111', location: 'page:1:line:1', kind: 'literal', value: 'fixture', unit: '' }] };
  const integral = makeNx1IntegralTool({ reality, scenarioId: 'purchase_reconciliation' });
  assert.equal(integral.modelProjection(), null);
  assert.deepEqual(integral.tool.projectResultForModel(), {
    schema: 't5.nx1.verified-core-claims.v1', state: 'unverified',
  });
  const source = integral.tool.projectResultForModel;
  assert.doesNotMatch(String(source), /excludedFindings.*map|sourceRefs.*handle/su);
});

test('Human Closure는 verified Claim subset과 모델 작성 finalAnswer를 세 번째 호출 없이 검증한다', async () => {
  const verifiedReality = { currentWork: { workId: 'work-11111111', revision: 2, status: 'active' },
    sourceManifestId: 'sources-11111111', excludedFindingCount: 1,
    candidate: { human: { purpose: '차이 확인', useContext: '지급 전', audience: '담당자' },
      strategy: { primaryOutcome: '차이만', requestedScope: ['차이'], excludedScope: ['정상'], sufficientWhen: ['근거 완료'] },
      form: { deliverableForms: ['answer'], informationOrder: ['결론', '근거'], visualHierarchyGoals: ['핵심 우선'] } },
    claimEvidence: { claims: [
      { claimId: 'purchase-gap', state: 'supported', summary: '120과 118의 차이 2', sourceRefs: [], calculation: null,
        evidenceValues: [
          { valueId: 'ordered', label: 'ordered', value: 120, unit: '개', source: { location: 'p1' } },
          { valueId: 'accepted', label: 'accepted', value: 118, unit: '개', source: { location: 'F3' } },
          { valueId: 'gap', label: 'gap', value: 2, unit: '개', source: { location: 'H3' } },
          { valueId: 'invoice', label: 'invoice', value: 3000000, unit: 'KRW', source: { location: 'OCR' } },
          { valueId: 'accepted-amount', label: 'accepted amount', value: 2950000, unit: 'KRW', source: { location: 'F3:G3' } },
          { valueId: 'amount-gap', label: 'amount gap', value: 50000, unit: 'KRW', source: { location: 'calc' } },
        ] },
    ] } };
  const closure = makeNx1HumanClosureTool({ verifiedReality, scenarioId: 'purchase_reconciliation' });
  const base = { schema: 't5.human-closure.v1', work: { workId: 'work-11111111', revision: 2 },
    sourceManifestId: 'sources-11111111', selectedClaimIds: ['purchase-gap'],
    finalAnswer: '발주 120개, 입고 118개로 2개 부족하며 3,000,000원과 2,950,000원의 차이는 50,000원입니다.' };
  const result = await closure.tool.execute(base);
  assert.equal(result.state, 'verified'); assert.equal(result.finalAnswer, base.finalAnswer);
  const foreign = structuredClone(base); foreign.selectedClaimIds = ['unknown-claim'];
  assert.equal((await closure.tool.execute(foreign)).reason, 'unknown_or_duplicate_claim');
  const missing = structuredClone(base); missing.finalAnswer = '발주 120개와 입고 118개를 확인했습니다.';
  const rejected = await closure.tool.execute(missing);
  assert.equal(rejected.state, 'closure_failed');
  assert.equal(closure.qualification().rejectedFinalAnswer, missing.finalAnswer);
  const stale = structuredClone(base); stale.work.revision = 3;
  assert.equal((await closure.tool.execute(stale)).reason, 'stale_or_foreign_work');
});

test('Human Closure는 부수 Claim을 선택하지 않을 수 있지만 핵심 답 누락은 qualification에서 실패한다', async () => {
  const verifiedReality = { currentWork: { workId: 'work-11111111', revision: 1, status: 'active' },
    sourceManifestId: 'sources-11111111', excludedFindingCount: 0,
    candidate: { human: {}, strategy: {}, form: {} },
    claimEvidence: { claims: [
      { claimId: 'purchase-gap', state: 'conflict', summary: '수량·금액 차이', sourceRefs: [], evidenceValues: [], calculation: null },
      { claimId: 'supporting-note', state: 'supported', summary: '부수 확인', sourceRefs: [], evidenceValues: [], calculation: null },
    ] } };
  const closure = makeNx1HumanClosureTool({ verifiedReality, scenarioId: 'purchase_reconciliation' });
  const selected = await closure.tool.execute({ schema: 't5.human-closure.v1',
    work: { workId: 'work-11111111', revision: 1 }, sourceManifestId: 'sources-11111111',
    selectedClaimIds: ['purchase-gap'],
    finalAnswer: '발주 120개, 입고 118개로 2개 부족하며 3,000,000원과 2,950,000원의 차이는 50,000원입니다.' });
  assert.equal(selected.state, 'verified');
  assert.deepEqual(selected.claimSelection, { selected: 1, available: 2, allAvailableSelected: false });
  const omitted = await closure.tool.execute({ schema: 't5.human-closure.v1',
    work: { workId: 'work-11111111', revision: 1 }, sourceManifestId: 'sources-11111111',
    selectedClaimIds: ['supporting-note'], finalAnswer: '부수 확인만 했습니다.' });
  assert.equal(omitted.state, 'closure_failed');
});

test('Human Closure Context는 number·literal·calculation만 열고 긴 text atom은 근거로만 보존한다', async () => {
  const verifiedReality = { currentWork: { workId: 'work-11111111', revision: 1, status: 'active' },
    sourceManifestId: 'sources-11111111', excludedFindingCount: 0,
    evidenceAtomKinds: { 'atom-number': 'number', 'atom-number-copy': 'number',
      'atom-literal': 'literal', 'atom-text': 'text' },
    candidate: { human: { purpose: '차이', useContext: '검토', audience: '담당자' },
      strategy: { primaryOutcome: '차이', requestedScope: ['차이'], excludedScope: [], sufficientWhen: ['완료'] },
      form: { deliverableForms: ['answer'], informationOrder: ['결론'], visualHierarchyGoals: ['핵심'] } },
    claimEvidence: { claims: [{ claimId: 'claim-1', state: 'supported', summary: '차이', sourceRefs: [], calculation: null,
      evidenceValues: [
        { valueId: 'atom-number', label: 'amount', value: 42000, unit: 'KRW', source: { location: 'D4' } },
        { valueId: 'atom-number-copy', label: 'same amount', value: 42000, unit: 'KRW', source: { location: 'p1' } },
        { valueId: 'atom-literal', label: 'id', value: 'C-102', unit: '', source: { location: 'A4' } },
        { valueId: 'atom-text', label: 'source sentence', value: 'The invoice total is the evidence amount.', unit: '', source: { location: 'p1' } },
        { valueId: 'calc-gap', label: 'difference', value: 1000, unit: 'KRW', source: { location: 'calc' } },
      ] }] } };
  const context = (await import('./helpers/nx-integral-flagship-qualification.js'))
    .nx1HumanClosureRuntimeContext(verifiedReality);
  assert.doesNotMatch(context, /atom-number|atom-literal|calc-gap|atom-number-copy/u);
  assert.match(context, /42000|C-102|1000/u);
  assert.doesNotMatch(context, /atom-text|invoice total is the evidence amount/iu);
});

test('Human Closure는 내부 Evidence Atom ID를 사용자 답으로 내보내지 않는다', async () => {
  const verifiedReality = { currentWork: { workId: 'work-11111111', revision: 1, status: 'active' },
    sourceManifestId: 'sources-11111111', excludedFindingCount: 0,
    candidate: { human: {}, strategy: {}, form: {} },
    claimEvidence: { claims: [{ claimId: 'purchase-gap', state: 'conflict', summary: '차이',
      sourceRefs: [], evidenceValues: [], calculation: null }] } };
  const closure = makeNx1HumanClosureTool({ verifiedReality, scenarioId: 'purchase_reconciliation' });
  const result = await closure.tool.execute({ schema: 't5.human-closure.v1',
    work: { workId: 'work-11111111', revision: 1 }, sourceManifestId: 'sources-11111111',
    selectedClaimIds: ['purchase-gap'],
    finalAnswer: 'atom-1234567890abcdef1234 기준으로 발주 120개, 입고 118개, 2개 부족이며 3,000,000원과 2,950,000원의 차이는 50,000원입니다.' });
  assert.equal(result.reason, 'final_answer_boundary');
  const alias = await closure.tool.execute({ schema: 't5.human-closure.v1',
    work: { workId: 'work-11111111', revision: 1 }, sourceManifestId: 'sources-11111111',
    selectedClaimIds: ['purchase-gap'],
    finalAnswer: 'atom-0001 기준으로 발주 120개, 입고 118개, 2개 부족이며 차이는 50,000원입니다.' });
  assert.equal(alias.reason, 'final_answer_boundary');
});
