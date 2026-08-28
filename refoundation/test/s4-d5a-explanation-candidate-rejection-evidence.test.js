import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-D5A 증거는 in-process 후보 폐기와 one-shot 격리의 비용을 함께 보존한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-d5a-explanation-candidate-rejection-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'IN_PROCESS_CANDIDATES_REJECTED_ISOLATION_QUALIFICATION_OPEN');
  assert.equal(evidence.productChanges, 0);
  assert.ok(evidence.rejected.length >= 8);
  assert.ok(evidence.positiveControl.mainRuntimeMedianPeakRssDelta < evidence.redBoundaryBytes);
  assert.ok(evidence.positiveControl.addedMedianWallMs > 100);
  assert.equal(evidence.positiveControl.productAdopted, false);
  assert.equal(evidence.interpretation.isolationDirectionSupported, true);
  assert.equal(evidence.interpretation.oneShotEconomicsPassed, false);
  assert.ok(evidence.nonClaims.includes('RSS is repaired in the product'));
});
