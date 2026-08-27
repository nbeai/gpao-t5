import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { digestAtCommit } from './helpers/git-evidence-digest.js';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/s3-m5-windows-native-surface-2026-08-27.json', import.meta.url,
), 'utf8'));

test('M5-4 evidence는 billing으로 시작하지 못한 runner를 코드 실패나 PASS로 꾸미지 않는다', () => {
  assert.equal(evidence.status, 'BLOCKED_EXTERNAL_RUNNER');
  assert.equal(evidence.github.runnerId, 0);
  assert.equal(evidence.github.stepsStarted, 0);
  assert.equal(evidence.github.failureFamily, 'account_billing_or_spending_limit');
  assert.equal(evidence.qualificationBoundary.githubRunnerPassed, false);
  assert.equal(evidence.qualificationBoundary.windowsSearchActualPassed, false);
  assert.equal(evidence.qualificationBoundary.billingChangedByDevelopmentSession, false);
});

test('M5-4 evidence는 derived projection과 Windows Search VM을 분리한다', () => {
  assert.equal(evidence.localStructural.derivedFileProjection, 'passed');
  assert.equal(evidence.qualificationBoundary.derivedFileProjectionIsWindowsSearchPass, false);
  assert.equal(evidence.qualificationBoundary.explorerHumanJourneyPassed, false);
  assert.equal(evidence.qualificationBoundary.windowsVmPassed, false);
  assert.ok(evidence.notClaimed.includes('S3-M6 opened'));
});

test('M5-4 evidence source digest는 blocked exact head와 일치한다', async () => {
  assert.equal(evidence.sourceCommit, 'cc50cfd774439b7740512d6e3d0761a4538e23e5');
  assert.equal(evidence.github.headSha, evidence.sourceCommit);
  for (const [path, expected] of Object.entries(evidence.sourceDigests)) {
    assert.equal(digestAtCommit(evidence.sourceCommit, path), expected, path);
  }
});
