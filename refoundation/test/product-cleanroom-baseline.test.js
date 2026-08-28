import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Product Cleanroom baseline은 현재 행동 보존과 분류 경계를 고정한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/product-cleanroom-baseline-2026-08-28.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'PRE_CLEAN_BASELINE_VERIFIED');
  assert.equal(evidence.productVersion, '0.3.1');
  assert.equal(evidence.sourceCommit, 'f74711de56f8f4e36975fc893a806cca615444a9');
  assert.equal(evidence.annotatedTag, 't5-0.3.1-pre-clean-baseline');
  assert.equal(evidence.sourceScope.productInputsClean, true);
  assert.equal(evidence.verification.productIntegration.failed, 0);
  assert.equal(evidence.verification.mutation.survived, 0);
  assert.deepEqual(evidence.classification, [
    'ACTIVE_PRODUCT', 'PLATFORM_REQUIRED', 'QUALIFICATION_ONLY',
    'FOURTH_CYCLE_DORMANT', 'HISTORICAL_READ_ONLY', 'HISTORICAL_DEAD', 'UNKNOWN',
  ]);
  assert.ok(evidence.nonGoals.includes('Prompt changes'));
  assert.ok(evidence.nonGoals.includes('new product feature'));
});

test('Product Cleanroom closeout은 제거량·보존선·전체 회귀를 함께 고정한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/product-cleanroom-closeout-2026-08-28.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'PRODUCT_CLEANROOM_COMPLETE');
  assert.equal(evidence.implementationHead, 'fd58c2dad83fcf230bf2c23bfabb367b562d98ab');
  assert.equal(evidence.cleanBaselineTag, 't5-0.3.1-clean-baseline');
  assert.deepEqual(evidence.sourceReduction, { consoleServerLines: -18, uiIndexLines: -414 });
  assert.equal(evidence.packageBoundary.totalExcludedFiles, 47);
  assert.equal(evidence.verification.fullProductCi, 'passed');
  assert.equal(evidence.verification.productIntegration.failed, 0);
  assert.equal(evidence.verification.mutation.survived, 0);
  assert.equal(evidence.preserved.promptUnchanged, true);
  assert.equal(evidence.preserved.currentUserBehavior, true);
  assert.ok(evidence.unresolved.some((item) => item.includes('/search')));
});
