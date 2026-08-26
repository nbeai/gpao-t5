import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/s3-m6-complete-2026-08-27.json', import.meta.url,
), 'utf8'));

test('M6는 Reflection 검토·Principle·rollback·background를 닫고 기본 활성화는 열지 않는다', () => {
  assert.equal(evidence.status, 'IMPLEMENTATION_COMPLETE_PASS_WITH_OBSERVATION_DEFAULT_OFF');
  assert.equal(evidence.implementationComplete, true);
  assert.equal(evidence.activationDefault, 'off');
  assert.equal(evidence.reflection.humanReview.productQualificationPassed, true);
  assert.equal(evidence.principle.rollback.activeSkillsAfter, 0);
  assert.equal(evidence.backgroundNoninterference.stalePublicationCommits, 0);
  assert.equal(evidence.officialReleaseGateChanged, false);
});

test('불리한 fixture·비용·writer·Windows 관측을 PASS에 합치지 않는다', () => {
  assert.equal(evidence.principle.fixtureAdapter.productQualification, false);
  assert.equal(evidence.principle.fixtureAdapter.actualWorkRunStores, false);
  assert.equal(evidence.resourceTruth.failedRequestTokens, 'unknown');
  assert.equal(evidence.resourceTruth.completeDollarChargeReceipt, false);
  assert.ok(evidence.observations.some((item) => /Direct nonparticipating writers/u.test(item)));
  assert.ok(evidence.observations.some((item) => /Windows/u.test(item)));
});

test('optional Skill은 근거 없이 구현하지 않고 side effect를 0으로 유지한다', () => {
  assert.equal(evidence.optionalInternalSkill.implemented, false);
  assert.equal(evidence.optionalInternalSkill.activeSkillChanges, 0);
  assert.ok(evidence.notClaimed.some((item) => /internal Skill/u.test(item)));
  assert.equal(evidence.resourceTruth.externalWrites, 0);
});

test('M6 close source digests는 exact current artifacts와 일치한다', async () => {
  for (const [path, expected] of Object.entries(evidence.sourceDigests)) {
    const bytes = await readFile(new URL(`../../${path}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, path);
  }
});
