import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('secret confinement 증거는 generic deny와 broker positive control을 함께 요구하고 제품 완료로 꾸미지 않는다', async () => {
  const raw = await readFile(new URL(
    '../evidence/s3-t1b-secret-confinement-candidate-2026-08-26.json', import.meta.url,
  ), 'utf8');
  const evidence = JSON.parse(raw);
  assert.equal(evidence.status, 'candidate_qualified_product_not_wired');
  assert.equal(evidence.genericTerminal.normalFileReadable, true);
  assert.equal(evidence.genericTerminal.secretFileReadable, false);
  assert.equal(evidence.genericTerminal.deniedBeforeSecretOutput, true);
  assert.equal(evidence.brokeredCli.safeIdentityReturned, true);
  assert.equal(evidence.brokeredCli.secretRedacted, true);
  assert.equal(evidence.brokeredCli.forbiddenActionRejected, true);
  assert.equal(evidence.productCodeChanged, false);
  assert.equal(evidence.pass, true);
  assert.doesNotMatch(raw, /S3T-FIXTURE-SECRET-MUST-NOT-SURVIVE/u);
});
