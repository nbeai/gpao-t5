import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('NX-2는 exact-head 일반 표현 실패를 Integral Method 앞단 Reality 결함으로 고정한다', async () => {
  const evidence = JSON.parse(await read('refoundation/evidence/nx2-generalization-baseline-2026-09-01.json'));
  assert.equal(evidence.sourceCommit, 'ad3e685c1138913b764bd43c6f2611500c49f432');
  assert.equal(evidence.exactHeadResults.sales.purposePass, false);
  assert.equal(evidence.exactHeadResults.receivables.purposePass, false);
  assert.equal(evidence.exactHeadResults.inventory.regressionFromPriorPurposePass, true);
  assert.equal(evidence.exactHeadResults.contracts.toolSequence.includes('file_reality'), true);
  assert.equal(evidence.firstFailureFamily.layer, 'upstream_of_integral_method');
  assert.equal(evidence.productChanges, 0);
});

test('NX-2 첫 후보는 bounded Reality affordance이며 의미 Router나 기본 비용을 추가하지 않는다', async () => {
  const [plan, evidence] = await Promise.all([
    read('T5-NX.md'),
    read('refoundation/evidence/nx2-generalization-baseline-2026-09-01.json').then(JSON.parse),
  ]);
  assert.match(plan, /NX-2 — Mastery Generalization — CURRENT/u);
  assert.match(plan, /NX-2 사용자 완료 문장/u);
  assert.match(plan, /NX-2B — Bounded Reality Scout Qualification — CLOSED_TWO_CANDIDATES_REJECTED/u);
  assert.equal(evidence.nextCandidate.maxCandidates, 5);
  assert.equal(evidence.nextCandidate.modelChoosesMeaning, true);
  assert.equal(evidence.nextCandidate.newModelCall, 0);
  assert.equal(evidence.nextCandidate.newGlobalInstruction, 0);
  assert.equal(evidence.nextCandidate.newDefaultToolSchema, 0);
  assert.equal(evidence.nextCandidate.newStore, 0);
  assert.equal(evidence.nextCandidate.businessRouter, 0);
});

test('NX-2B는 두 metadata 후보 실패 뒤 제품 잔재 없이 구조를 재설계한다', async () => {
  const evidence = JSON.parse(await read('refoundation/evidence/nx2-reality-scout-qualification-2026-09-01.json'));
  assert.equal(evidence.candidate1.decision, 'REJECTED');
  assert.equal(evidence.candidate2.decision, 'REJECTED');
  assert.equal(evidence.candidate2.receivables.purposePass, false);
  assert.equal(evidence.candidate2.inventory.coreRealityPass, true);
  assert.equal(evidence.candidate2.direct.toolCalls, 0);
  assert.equal(evidence.sharedFinding.sameFamilyThirdPatchAllowed, false);
  assert.equal(evidence.removed.productSourceDelta, 0);
  assert.equal(evidence.removed.qualificationHelperRetained, false);
  assert.equal(evidence.nextStructuralCandidate.id, 'model_selected_bounded_batch_observation');
});

test('model-selected batch는 Reality 선택·경제성을 자격하고 Human Closure 미달을 숨기지 않는다', async () => {
  const evidence = JSON.parse(await read('refoundation/evidence/nx2-model-selected-batch-qualification-2026-09-01.json'));
  assert.equal(evidence.deterministicContract.exactSelectedOnlyReopen, 'PASS');
  assert.equal(evidence.providerSchemaDiagnostic.modelCalls, 0);
  assert.equal(evidence.clearOrdinary.selectedNames.length, 1);
  assert.equal(evidence.clearOrdinary.reality.sourceSelection, 'PASS');
  assert.equal(evidence.clearOrdinary.reality.coreResult, 'PASS');
  assert.equal(evidence.clearOrdinary.result, 'PARTIAL_HUMAN_CLOSURE');
  assert.equal(evidence.direct.toolCalls, 0);
  assert.equal(evidence.decision.productActivation, 'NOT_AUTHORIZED');
  assert.equal(evidence.decision.productSourceChanges, 0);
  assert.equal(evidence.next.gate, 'NX2C_SELECTED_REALITY_TO_INTEGRAL_CLOSURE');
});

