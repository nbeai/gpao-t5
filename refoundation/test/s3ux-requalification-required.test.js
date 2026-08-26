import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('S3-UX 과거 PASS는 full-tool provider 통합 P0 때문에 재자격으로 철회된다', async () => {
  const value = JSON.parse(await readFile(new URL('../evidence/s3-ux-requalification-required-2026-08-27.json', import.meta.url)));
  assert.equal(value.status, 'REQUALIFICATION_REQUIRED'); assert.equal(value.releaseBlocker, true);
  assert.equal(value.repair.commit, 'c55eefc0');
  assert.equal(value.requiredBeforeRepass.length, 4);
  assert.ok(value.newFeatureWorkPaused.includes('S3-CH1'));
  assert.ok(value.newFeatureWorkPaused.includes('S3-CA1'));
});
