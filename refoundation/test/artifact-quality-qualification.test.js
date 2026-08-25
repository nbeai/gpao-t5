import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createArtifactPurposeContract,
  makeArtifactQualityQualifier,
} from '../src/artifact-quality-qualification.js';

const COUNTERFACTUAL = JSON.parse(await readFile(
  new URL('../config/qh2-artifact-quality-counterfactual.json', import.meta.url), 'utf8',
));
const SHA = COUNTERFACTUAL.artifactSha256;
const OBSERVATION_SCHEMA = 't5.artifact-quality-observation.v1';
const TRUSTED_PRODUCERS = [
  { kind: 'semantic_verifier', identity: 'qh2-semantic-runtime' },
  { kind: 'domain_verifier', identity: 'qh2-domain-runtime' },
  { kind: 'structural_verifier', identity: 'qh2-structural-runtime' },
  { kind: 'render_verifier', identity: 'qh2-render-runtime' },
];
const runtimeQualifier = makeArtifactQualityQualifier({ trustedProducers: TRUSTED_PRODUCERS });

function reconciliationContract() {
  return createArtifactPurposeContract({
    contractId: 'settlement-quality-v1',
    artifact: { artifactId: 'settlement.xlsx', kind: 'xlsx', sha256: SHA },
    audience: '정산 담당자와 사업주',
    domain: 'customer_settlement',
    usePurpose: '지급 전 합계와 미확인 항목을 검토하고 원본까지 감사한다',
    deliveryMedium: 'both',
    sourceFacts: [
      { factId: 'row-1-customer', sourceRef: 'source-a.xlsx#row=2', resolution: 'resolved', preserveOriginal: true },
      { factId: 'row-5-customer', sourceRef: 'source-c.xlsx#row=3', resolution: 'unresolved', preserveOriginal: true },
    ],
    calculations: [{ calculationId: 'grand-total', sourceFactIds: ['row-1-customer', 'row-5-customer'] }],
    requiredArtifactForms: ['summary_sheet', 'detail_sheet'],
    visualHierarchyGoals: ['총액과 미확인 금액을 첫 화면에서 구분한다'],
    domainProfile: {
      profileId: 'settlement-audit', version: '1',
      invariantRefs: ['original-customer-retained', 'source-row-traceable', 'totals-reconciled'],
    },
    laneRequirements: {
      semantic: [{
        requirementId: 'semantic-source-truth', kind: 'semantic_reconciliation',
        expected: {
          satisfiedFactIds: ['row-1-customer'], unchangedSourceFactIds: ['row-1-customer', 'row-5-customer'],
          preservedUnresolvedFactIds: ['row-5-customer'],
        },
      }],
      domain: [{
        requirementId: 'domain-audit-trace', kind: 'domain_traceability',
        invariantRefs: ['original-customer-retained', 'source-row-traceable', 'totals-reconciled'],
        expected: {
          sourceFactIds: ['row-1-customer', 'row-5-customer'], reversibleSourceFactIds: ['row-1-customer'],
          calculationIds: ['grand-total'],
        },
      }],
      structural: [{
        requirementId: 'xlsx-reopen-and-errors', kind: 'structural_scan',
        expected: { reopenedArtifactSha256: SHA, maximumFormulaErrors: 0, maximumSchemaErrors: 0 },
      }, {
        requirementId: 'xlsx-required-forms', kind: 'artifact_forms',
        expected: { formIds: ['summary_sheet', 'detail_sheet'] },
      }],
      screen: [
        { requirementId: 'screen-all-sheets', kind: 'render_coverage', expected: { surface: 'screen', unitIds: ['요약', '상세'] } },
        { requirementId: 'screen-readable', kind: 'visual_integrity', expected: { surface: 'screen', unitIds: ['요약', '상세'], disallowedDefects: ['clipping', 'glyph_loss', 'overlap'] } },
        { requirementId: 'screen-hierarchy', kind: 'visual_hierarchy', expected: { surface: 'screen', unitIds: ['요약', '상세'], goalIds: ['총액과 미확인 금액을 첫 화면에서 구분한다'] } },
      ],
      print: [
        {
          requirementId: 'print-page-setup', kind: 'openxml_page_setup', expected: {
            sheets: [{ sheetId: '상세', paperSize: 'A4', orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: 'A1:H6' }],
          },
        },
        { requirementId: 'print-all-pages', kind: 'render_coverage', expected: { surface: 'print', unitIds: ['상세:p1'] } },
        { requirementId: 'print-readable', kind: 'visual_integrity', expected: { surface: 'print', unitIds: ['상세:p1'], disallowedDefects: ['clipping', 'glyph_loss', 'overlap', 'horizontal_split'] } },
        { requirementId: 'print-hierarchy', kind: 'visual_hierarchy', expected: { surface: 'print', unitIds: ['상세:p1'], goalIds: ['총액과 미확인 금액을 첫 화면에서 구분한다'] } },
      ],
    },
  });
}

