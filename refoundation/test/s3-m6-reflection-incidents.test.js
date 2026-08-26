import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const fixtureUrl = new URL('../config/s3-m6-reflection-incidents.json', import.meta.url);

async function load() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

const requiredFamilies = [
  'reflection_promoted_to_persona',
  'model_inference_only_source',
  'duplicate_episode_or_work_support',
  'missing_method_genealogy',
  'missing_effect_genealogy',
  'source_unavailable',
  'source_changed_after_observation',
  'taint_laundering',
  'counterexample_omitted',
  'counterexample_overlaps_support',
  'current_correction_omitted',
  'foreground_correction_after_review_stale_fence',
  'forgotten_source_reused',
  'managed_capability_side_effect',
];

test('S3-M6 fixture는 공식 M0·preflight를 가리키며 Gate PASS를 주장하지 않는다', async () => {
  const fixture = await load();
  assert.equal(fixture.schema, 't5.s3m6.reflection-incidents.v1');
  assert.match(fixture.status, /gate_not_qualified/u);
  assert.equal(fixture.gateClaims.m6GatePass, false);
  assert.equal(fixture.gateClaims.reflectionImplemented, false);
  assert.equal(fixture.gateClaims.principleQualified, false);
  assert.ok(fixture.basis.includes('refoundation/config/s3-memory-incidents.json#M0-10'));
  assert.ok(fixture.basis.includes('refoundation/config/s3-memory-incidents.json#M0-12'));
  assert.ok(fixture.basis.includes('refoundation/evidence/s3-m6-preflight-reuse-audit-2026-08-27.json'));
});

test('S3-M6 fixture는 14개 결함 가족과 실행 가능한 다섯 필드를 빠짐없이 고정한다', async () => {
  const fixture = await load();
  assert.equal(fixture.incidents.length, 14);
  assert.deepEqual(fixture.incidents.map((item) => item.family), requiredFamilies);
  assert.equal(new Set(fixture.incidents.map((item) => item.id)).size, fixture.incidents.length);
  for (const incident of fixture.incidents) {
    assert.match(incident.id, /^M6-I\d{2}$/u);
    assert.equal(typeof incident.userFailure, 'string');
    assert.ok(incident.userFailure.length >= 30);
    assert.equal(typeof incident.sourceSetup, 'object');
    assert.equal(typeof incident.mutation, 'object');
    assert.equal(typeof incident.oracle, 'object');
    assert.ok(Array.isArray(incident.nonGoals));
    assert.ok(incident.nonGoals.length >= 2);
    assert.ok(Object.keys(incident.sourceSetup).length >= 2);
    assert.ok(Object.keys(incident.mutation).length >= 2);
    assert.ok(Object.keys(incident.oracle).length >= 2);
  }
});

test('fixture에는 raw 개인정보·절대경로·실계정·비밀값이 없다', async () => {
  const fixture = await load();
  const serialized = JSON.stringify(fixture);
  assert.deepEqual(fixture.privacy, {
    realUserData: false,
    rawPersonalData: false,
    absolutePaths: false,
    realAccounts: false,
    rawSecrets: false,
    safeSyntheticCanariesOnly: true,
  });
  assert.doesNotMatch(serialized, /\/Users\/|\/home\/|[A-Z]:\\\\/u);
  assert.doesNotMatch(serialized, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu);
  assert.doesNotMatch(serialized, /\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}\b/u);
  assert.doesNotMatch(serialized, /\b01[016789]-?\d{3,4}-?\d{4}\b/u);
});

test('fixture oracle은 persona·false promotion·stale publication·forgotten reuse·외부 side effect를 0으로 닫는다', async () => {
  const fixture = await load();
  const byFamily = new Map(fixture.incidents.map((item) => [item.family, item]));
  assert.equal(byFamily.get('reflection_promoted_to_persona').oracle.personaWrites, 0);
  assert.equal(byFamily.get('model_inference_only_source').oracle.promotions, 0);
  assert.equal(byFamily.get('foreground_correction_after_review_stale_fence').oracle.publicationAccepted, false);
  assert.equal(byFamily.get('forgotten_source_reused').oracle.forgottenContentRead, 0);
  assert.equal(byFamily.get('managed_capability_side_effect').oracle.externalWrites, 0);
  assert.equal(byFamily.get('managed_capability_side_effect').oracle.managedCapabilityChanges, 0);
});
