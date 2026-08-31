import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

import { inspectBusinessDocument } from '../src/document-data-inspector.js';
import {
  buildIntegralMethodContractBinding, executeIntegralMethodCandidate, validateCompactClaimEvidence,
} from './helpers/nx-integral-method-candidate.js';

const root = new URL('../../', import.meta.url);
const fixtureRoot = new URL('refoundation/fixtures/s6-ng5-dr0/', root);
const oracle = JSON.parse(await readFile(new URL(
  'refoundation/evidence/s6-ng5-dr0-hidden-oracle-2026-08-31.json', root), 'utf8'));
const allSources = oracle.scenarios.flatMap((scenario) => scenario.sources);
const handleFor = new Map(allSources.map((source, index) => [source.path, `source-${String(index + 1).padStart(8, '0')}`]));
const exactInputHandles = allSources.map((source) => handleFor.get(source.path));
const currentWork = { workId: 'work-11111111', revision: 4, status: 'active' };
const sourceManifest = {
  state: 'verified', manifestId: 'sources-11111111', inputHandles: exactInputHandles,
};

function candidate(effect = 'observe') {
  return {
    schema: 't5.integral-outcome-method.v1',
    work: { workId: currentWork.workId, revision: currentWork.revision },
    human: { purpose: '혼합 정산 자료의 실제 차이를 찾는다', useContext: '지급과 계약 확정 전 검토', audience: '운영 책임자' },
    strategy: {
      primaryOutcome: '확인된 차이·누락·중복만 exact source와 함께 전달',
      requestedScope: ['구매 수량·금액 차이', '계약 revision 차이', '비용 증빙 차이'],
      excludedScope: ['정상 대조 행', 'packet 밖 control'],
      sufficientWhen: ['12개 source 전량 관측', '핵심 claim 독립 검산', 'excluded finding 분리'],
    },
    reality: { sourceManifestId: sourceManifest.manifestId, exactInputHandles, unresolvedFacts: [] },
    method: {
      operators: ['select', 'join', 'reconcile', 'calculate', 'validate', 'order'],
      checks: ['source coverage', 'calculation lineage', 'normal and excluded separation'],
      expectedOutputs: [{ name: '통합 정산 결과', kind: effect === 'observe' ? 'answer' : 'xlsx', effect }],
    },
    form: {
      deliverableForms: [effect === 'observe' ? 'answer' : 'xlsx'],
      informationOrder: ['핵심 차이', '가장 큰 원인', '근거', '바로 할 행동'],
      visualHierarchyGoals: ['결론 우선', '숫자와 단위 정렬', '정상·제외 항목 전면화 금지'],
    },
  };
}

function matchingHandle(evidence) {
  for (const source of allSources) if (evidence.includes(basename(source.path))) return handleFor.get(source.path);
  return exactInputHandles[0];
}

function claimEvidence() {
  return {
    schema: 't5.compact-claim-evidence.v1', sourceManifestId: sourceManifest.manifestId,
    coverage: { state: 'complete', observedHandles: [...exactInputHandles], unresolvedHandles: [] },
    claims: oracle.scenarios.flatMap((scenario) => scenario.requiredClaims.map((claim) => {
      const firstEvidence = claim.evidence[0]; const firstHandle = matchingHandle(firstEvidence);
      return { claimId: claim.id, state: 'supported', summary: claim.claim,
      sourceRefs: claim.evidence.map((evidence) => ({ handle: matchingHandle(evidence), location: evidence.slice(0, 200) })),
      evidenceValues: [{ valueId: 'value-1', label: 'presentation fact',
        value: claim.claim.slice(0, 120), unit: 'text',
        source: { handle: firstHandle, location: firstEvidence.slice(0, 200) } },
      { valueId: 'value-2', label: 'verification-only fact', value: 'supporting only', unit: 'text',
        source: { handle: firstHandle, location: firstEvidence.slice(0, 200) } }],
      calculation: claim.id === 'purchase_amount_variance' ? {
        expression: '118 * 25000; 3000000 - 2950000',
        inputs: [
          { label: 'accepted quantity', value: 118, unit: 'units',
            source: { handle: handleFor.get('purchase/receiving-ledger.xlsx'), location: 'Receiving!F3' } },
          { label: 'unit price', value: 25000, unit: 'KRW',
            source: { handle: handleFor.get('purchase/receiving-ledger.xlsx'), location: 'Receiving!G3' } },
          { label: 'invoice amount', value: 3000000, unit: 'KRW',
            source: { handle: handleFor.get('purchase/tax-invoice-IV-991.png'), location: 'OCR:Supply amount' } },
        ], result: { value: 50000, unit: 'KRW' },
      } : null };
    })),
    excludedFindings: [
      { findingId: 'purchase-control-rows', reason: 'packet 밖 control',
        sourceRefs: [{ handle: handleFor.get('purchase/receiving-ledger.xlsx'), location: 'Receiving!H4:H5' }] },
      { findingId: 'contract-normal-customer-signature', reason: '요청한 차이가 아닌 정상 일치',
        sourceRefs: [{ handle: handleFor.get('contract/signature-page-v2.png'), location: 'OCR:Customer signed' }] },
      { findingId: 'expense-control-row-C104', reason: 'Excluded control row',
        sourceRefs: [{ handle: handleFor.get('expense/card-ledger.xlsx'), location: 'Card Ledger!A6:G6' }] },
    ],
  };
}

