import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const evidence = JSON.parse(readFileSync(new URL('../evidence/nx2-wc1-bounded-collection-2026-09-01.json', import.meta.url), 'utf8'));

test('WC-1은 모델의 수집 의미와 Runtime의 물리·coverage 계약을 분리한다', () => {
  assert.equal(evidence.status, 'WC1_COMPLETE_WC2_OPEN');
  assert.equal(evidence.actual.records, 60); assert.equal(evidence.actual.requests, 3);
  assert.equal(evidence.actual.missingRequired, 0); assert.equal(evidence.actual.duplicates, 0);
  assert.equal(evidence.actual.coverageComplete, true);
  assert.equal(evidence.contract.crossOrigin, 'rejected');
  assert.equal(evidence.contract.credentialUrl, 'rejected');
  assert.equal(evidence.contract.contentInstructionAuthority, 'none');
});

test('qualification 속도를 전체 제품 우위나 Windows 물리 PASS로 확대하지 않는다', () => {
  assert.equal(evidence.comparisonBoundary.candidateIsQualificationOnly, true);
  assert.equal(evidence.comparisonBoundary.wholeUserJourneySpeedClaimed, false);
  assert.equal(evidence.platform.windowsPhysical, 'DEFERRED_BY_OWNER');
  assert.equal(evidence.productSourceChanges, 0);
});
