import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const scenarioFile = new URL('../config/s2-human-performance-scenarios.json', import.meta.url);
const evidenceFile = new URL('../evidence/s2-p019-human-tester-baseline-2026-08-24.json', import.meta.url);
const load = async (file) => JSON.parse(await readFile(file, 'utf8'));

test('0.1.9 인간 테스트는 아홉 개의 재사용 가능한 목적 여정으로 보존된다', async () => {
  const fixture = await load(scenarioFile);
  assert.equal(fixture.schema, 't5.s2-human-performance-scenarios.v1');
  assert.equal(fixture.scenarios.length, 9);
  assert.deepEqual(fixture.scenarios.map((item) => item.id), [
    'HP-01', 'HP-02', 'HP-03', 'HP-04', 'HP-05', 'HP-06', 'HP-07', 'HP-08', 'HP-09',
  ]);
  assert.equal(new Set(fixture.scenarios.map((item) => item.id)).size, fixture.scenarios.length);
  assert.ok(fixture.scenarios.every((item) => item.objective && item.fixture && item.acceptance.length >= 5));
});

test('원본 화면·비밀·사용자 경로는 성능 fixture와 기준 증거에 복제되지 않는다', async () => {
  const fixture = await readFile(scenarioFile, 'utf8');
  const evidence = await readFile(evidenceFile, 'utf8');
  const serialized = `${fixture}\n${evidence}`;
  assert.doesNotMatch(serialized, /\/Users\//u);
  assert.doesNotMatch(serialized, /\bntn_[A-Za-z0-9_-]+/u);
  assert.doesNotMatch(serialized, /bot\d+:[A-Za-z0-9_-]+/u);
  assert.equal(JSON.parse(evidence).sourceBoundary.rawScreenshotsCommitted, false);
  assert.equal(JSON.parse(evidence).sourceBoundary.rawSecretsCommitted, false);
});

test('각 실제 미달은 해결할 Gate와 최종 Release 여정에 함께 결속된다', async () => {
  const fixture = await load(scenarioFile);
  const evidence = await load(evidenceFile);
  const ids = new Set(fixture.scenarios.map((item) => item.id));
  for (const [stage, routed] of Object.entries(evidence.stageRouting)) {
    assert.ok(stage); assert.ok(routed.length > 0);
    assert.ok(routed.every((id) => ids.has(id)));
  }
  assert.deepEqual(new Set(evidence.stageRouting.RELEASE), ids);
  assert.equal(evidence.developmentBoundary.doNotInterruptA2WithChannelExpansion, true);
  assert.equal(evidence.developmentBoundary.secretBoundaryIsNextPackageReleaseBlocker, true);
});
