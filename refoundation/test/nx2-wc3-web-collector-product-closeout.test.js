import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const evidence = JSON.parse(readFileSync(new URL('../evidence/nx2-wc3-web-collector-product-2026-09-01.json', import.meta.url), 'utf8'));

test('WC-3 제품 후보는 정확성을 지키며 Web 실행 ownership·wall·rounds·tokens를 개선한다', () => {
  assert.equal(evidence.status, 'WC3_COMPLETE_WC4_OPEN');
  assert.equal(evidence.samePurposeComparison.candidate.rows, 60);
  assert.equal(evidence.samePurposeComparison.candidate.missing, 0);
  assert.equal(evidence.samePurposeComparison.candidate.duplicates, 0);
  assert.equal(evidence.samePurposeComparison.candidate.terminalNetworkCalls, 0);
  assert.equal(evidence.samePurposeComparison.candidate.networkOwnership, 'complete');
  assert.ok(evidence.samePurposeComparison.improvement.wallPercent > 70);
  assert.ok(evidence.samePurposeComparison.improvement.inputTokensPercent > 80);
  assert.equal(evidence.samePurposeComparison.accuracyRegression, false);
});

test('WC-3는 새 crawler·Browser·package나 Windows 물리 PASS를 만들지 않는다', () => {
  assert.equal(evidence.newCrawlerAgent, 0); assert.equal(evidence.newBrowserRuntime, 0);
  assert.equal(evidence.runtimePackageInstall, 0); assert.equal(evidence.upstreamImport, 0);
  assert.equal(evidence.platform.windowsPhysical, 'DEFERRED_BY_OWNER');
  assert.equal(evidence.productContract.artifactReceiptAfterRestart, 'generated_output');
  assert.equal(evidence.remainingObservation.dynamicRenderedCollection, 'not_yet_qualified');
});
