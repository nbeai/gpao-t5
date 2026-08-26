import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('S3-A close는 10개 coverage를 160-cell 없이 S1·S6·S7 causal evidence로 닫는다', async () => {
  const value = JSON.parse(await readFile(new URL('../evidence/s3-a-performance-truth-close-2026-08-27.json', import.meta.url)));
  assert.equal(value.status, 'PASS_WITH_OBSERVATION');
  assert.equal(value.coverageAreas, 10); assert.equal(value.sentinelJourneys, 7);
  assert.equal(value.fullFactorialExecuted, false);
  assert.equal(value.currentMeasurements.S1.passed, true);
  assert.equal(value.currentMeasurements.S6.qualityPasses, '12/12');
  assert.equal(value.currentMeasurements.S7.directionConsistent, false);
  assert.equal(value.currentMeasurements.S7.stalePublicationCommits, 0);
});

test('S3-A close는 unknown과 observer 비용을 숨기지 않고 구조 구현을 승인하지 않는다', async () => {
  const value = JSON.parse(await readFile(new URL('../evidence/s3-a-performance-truth-close-2026-08-27.json', import.meta.url)));
  assert.match(value.phaseTruth.providerQueueNetwork, /unknown/u);
  assert.match(value.phaseTruth.modelGeneration, /unknown/u);
  assert.ok(value.currentMeasurements.S1.O2DeltaMicrosecondsPerJourney > 0);
  assert.equal(value.observerNoninterference.instrumentationInModelContextOrUserSurface, false);
  assert.deepEqual(new Set(Object.values(value.architectureDecision)),
    new Set(['NOT_AUTHORIZED_BY_EVIDENCE', value.architectureDecision.reason]));
  assert.equal(value.productWrites, 0); assert.equal(value.externalWrites, 0);
});