test('NX2-1C actual trace는 source 전·후 실패를 분리하고 공통 observer delta가 없으면 제품을 열지 않는다', async () => {
  const evidence = JSON.parse(await read('refoundation/evidence/nx2-existing-path-common-observer-trace-2026-09-01.json'));
  assert.equal(evidence.exactOrdinary.sales.failureStage, 'before_source_entry');
  assert.equal(evidence.exactOrdinary.receivables.failureStage, 'before_source_entry');
  assert.equal(evidence.exactOrdinary.inventory.failureStage, 'before_source_entry');
  assert.equal(evidence.exactOrdinary.contractRevision.failureStage, 'after_source_entry_before_bind');
  assert.equal(evidence.expertPositiveControls.receivables.strictPass, true);
  assert.equal(evidence.expertPositiveControls.inventory.strictPass, true);
  assert.equal(evidence.traceFindings.sameMissingObserverFactAcrossTwoPurposes, false);
  assert.equal(evidence.decision.productCandidateOpened, false);
  assert.equal(evidence.decision.productSourceDelta, 0);
  assert.equal(evidence.commonQualification.strictPassCount, 0);
  assert.equal(evidence.commonQualification.nx2_1dOpened, false);
});

test('NX2-1C0은 일반·전문 첫 wire가 사용자 원문 외 동일함을 증명하고 후보 하나만 연다', async () => {
  const evidence = JSON.parse(await read('refoundation/evidence/nx2-first-turn-reality-affordance-audit-2026-09-01.json'));
  assert.equal(evidence.pairs.length, 3);
  assert.equal(evidence.pairs.every((pair) => !pair.ordinarySourceEntered && pair.expertSourceEntered), true);
  assert.equal(Object.values(evidence.pairwiseEquality).every(Boolean), true);
  assert.equal(evidence.decision.branch, 'B_MODEL_PROVIDER_SELECTION_QUALITY');
  assert.equal(evidence.decision.wiringDefectProven, false);
  assert.equal(evidence.decision.allowedCandidateCount, 1);
  assert.equal(evidence.decision.productChangeApplied, false);
  assert.equal(evidence.decision.newSelectionTool, 0);
  assert.equal(evidence.decision.newSelectionModelCall, 0);
  assert.equal(evidence.decision.newRouter, 0);
  assert.equal(evidence.decision.globalPromptDelta, 0);
});

test('단일 목적 중심 Tool 계약 후보가 세 일반 표현을 회복하지 못하면 추가 문구 없이 닫는다', async () => {
  const evidence = JSON.parse(await read('refoundation/evidence/nx2-reality-affordance-contract-candidate-2026-09-01.json'));
  assert.equal(evidence.candidate.newTool, 0);
  assert.equal(evidence.candidate.newModelCall, 0);
  assert.equal(evidence.candidate.globalPromptDelta, 0);
  assert.equal(evidence.samePurpose.sales.candidate.sourceEntered, false);
  assert.equal(evidence.samePurpose.receivables.candidate.sourceEntered, true);
  assert.equal(evidence.samePurpose.receivables.strictScopePass, false);
  assert.equal(evidence.samePurpose.inventory.candidate.sourceEntered, false);
  assert.equal(evidence.gateDecision.candidateAccepted, false);
  assert.equal(evidence.gateDecision.secondWordingPatchAllowed, false);
  assert.equal(evidence.gateDecision.productSourceDelta, 0);
  assert.equal(evidence.nx2State.nx2_1dOpened, false);
  assert.equal(evidence.status, 'CLOSED_WITH_MODEL_PROVIDER_SELECTION_LIMIT');
});
