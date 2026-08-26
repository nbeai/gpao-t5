import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const evidencePath = new URL(
  'refoundation/evidence/s3-m0-memory-constitution-2026-08-26.json', root,
);

const digest = async (path) => createHash('sha256')
  .update(await readFile(new URL(path, root)))
  .digest('hex');

test('S3-M0 evidence는 공식 Gate를 바꾸지 않고 제품 변경 0과 열린 미달을 보존한다', async () => {
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  assert.equal(evidence.status, 'PASS');
  assert.equal(evidence.officialReleaseGateChanged, false);
  assert.equal(evidence.stage.completed, 'S3-M0');
  assert.equal(evidence.stage.next, 'S3-M1_NOT_OPEN');
  assert.equal(evidence.stage.productSourceChanged, false);
  assert.deepEqual(evidence.baseline.counts,
    { pass: 4, gap: 7, partial: 2, not_open: 2 });
  assert.equal(evidence.baseline.gaps.length, 7);
  assert.equal(evidence.baseline.partial.length, 2);
  assert.equal(evidence.baseline.notOpen.length, 2);
});

test('S3-M0 evidence가 가리키는 current source와 fixture digest는 exact하다', async () => {
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  for (const [path, expected] of Object.entries({
    ...evidence.sourceDigests,
    ...evidence.fixtureDigests,
    ...evidence.governingDocumentDigests,
  })) assert.equal(await digest(path), expected, path);
});
