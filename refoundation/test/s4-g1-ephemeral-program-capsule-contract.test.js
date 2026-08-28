import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const fixtureUrl = new URL('../fixtures/s4-g1-ephemeral-program-capsule-contract.json', import.meta.url);

test('S4-G1 계약은 program self-report와 사용자 완료를 합치지 않고 기존 D·E·F 현실을 재사용한다', async () => {
  const value = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  assert.equal(value.status, 'CONTRACT_ONLY_PRODUCT_CHANGES_ZERO');
  assert.equal(value.candidateKind, 'artifact_building');
  assert.deepEqual(value.facts.identity, ['capsuleId', 'workId', 'revision']);
  assert.deepEqual(value.facts.source, ['sha256']);
  assert.deepEqual(value.facts.inputs, ['recordRef', 'revision', 'sha256']);
  assert.deepEqual(value.states, ['prepared', 'fixture_failed', 'fixture_verified', 'actual_running',
    'actual_failed_no_effect', 'actual_effect_unknown', 'output_unverified', 'output_verified',
    'published_verified', 'cleanup_unknown', 'cleaned']);
  assert.ok(value.oracleProvenanceForbidden.includes('capsule_manifest'));
  assert.ok(value.oracleProvenanceForbidden.includes('model_claim_without_observed_fact'));
  assert.ok(value.invariants.some((item) => item.includes('exit zero')));
  assert.ok(value.invariants.some((item) => item.includes('blind automatic execution')));
  assert.ok(value.reuse.includes('S4-D managed process, output handle and crash settlement'));
  assert.ok(value.reuse.includes('S4-E scratch and declared-output confinement'));
  assert.ok(value.reuse.includes('S4-F prepare, publication, verification and rollback transaction'));
  assert.ok(value.nonGoals.includes('new store'));
  assert.ok(value.nonGoals.includes('nested tool RPC'));
  assert.equal(JSON.stringify(value).match(/inventory|employee|vendor|receivable|payroll/giu), null);
});

test('S4-G0 증거는 목적 성공과 경제성·자격 공백을 분리해 G1만 연다', async () => {
  const value = JSON.parse(await readFile(new URL(
    '../evidence/s4-g0-read-only-baseline-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(value.productSourceChanges, 0);
  assert.equal(value.purpose.naturalLanguageOnly, true);
  assert.equal(value.purpose.programRequestedByUser, false);
  assert.equal(value.verification.passed, true);
  assert.equal(value.verification.totalsExact, true);
  assert.equal(value.verification.errorsExact, true);
  assert.equal(value.verification.sourceUnchanged, true);
  assert.equal(value.verification.residualFiles, 0);
  assert.equal(value.verification.residualManagedProcesses, 0);
  assert.equal(value.qualificationCorrection.independentOracleHashMatch, true);
  assert.equal(value.route.programAuthoredOrExecuted, true);
  assert.equal(value.route.capsuleContractObserved, false);
  assert.ok(value.performance.modelCalls > 1);
  assert.ok(value.performance.providerTokens > 100_000);
  assert.equal(value.gateOutcome.status, 'G0_COMPLETE');
  assert.equal(value.gateOutcome.userPurposeAchieved, true);
  assert.equal(value.gateOutcome.productImplementationAdopted, 0);
  assert.equal(value.gateOutcome.nextGate, 'G1_CAPSULE_CONTRACT');
  assert.equal(value.decision, 'G1_OPEN_ECONOMY_AND_QUALIFICATION_GAP');
});
