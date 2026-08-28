import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('S4-D0 증거는 제품 진실 경계·비용·미채택 workspace fact를 함께 보존한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-d0-terminal-pipeline-truth-2026-08-28.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'PRODUCT_INVARIANT_ADOPTED_WITH_COST_OBSERVATION');
  assert.deepEqual(evidence.gpt55LiveD0.hiddenPipelineFailure.stageExitCodes, [1, 0, 0]);
  assert.equal(evidence.gpt55LiveD0.hiddenPipelineFailure.receiptOutcome, 'failed');
  assert.ok(evidence.gpt55LiveD0.comparisonToUnchangedBaseline.providerTokens > 0);
  assert.equal(evidence.qualificationOnlyWorkspaceFactCombination.gpt55.purposeAchieved, true);
  assert.equal(evidence.qualificationOnlyWorkspaceFactCombination.terra.purposeAchieved, true);
  assert.equal(evidence.qualificationOnlyWorkspaceFactCombination.productAdopted, false);
  assert.equal(evidence.qualificationOnlyWorkspaceFactCombination.sourceRemoved, true);
  assert.equal(evidence.windowsMeaning.currentClaim, 'no Windows pipeline behavior changed');
  assert.equal(evidence.productBoundary.promptChanged, false);
  assert.equal(evidence.productBoundary.newStore, false);
});
