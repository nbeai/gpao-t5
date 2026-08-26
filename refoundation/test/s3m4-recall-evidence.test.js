import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { digestAtCommit } from './helpers/git-evidence-digest.js';

const root = new URL('../../', import.meta.url);
const evidencePath = new URL('refoundation/evidence/s3-m4-recall-2026-08-27.json', root);

test('S3-M4 evidence는 actual five-case pass로 retrieval expansion을 닫는다', async () => {
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  assert.equal(evidence.status, 'COMPLETE_NO_RETRIEVAL_EXPANSION');
  assert.equal(evidence.productCodeChanged, false);
  assert.deepEqual(evidence.retrievalEnginesAdded, []);
  assert.ok(evidence.audits.every((audit) => audit.status === 'passed'));
  assert.equal(evidence.decision.fts, 'closed_no_deficit');
  assert.equal(evidence.decision.embedding, 'closed_prerequisite_not_proven');
  assert.equal(evidence.decision.graph, 'closed_prerequisite_not_proven');
  assert.equal(evidence.productInvariants.sourceReopenRate, 1);
  assert.equal(evidence.productInvariants.normalTurnRecallModelCallsAdded, 0);
});

test('S3-M4 no-change A/B는 제품 비용과 qualification 비용을 섞지 않는다', async () => {
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  assert.equal(evidence.samePurposeAB.productDigestAgreement, true);
  assert.equal(evidence.samePurposeAB.requestBytesDelta, 0);
  assert.equal(evidence.samePurposeAB.providerCallsDelta, 0);
  assert.equal(evidence.samePurposeAB.tokensDelta, 0);
  assert.equal(evidence.samePurposeAB.qualificationResourcesAreNotNormalTurnOverhead, true);
});

test('S3-M4 evidence digest는 exact close commit에 결속된다', async () => {
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  for (const [file, expected] of Object.entries(evidence.digests)) {
    assert.equal(digestAtCommit(evidence.sourceCommit, file), expected, file);
  }
});
