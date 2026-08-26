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