function passingObservations() {
  return [
    {
      observationId: 'semantic-1', requirementId: 'semantic-source-truth', kind: 'semantic_reconciliation', artifactSha256: SHA,
      facts: { satisfiedFactIds: ['row-1-customer'], unchangedSourceFactIds: ['row-1-customer', 'row-5-customer'], preservedUnresolvedFactIds: ['row-5-customer'] },
    },
    {
      observationId: 'domain-1', requirementId: 'domain-audit-trace', kind: 'domain_traceability', artifactSha256: SHA,
      facts: {
        traces: [
          { sourceFactId: 'row-1-customer', sourceRef: 'source-a.xlsx#row=2', originalValuePresent: true, reversible: true },
          { sourceFactId: 'row-5-customer', sourceRef: 'source-c.xlsx#row=3', originalValuePresent: true, reversible: false },
        ],
        calculationIds: ['grand-total'],
      },
    },
    { observationId: 'structure-1', requirementId: 'xlsx-reopen-and-errors', kind: 'structural_scan', artifactSha256: SHA, facts: { reopenedArtifactSha256: SHA, formulaErrors: 0, schemaErrors: 0 } },
    { observationId: 'forms-1', requirementId: 'xlsx-required-forms', kind: 'artifact_forms', artifactSha256: SHA, facts: { observedFormIds: ['summary_sheet', 'detail_sheet'] } },
    { observationId: 'screen-render', requirementId: 'screen-all-sheets', kind: 'render_coverage', artifactSha256: SHA, facts: { surface: 'screen', observedUnitIds: ['요약', '상세'] } },
    { observationId: 'screen-visual', requirementId: 'screen-readable', kind: 'visual_integrity', artifactSha256: SHA, facts: { surface: 'screen', observedUnitIds: ['요약', '상세'], defects: [] } },
    { observationId: 'screen-hierarchy-1', requirementId: 'screen-hierarchy', kind: 'visual_hierarchy', artifactSha256: SHA, facts: { surface: 'screen', observedUnitIds: ['요약', '상세'], achievedGoalIds: ['총액과 미확인 금액을 첫 화면에서 구분한다'] } },
    {
      observationId: 'print-setup', requirementId: 'print-page-setup', kind: 'openxml_page_setup', artifactSha256: SHA,
      facts: { sheets: [{ sheetId: '상세', paperSize: 'A4', orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: 'A1:H6' }] },
    },
    { observationId: 'print-render', requirementId: 'print-all-pages', kind: 'render_coverage', artifactSha256: SHA, facts: { surface: 'print', observedUnitIds: ['상세:p1'] } },
    { observationId: 'print-visual', requirementId: 'print-readable', kind: 'visual_integrity', artifactSha256: SHA, facts: { surface: 'print', observedUnitIds: ['상세:p1'], defects: [] } },
    { observationId: 'print-hierarchy-1', requirementId: 'print-hierarchy', kind: 'visual_hierarchy', artifactSha256: SHA, facts: { surface: 'print', observedUnitIds: ['상세:p1'], achievedGoalIds: ['총액과 미확인 금액을 첫 화면에서 구분한다'] } },
  ].map((observation) => {
    const producerKind = observation.kind === 'semantic_reconciliation' ? 'semantic_verifier'
      : observation.kind === 'domain_traceability' ? 'domain_verifier'
        : ['structural_scan', 'artifact_forms', 'openxml_page_setup'].includes(observation.kind) ? 'structural_verifier'
          : 'render_verifier';
    return {
      ...observation,
      schema: OBSERVATION_SCHEMA,
      contractId: 'settlement-quality-v1',
      state: 'observed',
      producer: TRUSTED_PRODUCERS.find((item) => item.kind === producerKind),
    };
  });
}