async function exactObservation(handle) {
  const source = allSources.find((item) => handleFor.get(item.path) === handle);
  const file = new URL(source.path, fixtureRoot); const bytes = await readFile(file);
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest, source.sha256);
  const extension = source.path.split('.').at(-1);
  const observation = ['pdf', 'xlsx'].includes(extension)
    ? await inspectBusinessDocument({ file: file.pathname, maxPages: 20, maxCells: 10_000 })
    : { kind: 'image', metadata: await sharp(bytes).metadata() };
  return { state: 'observed', handle, coverage: 'complete', sourceSha256: digest, observation };
}

function dependencies(overrides = {}) {
  let manifestChecks = 0; const observed = []; let methodRuns = 0; let verifierRuns = 0;
  const state = { observed, get manifestChecks() { return manifestChecks; },
    get methodRuns() { return methodRuns; }, get verifierRuns() { return verifierRuns; } };
  return { state, value: {
    currentWork, sourceManifest,
    verifyCurrentSourceManifest: async () => { manifestChecks += 1; return {
      state: 'verified', manifestId: sourceManifest.manifestId, inputHandles: exactInputHandles,
    }; },
    observeSource: async (handle) => { observed.push(handle); return exactObservation(handle); },
    runMethod: async () => { methodRuns += 1; return { exitCode: 0, selfVerified: true,
      proposedClaimIds: claimEvidence().claims.map((claim) => claim.claimId) }; },
    independentVerify: async ({ candidate: active }) => { verifierRuns += 1; const bound = active.human.purpose === '혼합 정산 자료의 실제 차이를 찾는다'
      && active.human.useContext === '지급과 계약 확정 전 검토' && active.human.audience === '운영 책임자'
      && active.strategy.requestedScope.includes('비용 증빙 차이')
      && active.strategy.excludedScope.includes('정상 대조 행')
      && active.strategy.sufficientWhen.includes('excluded finding 분리')
      && active.form.informationOrder[0] === '핵심 차이'
      && active.form.visualHierarchyGoals.includes('정상·제외 항목 전면화 금지');
      return { schema: 't5.integral-method-verification.v1', passed: bound,
        contractBinding: buildIntegralMethodContractBinding(active), claimEvidence: claimEvidence() }; },
    cleanup: async () => ({ state: 'cleaned' }), ...overrides,
  } };
}

test('NX-1C는 12개 exact source를 현재 observer로 한 번씩 읽고 guest와 독립 verifier를 분리한다', async () => {
  const run = dependencies();
  const result = await executeIntegralMethodCandidate(candidate(), run.value);
  assert.equal(result.state, 'verified');
  assert.equal(result.sourceUniverse.coverage, 'complete');
  assert.deepEqual(run.state.observed, exactInputHandles);
  assert.equal(new Set(run.state.observed).size, 12);
  assert.equal(run.state.methodRuns, 1);
  assert.equal(run.state.verifierRuns, 1);
  assert.equal(run.state.manifestChecks, 2);
  assert.equal(result.claimEvidence.claims.length, 9);
  assert.deepEqual(result.claimEvidence.excludedFindings.map((item) => item.findingId), [
    'purchase-control-rows', 'contract-normal-customer-signature', 'expense-control-row-C104',
  ]);
  assert.deepEqual(result.cleanup, { state: 'cleaned' });
});

test('guest exit 0·selfVerified는 독립 verifier 실패를 성공으로 바꾸거나 발행하지 않는다', async () => {
  let published = 0; const run = dependencies({
    independentVerify: async ({ candidate: active }) => ({ schema: 't5.integral-method-verification.v1',
      passed: false, contractBinding: buildIntegralMethodContractBinding(active) }),
    publishResult: async () => { published += 1; return { state: 'published_verified',
      undoHandle: 'undo-11111111', qualityQualified: true }; },
  });
  const result = await executeIntegralMethodCandidate(candidate('managed_local_artifact'), run.value);
  assert.equal(result.state, 'verification_failed');
  assert.equal(result.publication, 'not_started');
  assert.equal(published, 0);
  assert.equal(run.state.methodRuns, 1);
});

