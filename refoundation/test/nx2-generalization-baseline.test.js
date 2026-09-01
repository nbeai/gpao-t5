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
