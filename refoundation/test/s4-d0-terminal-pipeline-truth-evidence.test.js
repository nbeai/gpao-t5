import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('S4-D0 증거는 stage 사실과 폐기한 Runtime 의미 승격을 분리한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-d0-terminal-pipeline-truth-2026-08-28.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'PRODUCT_FACT_ONLY_INVARIANT_CORRECTED');
  assert.deepEqual(evidence.gpt55LiveD0.historicalSemanticPromotionRun.stageExitCodes, [1, 0, 0]);
  assert.equal(evidence.gpt55LiveD0.historicalSemanticPromotionRun.receiptOutcomeAt1607c69e, 'failed');
  assert.equal(evidence.supersededSemanticPromotion.removed, true);
  assert.equal(evidence.supersededSemanticPromotion.counterexamples.length, 2);
  assert.equal(evidence.productBoundary.outcomeRule,
    'preserve the shell overall result; the model interprets command-specific stage exit meaning');
  assert.deepEqual(evidence.productBoundary.factsRecorded, ['stage exit codes', 'overall exit code']);
  assert.ok(evidence.gpt55LiveD0.comparisonToUnchangedBaseline.providerTokens > 0);
  assert.equal(evidence.qualificationOnlyWorkspaceFactCombination.gpt55.purposeAchieved, true);
  assert.equal(evidence.qualificationOnlyWorkspaceFactCombination.terra.purposeAchieved, true);
  assert.equal(evidence.qualificationOnlyWorkspaceFactCombination.productAdopted, false);
  assert.equal(evidence.qualificationOnlyWorkspaceFactCombination.sourceRemoved, true);
  assert.equal(evidence.windowsMeaning.currentClaim, 'no Windows pipeline behavior changed');
  assert.equal(evidence.productBoundary.promptChanged, false);
  assert.equal(evidence.productBoundary.newStore, false);
});
