import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { digestAtCommit } from './helpers/git-evidence-digest.js';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/s3-m5-living-library-complete-2026-08-27.json', import.meta.url,
), 'utf8'));

test('M5 evidence는 구현 완료와 Windows actual 유예를 다른 사실로 보존한다', () => {
  assert.equal(evidence.status, 'IMPLEMENTATION_COMPLETE_WINDOWS_ACTUAL_DEFERRED');
  assert.equal(evidence.stageState.m5ImplementationClosed, true);
  assert.equal(evidence.stageState.m5WindowsActualPassed, false);
  assert.equal(evidence.stageState.m6PlatformNeutralImplementationMayOpen, true);
  assert.equal(evidence.windows.deferredNotWaived, true);
  assert.equal(evidence.windows.requiredItems, 25);
  assert.equal(evidence.officialReleaseGateChanged, false);
});

test('M5 evidence는 stale correction·forget purge·ID 비노출을 논리곱으로 닫는다', () => {
  assert.equal(evidence.cascadeTruth.correctionOldGenerationHttpState, '410_stale');
  assert.equal(evidence.cascadeTruth.rebuildPurgesStaleGeneration, true);
  assert.equal(evidence.cascadeTruth.forgetReceiptLibraryViewExecuted, true);
  assert.equal(evidence.cascadeTruth.forgetProbeAfter, 0);
  assert.equal(evidence.cascadeTruth.forgottenValueOnMemorySurface, false);
  assert.equal(evidence.cascadeTruth.forgottenValueInGeneratedView, false);
  assert.equal(evidence.views.rawInternalIdsRendered, 0);
  assert.equal(evidence.views.researchStringInference, false);
});

test('M5 evidence는 제품 비개입과 qualification 비용을 분리한다', () => {
  assert.equal(evidence.samePurposeNonInterference.semanticModelInputEqual, true);
  assert.equal(evidence.samePurposeNonInterference.replyEqual, true);
  assert.equal(evidence.samePurposeNonInterference.canonicalMemoryEventsEqual, true);
  assert.equal(evidence.samePurposeNonInterference.productHotPathLibraryCalls, 0);
  assert.equal(evidence.qualificationCost.modelCalls, 0);
  assert.equal(evidence.qualificationCost.providerRequests, 0);
  assert.ok(Number(evidence.qualificationCost.generationNs) > 0);
});

test('M5 evidence source digest는 exact implementation head와 일치한다', () => {
  assert.equal(evidence.sourceCommit, '96ca7bb5f4a7cacae1fae91bfdf2378293a0fd43');
  for (const [path, expected] of Object.entries(evidence.sourceDigests)) {
    assert.equal(digestAtCommit(evidence.sourceCommit, path), expected, path);
  }
});
