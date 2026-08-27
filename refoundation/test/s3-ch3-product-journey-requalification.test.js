import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('CH3 제품 여정 재자격은 실제 두 모델·공유 executeTurn·selected reopen·restart fail-closed를 요구한다', async () => {
  const value = JSON.parse(await readFile(new URL('../evidence/s3-ch3-product-journey-requalification-2026-08-27.json', import.meta.url)));
  assert.deepEqual(value.liveModels, ['gpt-5.6-terra', 'gpt-5.5']);
  assert.equal(value.actualProductPath.sharedExecutionKernel, true);
  assert.equal(value.actualProductPath.exactSelectedReopen, true);
  assert.equal(value.actualProductPath.realUserHistoryReads, 0);
  assert.equal(value.independentAudit.p0, 0);
  assert.equal(value.independentAudit.p1, 0);
  assert.equal(value.independentAudit.additionalLiveProviderRequired, false);
  assert.equal(value.restartBoundary.falseSuccess, false);
  assert.equal(value.passed, true);
});
