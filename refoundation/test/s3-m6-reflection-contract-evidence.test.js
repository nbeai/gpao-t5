import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { digestAtCommit } from './helpers/git-evidence-digest.js';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/s3-m6-reflection-contract-2026-08-27.json', import.meta.url,
), 'utf8'));

test('M6 Turn 1은 pure contract만 닫고 제품 Reflection을 주장하지 않는다', () => {
  assert.equal(evidence.status, 'CONTRACT_COMPLETE_PRODUCT_UNWIRED');
  assert.equal(evidence.contractTruth.initialState, 'proposed');
  assert.equal(evidence.contractTruth.initialUserConfirmed, false);
  assert.equal(evidence.contractTruth.projection, 'none');
  assert.equal(evidence.productNonInterference.consoleServerImportsReflection, false);
  assert.equal(evidence.productNonInterference.backgroundSchedulerChanged, false);
  assert.equal(evidence.verification.productWriterEvents, 0);
  assert.ok(evidence.notClaimed.includes('S3-M6 PASS'));
});

test('M6 contract는 출처·taint·교정·forget fence와 closed transition을 보존한다', () => {
  assert.equal(evidence.contractTruth.distinctWorkAndRunRequired, true);
  assert.equal(evidence.contractTruth.roleRecordRefsDistinct, true);
  assert.equal(evidence.contractTruth.modelInferenceOnlyAccepted, false);
  assert.equal(evidence.contractTruth.externalUntrustedOriginPreserved, true);
  assert.equal(evidence.contractTruth.currentCorrectionRelationRequired, true);
  assert.equal(evidence.contractTruth.affectedScopeForgetHeadRequired, true);
  assert.equal(evidence.contractTruth.stateHistoryBeginsAtProposed, true);
  assert.equal(evidence.contractTruth.closedTransitions, true);
  assert.equal(evidence.independentRedTeam.stateForgeryFoundAndFixed, true);
  assert.equal(evidence.independentRedTeam.recordScopeAndTimeOmissionFoundAndFixed, true);
});

test('M6 contract evidence는 다음 제품 배선 미달을 숨기지 않는다', () => {
  for (const required of [
    'Actual reopened Run and Work event payload', 'authoritative complete eligible set',
    'store-only append writer', 'atomic CAS boundary', 'Model proposal schema excludes',
    'matched off/on phase accounting',
  ]) assert.ok(evidence.knownUnproven.some((item) => item.includes(required)), required);
});

test('M6 contract evidence source digest는 exact contract commit과 일치한다', () => {
  assert.equal(evidence.sourceCommit, '691eb6f9fe7582f48e649de8ac8f4b1e97c016c5');
  for (const [path, expected] of Object.entries(evidence.sourceDigests)) {
    assert.equal(digestAtCommit(evidence.sourceCommit, path), expected, path);
  }
});
