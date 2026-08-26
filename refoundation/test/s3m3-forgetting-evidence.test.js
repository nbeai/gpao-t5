import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { digestAtCommit, evidenceRevisionCommit } from './helpers/git-evidence-digest.js';

const root = new URL('../../', import.meta.url);
const path = 'refoundation/evidence/s3-m3-forgetting-2026-08-26.json';
const evidencePath = new URL(path, root);

test('S3-M3 evidence는 deterministic forgetting과 미실행 actual model Gate를 분리한다', async () => {
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  assert.equal(evidence.status, 'PASS_WITH_LIVE_MODEL_OBSERVATION_REQUIRED');
  assert.equal(evidence.stage.deterministicProductQualified, true);
  assert.equal(evidence.stage.liveModelQualified, false);
  assert.equal(evidence.stage.completed, false);
  assert.equal(evidence.stage.m4Opened, false);
  assert.equal(evidence.contracts.unrelatedRecordLoss, 0);
  assert.equal(evidence.productJourneys.forgetReceipt.exactRecallAfter, 0);
  assert.equal(evidence.productJourneys.forgetReceipt.contextProjectionAfter, 0);
});

test('S3-M3 A/B는 추가 비용과 추가 통제 능력을 함께 보존한다', async () => {
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  assert.equal(evidence.samePurposeAB.surfaceDigestAgreement, true);
  assert.ok(evidence.samePurposeAB.candidate.medianWallUs > evidence.samePurposeAB.baseline.medianWallUs);
  assert.equal(evidence.samePurposeAB.candidate.receiptPresent, true);
  assert.equal(evidence.samePurposeAB.candidate.restored, true);
  assert.equal(evidence.samePurposeAB.candidate.unrelatedLoss, 0);
});

test('S3-M3 source·test와 deterministic/live runner digest는 exact하다', async () => {
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  for (const [file, expected] of Object.entries({ ...evidence.sourceDigests, ...evidence.testDigests })) {
    assert.equal(digestAtCommit(evidence.sourceCommit, file), expected, file);
  }
  const commit = evidenceRevisionCommit(path);
  for (const [file, expected] of Object.entries(evidence.runnerDigests)) {
    assert.equal(digestAtCommit(commit, file), expected, file);
  }
});
