import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/s6-de-learning-admission-hardening-2026-08-30.json', import.meta.url,
), 'utf8'));

test('6차 Experience Growth는 default-on이면서 단순 성공을 후보로 저장하지 않는다', () => {
  assert.equal(evidence.status, 'DEFAULT_ON_INCIDENT_ADMISSION_HARDENED');
  assert.equal(evidence.productDefault, 'proposal');
  assert.equal(evidence.defaultOffAsProductCompletion, false);
  assert.equal(evidence.after.simpleSuccesses, 'NOTHING_TO_REVIEW');
  assert.equal(evidence.actualModelQualification.passed, true);
  assert.equal(evidence.actualModelQualification.learningModelFactories, 0);
  assert.equal(evidence.actualModelQualification.candidates, 0);
  assert.equal(evidence.positiveControl.regressionRollback, true);
  assert.match(evidence.remainingTruth.actualHumanFreshFieldBenefit, /NOT_YET_PROVEN/u);
});
