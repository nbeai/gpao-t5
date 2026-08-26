import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S3-T1B 제품 증거는 T5-owned secret만 닫고 authenticated CLI broker를 미완료로 남긴다', async () => {
  const raw = await readFile(new URL(
    '../evidence/s3-t1b-product-confinement-2026-08-26.json', import.meta.url,
  ), 'utf8');
  const evidence = JSON.parse(raw);
  assert.equal(evidence.status, 't5_owned_secret_confinement_wired_registered_cli_broker_open');
  assert.equal(evidence.protectedRead.normalReadable, true);
  assert.equal(evidence.protectedRead.secretReadable, false);
  assert.equal(evidence.protectedRead.denied, true);
  assert.equal(evidence.protectedRead.confinement.kind, 'macos_seatbelt');
  assert.equal(evidence.ordinaryCli.executed, true);
  assert.equal(evidence.keychainCli.denied, true);
  assert.equal(evidence.pass, true);
  assert.ok(evidence.remaining.some((item) => item.includes('broker')));
  assert.doesNotMatch(raw, /T5-PRODUCT-SECRET-MUST-NOT-LEAK/u);
});
