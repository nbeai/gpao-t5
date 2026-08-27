import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S3-WA close는 세 post-fix lane P0/P1 0·전체 회귀·불리한 Windows 관측을 함께 보존한다', async () => {
  const value = JSON.parse(await readFile(new URL('../evidence/s3-wa-whole-product-wiring-close-2026-08-27.json', import.meta.url)));
  for (const lane of Object.values(value.lanes)) {
    assert.equal(lane.postFixP0, 0); assert.equal(lane.postFixP1, 0);
  }
  assert.equal(value.wholeProductRegression.integration.failed, 0);
  assert.equal(value.wholeProductRegression.mutation.survived, 0);
  assert.equal(value.wholeProductRegression.liveProviderSmoke.passed, true);
  assert.equal(value.wholeProductRegression.legacyImports, 0);
  assert.ok(value.observations.some((item) => /physical Windows/u.test(item)));
  assert.ok(value.observations.some((item) => /not claim.*built, notarized, installed, or released/iu.test(item)));
  assert.equal(value.passed, true);
});
