import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { digestAtCommit, evidenceRevisionCommit } from './helpers/git-evidence-digest.js';

const root = new URL('../../', import.meta.url);
const path = 'refoundation/evidence/s3-m2-temporal-memory-2026-08-26.json';
const evidencePath = new URL(path, root);

test('S3-M2 evidence는 deterministic product와 actual two-model Gate를 모두 닫는다', async () => {
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  assert.equal(evidence.status, 'COMPLETE');
  assert.equal(evidence.stage.deterministicProductQualified, true);
  assert.equal(evidence.stage.liveModelQualified, true);
  assert.equal(evidence.stage.completed, true);
  assert.equal(evidence.stage.m3Opened, false);
  assert.equal(evidence.officialReleaseGateChanged, false);
  assert.equal(evidence.productJourneys.liveModels['gpt-5.5'].status, 'PASS_5_OF_5');
  assert.equal(evidence.productJourneys.liveModels['gpt-5.6-terra'].status, 'PASS_5_OF_5');
  assert.equal(evidence.productJourneys.liveModels['gpt-5.5'].toolFailures, 0);
  assert.equal(evidence.productJourneys.liveModels['gpt-5.6-terra'].toolFailures, 0);
  assert.equal(evidence.productJourneys.liveModels.externalWrites, 0);
});

test('S3-M2 A/B는 동일 결과에서 Context·calls 무회귀와 local source cost를 함께 보존한다', async () => {
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  assert.equal(evidence.samePurposeAB.surfaceDigestAgreement, true);
  assert.equal(evidence.samePurposeAB.contextBytesNonRegression, true);
  assert.equal(evidence.samePurposeAB.providerCallsNonRegression, true);
  assert.equal(evidence.samePurposeAB.toolCallsNonRegression, true);
  assert.ok(evidence.samePurposeAB.candidate.localWallDeltaUs >= 0);
  assert.equal(evidence.samePurposeAB.baseline.historicalState, 'not_representable');
  assert.equal(evidence.samePurposeAB.candidate.historicalState, 'historical');
});

test('S3-M2 source·test·deterministic runner와 human-controlled runner digest는 exact하다', async () => {
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  for (const [file, expected] of Object.entries({
    ...evidence.sourceDigests, ...evidence.testDigests,
    'refoundation/scripts/run-s3m2-temporal-memory.mjs':
      evidence.runnerDigests['refoundation/scripts/run-s3m2-temporal-memory.mjs'],
  })) assert.equal(digestAtCommit(evidence.sourceCommit, file), expected, file);
  const evidenceCommit = evidenceRevisionCommit(path);
  const live = 'refoundation/scripts/run-s3m2-live-model-qualification.mjs';
  assert.equal(digestAtCommit(evidenceCommit, live), evidence.runnerDigests[live]);
});
