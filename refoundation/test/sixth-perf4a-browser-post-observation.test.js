import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidenceUrl = new URL('../evidence/s6-perf4a-browser-post-observation-2026-08-31.json', import.meta.url);

test('PERF-4A current Browser after observation은 추가 snapshot 없이 목적 사실을 공급한다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(value.status, 'COMPLETE_NO_PRODUCT_ADOPTION');
  assert.deepEqual(value.results.currentDescription.actions, ['navigate', 'click']);
  assert.equal(value.results.currentDescription.redundantSnapshots, 0);
  assert.equal(value.results.currentDescription.passed, true);
});

test('PERF-4A 추가 설명은 이익 없이 bytes·wall을 늘려 제품에 채택되지 않는다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(value.results.explicitAfterObservationDescription.redundantSnapshots, 0);
  assert.equal(value.results.explicitAfterObservationDescription.requestBytes
    > value.results.currentDescription.requestBytes, true);
  assert.equal(value.results.explicitAfterObservationDescription.wallMs
    > value.results.currentDescription.wallMs, true);
  assert.equal(value.decision.descriptionChange, 'NOT_ADOPTED');
  assert.equal(value.productDefaultChanged, false);
});

test('Browser Runtime은 postcondition·추가 snapshot 필요성·사용자 목적을 판단하지 않는다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.deepEqual(value.forbiddenRuntimeJudgments, [
    'requestedPostconditionObserved', 'additionalSnapshotNeeded', 'userPurposeSatisfied',
  ]);
  assert.equal(value.decision.newResultFields, 'NOT_ADOPTED');
});
