import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = new URL('../config/s2-a-human-console-live-scenarios.json', import.meta.url);
const load = async () => JSON.parse(await readFile(file, 'utf8'));

test('A 종료 인간 콘솔 계획은 자연어 필수 여정 8개와 이후 Gate 기준선을 분리한다', async () => {
  const plan = await load();
  assert.equal(plan.schema, 't5.s2-a-human-console-live-scenarios.v1');
  assert.equal(plan.status, 'prepared_not_executed');
  assert.deepEqual(plan.aCloseRequired.map((item) => item.id), [
    'A-H01', 'A-H02', 'A-H03', 'A-H04', 'A-H05', 'A-H06', 'A-H07', 'A-H08',
  ]);
  assert.ok(plan.aCloseRequired.every((item) => item.turns.length >= 2 && item.acceptance.length >= 4));
  assert.ok(plan.postAGateBaselineOnly.every((item) => item.aCloseBlocking === false));
});

test('A 종료 계획은 기능 축소·고정 상한·가시 Browser·비밀 노출을 합격시키지 않는다', async () => {
  const plan = await load();
  assert.equal(plan.pass.requiredJourneyPasses, 8);
  assert.equal(plan.pass.fixedCapStopsWhileProgressing, 0);
  assert.equal(plan.pass.visibleBrowserWindows, 0);
  assert.equal(plan.pass.falseCompletion, 0);
  assert.equal(plan.pass.secretExposure, 0);
  assert.deepEqual(plan.pass.models, ['gpt-5.6-terra', 'gpt-5.5']);
  assert.ok(plan.aCloseRequired.find((item) => item.id === 'A-H06').acceptance
    .includes('no capability reduction justified by user skill'));
});

test('A 종료 계획은 개인정보·실경로·비밀값을 포함하지 않는다', async () => {
  const serialized = await readFile(file, 'utf8');
  assert.doesNotMatch(serialized, /\/Users\//u);
  assert.doesNotMatch(serialized, /\bntn_[A-Za-z0-9_-]+/u);
  assert.doesNotMatch(serialized, /bot\d+:[A-Za-z0-9_-]+/u);
});

test('독립 여정은 네 lane 두 wave로 병렬화하고 성능 anchor만 무경합 재확인한다', async () => {
  const plan = await load();
  const parallel = plan.parallelExecution;
  assert.equal(parallel.maxConcurrentLanes, 4);
  assert.equal(parallel.serialWithinEachJourney, true);
  assert.equal(parallel.sharedStateBetweenLanes, false);
  assert.equal(parallel.wave1.length, 4);
  assert.equal(parallel.wave2.length, 4);
  assert.equal(new Set([...parallel.wave1, ...parallel.wave2].map((item) => item.lane)).size, 8);
  assert.equal(parallel.aggregation.rerunOnlyFailedOrAmbiguousLane, true);
  assert.deepEqual(parallel.performanceCalibration.sequentialAnchors, ['A-H04', 'A-H05']);
  assert.equal(parallel.performanceCalibration.rerunAllJourneysSequentially, false);
});
