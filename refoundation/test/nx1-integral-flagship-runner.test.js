import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildNx1ScenarioReality, evaluateNx1Answer, evaluateNx1ClaimEvidence,
  evaluateNx1PresentationCoverage,
  makeNx1IntegralTool, nx1CandidateRuntimeContext,
} from './helpers/nx-integral-flagship-qualification.js';

const root = new URL('../../', import.meta.url);
const oracle = JSON.parse(await readFile(new URL(
  'refoundation/evidence/s6-ng5-dr0-hidden-oracle-2026-08-31.json', root), 'utf8'));
const fixtureRoot = new URL('refoundation/fixtures/s6-ng5-dr0/', root).pathname;

test('NX-1 runner source packet은 exact fixture 1 packet만 포함하고 hidden oracle 답은 투영하지 않는다', async () => {
  const definition = oracle.scenarios[0]; const reality = await buildNx1ScenarioReality({ definition, fixtureRoot });
  assert.equal(reality.records.length, definition.sources.length);
  assert.deepEqual(reality.sourceManifest.inputHandles, reality.records.map((record) => record.handle));
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
    presentationValueIds: ['receipt', 'c101', 'c102-ledger', 'c102-evidence', 'variance', 'c103'] }],
    excludedFindings: [{ findingId: 'expense-control-C104', reason: 'C-104 control 대조 제외' }] };
  assert.equal(evaluateNx1ClaimEvidence('expense_evidence', evidence).passed, true);
  evidence.claims[0].summary += ' C-104도 누락.';
  assert.equal(evaluateNx1ClaimEvidence('expense_evidence', evidence).passed, false);
  const projection = { claims: [{ presentationValues: [{ label: 'missing amount', value: 15500, unit: 'KRW' },
    { label: 'verification-only excluded', value: 3727, unit: 'KRW' }] }] };
  assert.equal(evaluateNx1PresentationCoverage(projection, '누락 금액은 15,500원입니다.').passed, false);
  projection.claims[0].presentationValues.pop();
  assert.equal(evaluateNx1PresentationCoverage(projection, '누락 금액은 15,500원입니다.').passed, true);
});

test('NX-1 live runner는 AB·BA와 product-promotion pending을 명시한다', async () => {
  const source = await readFile(new URL('../scripts/run-nx1-integral-flagship.mjs', import.meta.url), 'utf8');
  assert.match(source, /--order/u); assert.match(source, /\['AB', 'BA'\]/u);
  assert.match(source, /--arms/u);
  assert.match(source, /requiredInitialTool: 'integral_method'/u);
  assert.match(source, /T5 NX VERIFIED CORE CLAIMS/u);
  assert.match(source, /modelProjection/u);
  assert.match(source, /humanBlindEvaluation: 'PENDING'/u);
  assert.match(source, /productPromotion: 'NOT_EVALUATED'/u);
  assert.doesNotMatch(source, /console-server\.js.*writeFile|agent-loop\.js.*writeFile/iu);
});

test('verified model projection은 core claim만 주고 excluded 내용·opaque handle을 최종 답 Context에서 제거한다', () => {
  const reality = { currentWork: { workId: 'work-11111111', revision: 1, status: 'active' },
    sourceManifest: { state: 'verified', manifestId: 'sources-11111111', inputHandles: ['source-11111111', 'source-22222222'] },
    records: [], projections: [] };
  const integral = makeNx1IntegralTool({ reality, scenarioId: 'purchase_reconciliation' });
  assert.equal(integral.modelProjection(), null);
  assert.deepEqual(integral.tool.projectResultForModel(), {
    schema: 't5.nx1.verified-core-claims.v1', state: 'unverified',
  });
  const source = integral.tool.projectResultForModel;
  assert.doesNotMatch(String(source), /excludedFindings.*map|sourceRefs.*handle/su);
});