function qualify(input = {}) {
  return runtimeQualifier({ contract: reconciliationContract(), ...input });
}

test('QualityReceipt는 Semantic·Domain·Structural·Screen·Print를 독립 논리곱으로 자격한다', () => {
  const receipt = qualify({ observations: passingObservations() });
  assert.equal(receipt.qualified, true);
  assert.deepEqual(Object.fromEntries(Object.entries(receipt.lanes).map(([lane, value]) => [lane, value.status])), {
    semantic: 'qualified', domain: 'qualified', structural: 'qualified', screen: 'qualified', print: 'qualified',
  });
  assert.equal('score' in receipt, false);
});

test('값과 화면이 맞아도 원문 고객 추적이 빠지고 인쇄 표가 가로 분할되면 완료가 아니다', () => {
  const observations = passingObservations().filter((item) => !COUNTERFACTUAL.knownFailure.removeObservationIds.includes(item.observationId));
  const defect = COUNTERFACTUAL.knownFailure.appendDefect;
  observations.find((item) => item.observationId === defect.observationId).facts.defects.push({ unitId: defect.unitId, type: defect.type });
  const receipt = qualify({ observations });
  assert.equal(receipt.qualified, COUNTERFACTUAL.expected.qualified);
  assert.deepEqual(Object.fromEntries(Object.entries(receipt.lanes).map(([lane, value]) => [lane, value.status])), COUNTERFACTUAL.expected.laneStatuses);
  assert.deepEqual(receipt.lanes.print.failedRequirementIds, ['print-readable']);
});

test('화면 렌더는 인쇄 렌더나 OpenXML page setup을 대신하지 못한다', () => {
  const observations = passingObservations().filter((item) => !['print-page-setup', 'print-all-pages'].includes(item.requirementId));
  const receipt = qualify({ observations });
  assert.equal(receipt.lanes.screen.status, 'qualified');
  assert.equal(receipt.lanes.print.status, 'unmeasured');
  assert.deepEqual(receipt.lanes.print.missingRequirementIds, ['print-page-setup', 'print-all-pages']);
  assert.equal(receipt.qualified, false);
});

test('contract는 전달 매체에 필요한 render 관측과 domain invariant reference를 생략하지 못한다', () => {
  const base = structuredClone(reconciliationContract());
  base.laneRequirements.print = base.laneRequirements.print.filter((item) => item.kind !== 'render_coverage');
  assert.throws(() => createArtifactPurposeContract(base), /print render_coverage/u);

  const missingInvariant = structuredClone(reconciliationContract());
  missingInvariant.laneRequirements.domain[0].invariantRefs = ['not-in-profile'];
  assert.throws(() => createArtifactPurposeContract(missingInvariant), /domain invariant reference/u);
});

