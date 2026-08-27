import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidence = new URL('../evidence/s3-a-live-observer-pairs-2026-08-27.json', import.meta.url);

test('S3-A actual pair는 두 모델에서 동일 요청·tool surface·effective route와 비오염을 증명한다', async () => {
  const value = JSON.parse(await readFile(evidence, 'utf8'));
  assert.equal(value.models.length, 2);
  assert.deepEqual(value.models.map((item) => item.model), ['gpt-5.6-terra', 'gpt-5.5']);
  for (const item of value.models) {
    assert.equal(item.o0.requestBodyDigest, item.o2.requestBodyDigest);
    assert.equal(item.o0.toolSurfaceDigest, item.o2.toolSurfaceDigest);
    assert.equal(item.o0.observerFieldsInBody, false);
    assert.equal(item.o2.observerFieldsInBody, false);
    assert.equal(item.o0.observerSpanCount, 0);
    assert.ok(item.o2.observerSpanCount > 0);
    assert.equal(item.pairedEffectiveRouteEqual, true);
    assert.equal(item.passed, true);
  }
  assert.equal(value.successfulQualificationProviderRequests, 4);
  assert.equal(value.controls.externalWrites, 0);
  assert.equal(value.passed, true);
});
