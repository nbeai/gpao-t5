import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { digestAtCommit, evidenceRevisionCommit } from './helpers/git-evidence-digest.js';

const root = new URL('../../', import.meta.url);
const evidencePath = new URL(
  'refoundation/evidence/s3-m1-record-provenance-2026-08-26.json', root,
);
test('S3-M1 evidence는 RecordRef shadow만 닫고 M2와 제품 hot path를 열지 않는다', async () => {
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  assert.equal(evidence.status, 'PASS_SHADOW');
  assert.equal(evidence.officialReleaseGateChanged, false);
  assert.equal(evidence.stage.completed, 'S3-M1');
  assert.equal(evidence.stage.next, 'S3-M2_NOT_OPEN');
  assert.equal(evidence.stage.productHotPathWired, false);
  assert.equal(evidence.stage.newCanonicalStore, false);
  assert.equal(evidence.stage.sqliteAdded, false);
  assert.deepEqual(evidence.adapterCoverage, [
    'conversation_message', 'run_event', 'work_event', 'attachment', 'artifact',
    'local_file', 'web_source', 'channel_message', 'connection_resource',
  ]);
});

test('S3-M1 evidence는 same-purpose 제품 비개입과 측정 구조 비용을 분리한다', async () => {
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  assert.equal(evidence.samePurposeAB.productDigestAgreement, true);
  assert.equal(evidence.samePurposeAB.providerRequestChanged, false);
  assert.equal(evidence.samePurposeAB.toolCallsChanged, false);
  assert.equal(evidence.samePurposeAB.authorityChanged, false);
  assert.equal(evidence.samePurposeAB.effectsChanged, false);
  assert.equal(evidence.samePurposeAB.surfaceChanged, false);
  assert.equal(evidence.samePurposeAB.rawSourceInAccounting, false);
  assert.ok(evidence.samePurposeAB.O2_full_shadow.medianWallUs >= 0);
  assert.ok(evidence.samePurposeAB.O2_full_shadow.medianAccountingBytes > 0);
});

test('S3-M1 evidence가 가리키는 source·test·runner·M0 digest는 exact하다', async () => {
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  for (const [path, expected] of Object.entries(evidence.sourceDigests)) {
    assert.equal(digestAtCommit(evidence.sourceCommit, path), expected, path);
  }
  const evidenceCommit = evidenceRevisionCommit(
    'refoundation/evidence/s3-m1-record-provenance-2026-08-26.json',
  );
  for (const [path, expected] of Object.entries({
    ...evidence.testAndRunnerDigests,
    ...evidence.priorEvidence,
  })) assert.equal(digestAtCommit(evidenceCommit, path), expected, path);
});
