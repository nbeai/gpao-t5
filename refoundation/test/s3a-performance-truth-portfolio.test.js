import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const path = new URL('refoundation/config/s3-a-performance-truth-portfolio.json', root);
const load = async () => JSON.parse(await readFile(path, 'utf8'));

test('S3-A의 열 개 항목은 완전 교차 cell이 아니라 제품 영역 coverage다', async () => {
  const value = await load();
  assert.equal(value.coverageAreas.length, 10);
  assert.equal(new Set(value.coverageAreas.map((item) => item.id)).size, 10);
  assert.equal(value.sampling.fullFactorial, false);
  assert.equal(value.sampling.fixedCellCount, null);
  assert.equal(value.sampling.fixedTotalRuns, null);
  assert.equal(value.sampling.equalSamplesPerCoverageArea, false);
  assert.equal('expectedCellCount' in value.sampling, false);
});

test('S3-A는 기존 증거와 일곱 최소 대표 여정 뒤 차이가 난 축만 확대한다', async () => {
  const value = await load();
  assert.equal(value.sentinelJourneys.length, 7);
  const covered = new Set(value.sentinelJourneys.flatMap((journey) => journey.covers));
  assert.deepEqual([...covered].sort(), value.coverageAreas.map((item) => item.id).sort());
  assert.ok(value.coverageAreas.every((item) => item.existingEvidence.length > 0));
  assert.ok(value.sampling.expandOnlyWhen.length >= 4);
  assert.ok(value.sampling.stopWhen.length >= 4);
});

test('설치본 장기 작업 실패는 새 표본 행렬 대신 기존 여정의 가시성·통제·효과 oracle로 흡수한다', async () => {
  const [value, workOrder] = await Promise.all([
    load(),
    readFile(new URL('docs/03-verification/T5-S3-A-PERFORMANCE-TRUTH-WORK-ORDER-2026-08-26-ko.md', root), 'utf8'),
  ]);
  assert.equal(value.sentinelJourneys.length, 7);
  for (const metric of [
    'firstMeaningfulMilestoneMs', 'longestInvisibleIntervalMs', 'cancelAdmissionToStopMs',
    'cancelToClaimReleaseMs', 'sameWorkRecoveryAccepted', 'recoveryActionVisibleMs',
    'verifiedArtifactVisible', 'originalArtifactIdentityPreserved', 'unrequestedWorkspaceCopies',
    'userSurfaceInternalStateLiterals', 'firstUsefulPreambleMs', 'meaningfulActivityChanges',
    'falseProgressUpdates', 'correctionQueuedVisibleMs', 'correctionConsumedVisibleMs',
    'unconsumedCorrectionPreserved', 'reconnectProjectionExact', 'returnRecapVisibleMs',
    'progressAdditionalModelCalls', 'progressContextBytes', 'progressEventBytes',
    'effectForensicCoverage',
  ]) assert.ok(value.requiredMetrics.includes(metric), metric);
  assert.match(workOrder, /actual-user incident routing/u);
  assert.match(workOrder, /새 대표 여정을\s*추가하지 않고/u);
  assert.match(workOrder, /장기 Work 불가시성[\s\S]*교정·취소·복구[\s\S]*대량 파일 effect 사고/u);
  assert.match(workOrder, /exact execution claim release/u);
  assert.match(workOrder, /요청하지 않은 workspace copy 0/u);
  assert.doesNotMatch(workOrder, /\/Users\/|ntn_[A-Za-z0-9]+/u);
});

test('S3-UX는 사례 문구가 아니라 취소 소유권·원본 publication·인간 언어 경계를 고정한다', async () => {
  const [value, preparation] = await Promise.all([
    load(),
    readFile(new URL('T5-THIRD-ACTIVATION-PREPARATION.md', root), 'utf8'),
  ]);
  assert.equal(value.absoluteInvariants.cancelledWorkClaimStranding, 0);
  assert.equal(value.absoluteInvariants.unrequestedWorkspaceArtifactCopies, 0);
  assert.equal(value.absoluteInvariants.internalStateLiteralExposure, 0);
  assert.equal(value.absoluteInvariants.lostOrFalseConsumedCorrection, 0);
  assert.equal(value.absoluteInvariants.falseProgressClaims, 0);
  assert.equal(value.absoluteInvariants.progressAdditionalModelCalls, 0);
  assert.equal(value.absoluteInvariants.progressContextInjectionBytes, 0);
  assert.equal(value.absoluteInvariants.staleReconnectProjection, 0);
  assert.match(preparation, /cancel admitted[\s\S]*exact Work revision execution claim release[\s\S]*다음 사용자 입력/u);
  assert.match(preparation, /그 기존 파일 자체[\s\S]*사용자\s*작업공간에 `cp`로 동일 복사본/u);
  assert.match(preparation, /`active`[\s\S]*한국어로\s*projection/u);
  assert.match(preparation, /모델의 짧은 preamble\/commentary[\s\S]*런타임의 grounded milestone/u);
  assert.match(preparation, /현재 작업에 반영 예정[\s\S]*이번 경계에서 소비되지 못해 다음 입력으로 보존/u);
  assert.match(preparation, /canonical snapshot[\s\S]*한 줄로\s*요약/u);
  assert.match(preparation, /progress·recap·receipt projection 때문에 추가 provider\/model call `0`/u);
});

test('S3-A 준비는 공식 Gate·제품 진실·observer 비개입을 유지한다', async () => {
  const [value, current, preparation, workOrder] = await Promise.all([
    load(),
    readFile(new URL('T5-SECOND-COMPLETION.md', root), 'utf8'),
    readFile(new URL('T5-THIRD-ACTIVATION-PREPARATION.md', root), 'utf8'),
    readFile(new URL('docs/03-verification/T5-S3-A-PERFORMANCE-TRUTH-WORK-ORDER-2026-08-26-ko.md', root), 'utf8'),
  ]);
  const gate = 'SECOND COMPLETION COMPLETE · 0.2.1 UNSIGNED PACKAGE QUALIFIED · SIGNING EXTERNAL BLOCKER';
  assert.ok(current.includes(gate));
  assert.ok(preparation.includes(gate));
  assert.equal(value.privacy.realExternalWrites, false);
  assert.equal(value.absoluteInvariants.instrumentationInModelContextOrUserSurface, 0);
  assert.match(workOrder, /완전 교차 행렬과 목적별 동일 표본 수는 금지/u);
  assert.doesNotMatch(workOrder, /160 cell|160개|800회/u);
});