test('screen-only 결과도 다섯 lane을 보존하되 Print를 qualified로 꾸미지 않는다', () => {
  const input = structuredClone(reconciliationContract());
  input.contractId = 'screen-report-v1'; input.deliveryMedium = 'screen'; input.laneRequirements.print = [];
  const contract = createArtifactPurposeContract(input);
  const observations = passingObservations().filter((item) => !item.requirementId.startsWith('print-'))
    .map((item) => ({ ...item, contractId: contract.contractId }));
  const receipt = runtimeQualifier({ contract, observations });
  assert.equal(receipt.qualified, true);
  assert.equal(receipt.lanes.print.status, 'not_applicable');
  assert.equal(receipt.lanes.print.required, false);
});

test('requiredArtifactForms와 visualHierarchyGoals는 관측되지 않으면 완료가 아니다', () => {
  const observations = passingObservations().filter((item) => !['xlsx-required-forms', 'screen-hierarchy'].includes(item.requirementId));
  const receipt = qualify({ observations });
  assert.equal(receipt.qualified, false);
  assert.deepEqual(receipt.lanes.structural.missingRequirementIds, ['xlsx-required-forms']);
  assert.deepEqual(receipt.lanes.screen.missingRequirementIds, ['screen-hierarchy']);

  const unbound = structuredClone(reconciliationContract());
  unbound.laneRequirements.structural.find((item) => item.kind === 'artifact_forms').expected.formIds = ['summary_sheet'];
  assert.throws(() => createArtifactPurposeContract(unbound), /exactly bind requiredArtifactForms/u);
});

test('임의 facts와 self-declared producer는 lane을 통과하지 못한다', () => {
  const observations = passingObservations();
  const semantic = observations.find((item) => item.requirementId === 'semantic-source-truth');
  semantic.facts = { arbitrary: ['row-1-customer', 'row-5-customer'] };
  const untrusted = observations.find((item) => item.requirementId === 'screen-all-sheets');
  untrusted.producer = { kind: 'render_verifier', identity: 'self-declared-fixture' };
  const receipt = qualify({
    observations,
    trustedProducers: [{ kind: 'render_verifier', identity: 'self-declared-fixture' }],
  });
  assert.equal(receipt.lanes.semantic.status, 'failed');
  assert.equal(receipt.lanes.screen.status, 'failed');
  assert.equal(receipt.lanes.semantic.requirements[0].reason, 'malformed_observation');
});

test('malformed observedUnitIds와 defect object는 throw 대신 해당 requirement를 failed로 닫는다', () => {
  const observations = passingObservations();
  observations.find((item) => item.requirementId === 'screen-all-sheets').facts.observedUnitIds = '요약,상세';
  observations.find((item) => item.requirementId === 'print-readable').facts.defects = ['horizontal_split'];
  const receipt = qualify({ observations });
  assert.equal(receipt.qualified, false);
  assert.deepEqual(receipt.lanes.screen.failedRequirementIds, ['screen-all-sheets']);
  assert.deepEqual(receipt.lanes.print.failedRequirementIds, ['print-readable']);
  assert.equal(receipt.lanes.screen.requirements[0].reason, 'malformed_observation');
});

test('page setup 구조와 schema·contract·artifact receipt 결속이 잘못되면 해당 requirement가 실패한다', () => {
  const observations = passingObservations();
  const setup = observations.find((item) => item.requirementId === 'print-page-setup');
  setup.facts.sheets[0].fitToWidth = '1';
  const semantic = observations.find((item) => item.requirementId === 'semantic-source-truth');
  semantic.contractId = 'another-contract';
  const domain = observations.find((item) => item.requirementId === 'domain-audit-trace');
  domain.artifactSha256 = 'f'.repeat(64);
  const hierarchy = observations.find((item) => item.requirementId === 'screen-hierarchy');
  hierarchy.schema = 't5.untrusted-observation.v1';
  const receipt = qualify({ observations });
  assert.equal(receipt.lanes.semantic.status, 'failed');
  assert.equal(receipt.lanes.domain.status, 'failed');
  assert.ok(receipt.lanes.screen.failedRequirementIds.includes('screen-hierarchy'));
  assert.ok(receipt.lanes.print.failedRequirementIds.includes('print-page-setup'));
});
