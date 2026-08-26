import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/s3-m6-reflection-shadow-live-2026-08-27.json', import.meta.url,
), 'utf8'));

test('M6 Turn 4는 두 실제 모델의 propose·abstain을 quality·safety·cost로 분리한다', () => {
  assert.equal(evidence.status, 'PASS_WITH_OBSERVATION_PRODUCT_UNWIRED');
  assert.equal(evidence.scope.fullFactorial, false);
  assert.equal(evidence.scope.expandedOnlyFailedAxis, true);
  assert.equal(evidence.secondAttempt.positive['gpt-5.6-terra'].humanMeaningReviewPassed, true);
  assert.equal(evidence.secondAttempt.positive['gpt-5.5'].humanMeaningReviewPassed, true);
  assert.equal(evidence.failedAxisRepair['gpt-5.6-terra'].modelQualityPassed, true);
  assert.equal(evidence.failedAxisRepair['gpt-5.5'].modelQualityPassed, true);
  assert.equal(evidence.scope.ledgerWrites, 0);
  assert.equal(evidence.scope.principleWrites, 0);
});

test('첫 실패와 불완전 비용을 숨기거나 0으로 꾸미지 않는다', () => {
  assert.equal(evidence.firstFixedAttempt.result, 'FAILED_PROVIDER_TOOL_SCHEMA');
  assert.equal(evidence.secondAttempt.negative.modelFormatQualityPassed, false);
  assert.equal(evidence.resourceTruth.totalProviderRequestsIncludingFailures, 10);
  assert.equal(evidence.resourceTruth.knownTotalTokens, 3013);
  assert.equal(evidence.resourceTruth.failedAttemptTokenUsage, 'unknown');
  assert.equal(evidence.resourceTruth.totalTokenCompleteness, false);
  assert.equal(evidence.resourceTruth.estimatedCostUsd, null);
});

test('요청·credential privacy와 source digest가 exact하다', async () => {
  assert.equal(evidence.requestAndCredentialBoundary.credentialStoreWrites, 0);
  assert.equal(evidence.requestAndCredentialBoundary.oauthRefreshRequests, 0);
  assert.equal(evidence.requestAndCredentialBoundary.forbiddenRequestHits, 0);
  assert.equal(evidence.requestAndCredentialBoundary.forbiddenModelOutputHits, 0);
  assert.equal(evidence.requestAndCredentialBoundary.rawRequestBodiesPersisted, false);
  for (const [path, expected] of Object.entries(evidence.sourceDigests)) {
    const bytes = await readFile(new URL(`../../${path}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, path);
  }
});

test('Turn 4 evidence는 제품 배선·Principle·M6 PASS를 주장하지 않는다', () => {
  assert.equal(evidence.officialReleaseGateChanged, false);
  assert.ok(evidence.notClaimed.includes('S3-M6 PASS'));
  assert.ok(evidence.notClaimed.some((item) => /Principle/u.test(item)));
  assert.ok(evidence.notClaimed.some((item) => /provider retention/iu.test(item)));
});
