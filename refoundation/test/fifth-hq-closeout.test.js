import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/fifth-hq-console-closeout-2026-08-30.json', import.meta.url), 'utf8'));

test('5차 HQ는 실제 Console 여덟 여정·최초 실패 수리·전체 회귀를 함께 닫는다', () => {
  assert.equal(evidence.status, 'PASS_MACOS_PRODUCT_SCOPE');
  assert.deepEqual(evidence.journeys.map((journey) => journey.id), [
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8',
  ]);
  assert.ok(evidence.journeys.every((journey) => journey.status.startsWith('PASS')));
  assert.equal(evidence.firstFailuresAndRepairs.length, 5);
  assert.equal(evidence.finalRegression.unit.failed, 0);
  assert.equal(evidence.finalRegression.productIntegration.failed, 0);
  assert.equal(evidence.finalRegression.mutation.survived, 0);
  assert.equal(evidence.windows, 'DEFERRED_NOT_WAIVED');
  assert.equal(Object.values(evidence.forbiddenSystems).every((count) => count === 0), true);
  assert.equal(evidence.performanceTruth.artifactRevisionStillHeavy, true);
});
