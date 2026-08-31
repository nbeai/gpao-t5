import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidenceUrl = new URL('../evidence/s6-perf5-observation-cache-baseline-2026-08-31.json', import.meta.url);

test('PERF-5 baseline은 text 병렬과 OCR 순차·재실행 현실을 분리한다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(value.status, 'BASELINE_COMPLETE_IMPLEMENTATION_NOT_OPENED');
  assert.equal(value.currentFacts.fileSearchTextObservationConcurrency, 16);
  assert.equal(value.currentFacts.fileSearchOcrExecution, 'sequential');
  assert.equal(value.currentFacts.fileInspectMayRunOcrAgain, true);
  assert.equal(value.currentFacts.localImageOcrCache, false);
  assert.equal(value.productChanges, 0);
});

test('OCR cache는 digest·observer version·삭제 경계와 actual helper 이익 전에는 열리지 않는다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.deepEqual(value.smallestCandidate.requiredKey,
    ['contentSha256', 'observerVersion', 'observationOptions']);
  assert.ok(value.smallestCandidate.requiredClearEvents.includes('forget'));
  assert.ok(value.smallestCandidate.requiredClearEvents.includes('whole_delete'));
  assert.equal(value.smallestCandidate.canonicalTruth, false);
  assert.equal(value.openingEvidenceRequired.baselineNativeHelperCalls, 2);
  assert.equal(value.openingEvidenceRequired.candidateNativeHelperCalls, 1);
});
