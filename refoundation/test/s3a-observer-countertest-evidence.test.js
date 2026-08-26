import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const evidence = new URL('refoundation/evidence/s3-a-s1-observer-countertest-2026-08-26.json', root);

test('S1 evidence는 제품 비개입과 비용을 분리하고 live model 미실행을 숨기지 않는다', async () => {
  const value = JSON.parse(await readFile(evidence, 'utf8'));
  assert.equal(value.testOnly, true);
  assert.equal(value.samples.length, 2);
  assert.deepEqual(value.samples.map((sample) => sample.blockingWritesBeforeProductTerminal), [0, 0]);
  assert.deepEqual(value.behavior.productDigestCountPerSample, [1, 1]);
  assert.equal(value.behavior.requestContaminationMutationDetected, true);
  assert.match(value.interpretation.rssCausalClaim, /unknown/u);
  assert.ok(value.notExecuted.includes('Terra live paired observer test'));
  assert.ok(value.notExecuted.includes('gpt-5.5 live paired observer test'));
});

test('S1 evidence가 가리키는 reference·observer·test·runner digest가 현재 source와 일치한다', async () => {
  const value = JSON.parse(await readFile(evidence, 'utf8'));
  const files = {
    referenceSealSha256: 'refoundation/evidence/s3-a-observer-reference-seal-2026-08-26.json',
    observerSha256: 'refoundation/test/helpers/s3a-performance-observer.js',
    countertestSha256: 'refoundation/test/s3a-performance-observer.test.js',
    runnerSha256: 'refoundation/scripts/run-s3a-observer-countertest.mjs',
  };
  for (const [field, path] of Object.entries(files)) {
    const actual = createHash('sha256').update(await readFile(new URL(path, root))).digest('hex');
    assert.equal(actual, value.artifacts[field], path);
  }
});
