import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

test('S3-UX evidence는 첫 oracle 실패와 두 번째 네 lane·인간 검토를 함께 보존한다', async () => {
  const evidence = JSON.parse(await readFile(new URL('../evidence/s3-ux-live-qualification-2026-08-27.json', import.meta.url)));
  assert.equal(evidence.status, 'PASS_WITH_OBSERVATION');
  assert.equal(evidence.liveCalls.providerAttempts, 8);
  assert.equal(evidence.liveCalls.firstWave.machineVerdict, 'FAILED_LOCAL_ORACLE_TOO_NARROW');
  assert.equal(evidence.liveCalls.secondWave.results.length, 4);
  assert.equal(evidence.liveCalls.secondWave.results.every((item) => item.passedUnderCorrectedOracle), true);
  assert.equal(evidence.humanLanguageReviewPassed, true);
  assert.equal(evidence.writes.externalBusinessWrites, 0);
});

test('S3-UX evidence runner digest와 비용·비주장 경계는 exact하다', async () => {
  const evidence = JSON.parse(await readFile(new URL('../evidence/s3-ux-live-qualification-2026-08-27.json', import.meta.url)));
  const runner = await readFile(new URL('../scripts/run-s3ux-live-qualification.mjs', import.meta.url));
  assert.equal(createHash('sha256').update(runner).digest('hex'), evidence.runnerDigest);
  assert.equal(evidence.liveCalls.totalsBothWaves.totalTokens, 2984);
  assert.equal(evidence.liveCalls.totalsBothWaves.estimatedCostUsd, null);
  assert.ok(evidence.notClaimed.includes('physical Windows UI qualification'));
  assert.equal(evidence.productQualification.modelLanguageShadowIsNotProductBehavior, true);
});