test('ClaimEvidence는 incomplete coverage·foreign source·duplicate claim을 차단한다', () => {
  const incomplete = claimEvidence(); incomplete.coverage.observedHandles.pop();
  assert.throws(() => validateCompactClaimEvidence(incomplete, {
    sourceManifestId: sourceManifest.manifestId, exactInputHandles,
  }), /coverage is incomplete/u);
  const foreign = claimEvidence(); foreign.claims[0].sourceRefs[0].handle = 'source-99999999';
  assert.throws(() => validateCompactClaimEvidence(foreign, {
    sourceManifestId: sourceManifest.manifestId, exactInputHandles,
  }), /escapes/u);
  const duplicate = claimEvidence(); duplicate.claims.push(structuredClone(duplicate.claims[0]));
  assert.throws(() => validateCompactClaimEvidence(duplicate, {
    sourceManifestId: sourceManifest.manifestId, exactInputHandles,
  }), /duplicated/u);
  const missingValue = claimEvidence(); missingValue.claims[0].evidenceValues = [];
  assert.throws(() => validateCompactClaimEvidence(missingValue, {
    sourceManifestId: sourceManifest.manifestId, exactInputHandles,
  }), /evidence values are invalid/u);
  const omittedFromSummary = claimEvidence(); omittedFromSummary.claims[0].evidenceValues[0].value = 'not in summary';
  assert.doesNotThrow(() => validateCompactClaimEvidence(omittedFromSummary, {
    sourceManifestId: sourceManifest.manifestId, exactInputHandles,
  }));
  const unitless = claimEvidence(); unitless.claims[0].evidenceValues[1].unit = '';
  assert.doesNotThrow(() => validateCompactClaimEvidence(unitless, {
    sourceManifestId: sourceManifest.manifestId, exactInputHandles,
  }));
});

test('source revision이 실행 뒤 바뀌면 publication 전에 닫힌다', async () => {
  let checks = 0; let published = 0; const run = dependencies({
    verifyCurrentSourceManifest: async () => {
      checks += 1; return checks === 1 ? { state: 'verified', manifestId: sourceManifest.manifestId,
        inputHandles: exactInputHandles } : { state: 'changed', manifestId: sourceManifest.manifestId,
        inputHandles: exactInputHandles };
    },
    publishResult: async ({ contractBinding }) => { published += 1; return { state: 'published_verified',
      undoHandle: 'undo-11111111', qualityQualified: true, contractBinding }; },
  });
  await assert.rejects(executeIntegralMethodCandidate(candidate('managed_local_artifact'), run.value),
    /source manifest verification failed/u);
  assert.equal(published, 0);
});

test('publication 성공 뒤 cleanup 실패는 재발행하지 않고 Undo를 보존한다', async () => {
  let published = 0; let purpose = null; const run = dependencies({
    publishResult: async ({ contractBinding, artifactPurpose }) => { published += 1; purpose = artifactPurpose; return {
      state: 'published_verified', undoHandle: 'undo-11111111', artifactHandle: 'artifact-11111111',
      qualityQualified: true, contractBinding,
    }; },
    cleanup: async () => { throw new Error('simulated cleanup failure'); },
  });
  const result = await executeIntegralMethodCandidate(candidate('managed_local_artifact'), run.value);
  assert.equal(result.state, 'published_verified_cleanup_unknown');
  assert.equal(result.publication.undoHandle, 'undo-11111111');
  assert.equal(published, 1);
  assert.deepEqual(purpose, { audience: '운영 책임자', usePurpose: '지급과 계약 확정 전 검토',
    deliveryMedium: ['xlsx'], visualHierarchyGoals: ['결론 우선', '숫자와 단위 정렬', '정상·제외 항목 전면화 금지'] });
  assert.deepEqual(result.cleanup, { state: 'unknown' });
});

test('human·strategy·form 축을 바꾸거나 무시하면 hidden evaluator가 실제 verification을 실패시킨다', async () => {
  for (const mutate of [
    (value) => { value.human.audience = '미지정'; },
    (value) => { value.strategy.excludedScope = ['아무것도 제외하지 않음']; },
    (value) => { value.strategy.sufficientWhen = ['모델이 충분하다고 느낌']; },
    (value) => { value.form.informationOrder = ['근거', '핵심 차이', '바로 할 행동']; },
    (value) => { value.form.visualHierarchyGoals = ['장식적 강조']; },
  ]) {
    const changed = candidate(); mutate(changed); const run = dependencies();
    const result = await executeIntegralMethodCandidate(changed, run.value);
    assert.equal(result.state, 'verification_failed');
  }
});

test('Stop이 verification과 publication 사이에 오면 발행 0·cleanup exact 1이다', async () => {
  const controller = new AbortController(); let published = 0; let cleaned = 0;
  const run = dependencies({
    signal: controller.signal,
    independentVerify: async ({ candidate: active }) => { controller.abort(); return {
      schema: 't5.integral-method-verification.v1', passed: true,
      contractBinding: buildIntegralMethodContractBinding(active), claimEvidence: claimEvidence(),
    }; },
    publishResult: async ({ contractBinding }) => { published += 1; return { state: 'published_verified',
      undoHandle: 'undo-11111111', qualityQualified: true, contractBinding }; },
    cleanup: async () => { cleaned += 1; return { state: 'cleaned' }; },
  });
  const result = await executeIntegralMethodCandidate(candidate('managed_local_artifact'), run.value);
  assert.deepEqual(result, { state: 'cancelled', publication: 'not_started' });
  assert.equal(published, 0);
  assert.equal(cleaned, 1);
});
