import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = join(REPO, 'scripts/production90/metric-registry.json');
const MANIFEST = join(REPO, 'scripts/production90/scenario-manifest.json');
const SCHEMA = join(REPO, 'scripts/production90/production90.schema.json');
const SCORER = join(REPO, 'scripts/production90/score-production90.mjs');

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function scoring() {
  return import(`${pathToFileURL(SCORER).href}?test=${Date.now()}-${Math.random()}`);
}

test('Wave 0 정본은 P90 4개·평가 18개·코어 7개를 투영으로만 정의한다', async () => {
  const registry = await json(REGISTRY);
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.sourceOfTruth, true);
  assert.equal(Object.keys(registry.projections.p90).length, 4);
  assert.equal(Object.keys(registry.projections.items).length, 18);
  assert.equal(Object.keys(registry.projections.cores).length, 7);
  assert.ok(Array.isArray(registry.metrics) && registry.metrics.length >= 30);
  for (const projection of [
    ...Object.values(registry.projections.p90),
    ...Object.values(registry.projections.items),
    ...Object.values(registry.projections.cores),
  ]) {
    assert.equal('score' in projection, false, `${projection.title}: 수기 점수를 정본에 두지 않는다`);
    assert.equal(projection.metrics.reduce((sum, entry) => sum + entry.weight, 0), 100,
      `${projection.title}: 투영 배점 합계는 100`);
  }
});

test('원자 지표 신분과 사실 소유가 유일하고 판정 종류가 닫혀 있다', async () => {
  const registry = await json(REGISTRY);
  const ids = registry.metrics.map((metric) => metric.id);
  const facts = registry.metrics.map((metric) => metric.factKey);
  assert.equal(new Set(ids).size, ids.length, 'metric id 중복 0');
  assert.equal(new Set(facts).size, facts.length, 'factKey 중복 0');
  for (const metric of registry.metrics) {
    assert.ok(['deterministic', 'variable', 'human'].includes(metric.kind), `${metric.id}: 판정 종류`);
    assert.ok(metric.denominator?.unit, `${metric.id}: 분모 단위`);
    assert.ok(metric.passRule, `${metric.id}: 통과 규칙`);
    assert.ok(Array.isArray(metric.evidence) && metric.evidence.length > 0, `${metric.id}: 증거 요구`);
  }
});

test('모든 투영 항목은 존재하는 원자 지표만 한 번씩 참조한다', async () => {
  const registry = await json(REGISTRY);
  const known = new Set(registry.metrics.map((metric) => metric.id));
  for (const group of Object.values(registry.projections)) {
    for (const projection of Object.values(group)) {
      const refs = projection.metrics.map((entry) => entry.metricId);
      assert.equal(new Set(refs).size, refs.length, `${projection.title}: 같은 지표 중복 가산 0`);
      for (const ref of refs) assert.ok(known.has(ref), `${projection.title}: 알 수 없는 지표 ${ref}`);
    }
  }
});

test('정본 검증기는 배점·사실·수기점수·축 표류를 실제로 거부한다', async () => {
  const registry = await json(REGISTRY);
  const { validateRegistry } = await scoring();
  assert.deepEqual(validateRegistry(registry), []);

  const broken = structuredClone(registry);
  broken.metrics[1].factKey = broken.metrics[0].factKey;
  broken.projections.items['01-current-intent'].metrics[0].weight = 34;
  broken.projections.p90['P90-1'].score = 99;
  broken.projections.p90['P90-2'].metrics[0].axis = 'human';
  const errors = validateRegistry(broken).join('\n');
  assert.match(errors, /factKey 중복/);
  assert.match(errors, /배점 99/);
  assert.match(errors, /수기 점수/);
  assert.match(errors, /function 배점/);
});

test('시나리오 manifest는 분모·변동성·권한·프라이버시·실패 처리를 사전 등록한다', async () => {
  const [registry, manifest, schema] = await Promise.all([json(REGISTRY), json(MANIFEST), json(SCHEMA)]);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(schema.$id, 't5-production90');
  const known = new Set(registry.metrics.map((metric) => metric.id));
  assert.ok(manifest.scenarios.length >= 24, '실사용 폭 최소 24개 여정');
  for (const scenario of manifest.scenarios) {
    assert.ok(scenario.id && scenario.title);
    assert.ok(['deterministic', 'variable', 'human'].includes(scenario.kind));
    assert.ok(Number.isInteger(scenario.denominator?.planned) && scenario.denominator.planned > 0);
    assert.ok(scenario.environment?.artifact);
    assert.ok(scenario.authority?.externalEffects);
    assert.equal(scenario.privacy?.rawSecrets, false, `${scenario.id}: 원시 비밀 금지`);
    assert.ok(scenario.failurePolicy?.providerError);
    assert.ok(Array.isArray(scenario.metrics) && scenario.metrics.length > 0);
    for (const metric of scenario.metrics) assert.ok(known.has(metric), `${scenario.id}: 알 수 없는 지표 ${metric}`);
  }
});

test('manifest 검증기는 비밀·무방비 분모·허공 지표를 거부한다', async () => {
  const [registry, manifest] = await Promise.all([json(REGISTRY), json(MANIFEST)]);
  const { validateManifest } = await scoring();
  assert.deepEqual(validateManifest(registry, manifest), []);
  const broken = structuredClone(manifest);
  broken.scenarios[0].privacy.rawSecrets = true;
  broken.scenarios[1].denominator.planned = 0;
  broken.scenarios[2].metrics.push('metric.does-not-exist');
  const errors = validateManifest(registry, broken).join('\n');
  assert.match(errors, /원시 비밀/);
  assert.match(errors, /분모/);
  assert.match(errors, /알 수 없는 지표/);
});

test('결정적 실패·미실행·외부 차단·모델 실패와 P0를 정직하게 계산한다', async () => {
  const { scoreMetric, scoreProjection } = await scoring();
  const deterministic = { kind: 'deterministic', denominator: { unit: 'case', planned: 2 }, passRule: { target: 1 } };
  assert.equal(scoreMetric(deterministic, [{ status: 'PASS' }, { status: 'PRODUCT_FAIL' }]).ratio, 0);

  const variable = { kind: 'variable', denominator: { unit: 'run', planned: 4 }, passRule: { target: 0.75 } };
  const result = scoreMetric(variable, [{ status: 'PASS' }, { status: 'PASS' }, { status: 'MODEL_FAIL' }]);
  assert.equal(result.denominator, 4, '누락·모델 실패를 분모에 남긴다');
  assert.equal(result.passed, 2);
  assert.equal(result.ratio, 0.5);

  const blocked = scoreMetric(variable, [
    { status: 'PASS' }, { status: 'EXTERNAL_BLOCKED' }, { status: 'NOT_RUN' }, { status: 'HARNESS_INVALID' },
  ]);
  assert.equal(blocked.denominator, 4, '외부 차단·미실행은 0점, 무효 harness는 재실행 대기');
  assert.equal(blocked.complete, false, '무효 harness가 남으면 최종 점수를 내지 않는다');

  const projection = scoreProjection(
    { metrics: [{ metricId: 'safe', weight: 100 }] },
    { safe: { ratio: 1, complete: true, p0: true } },
  );
  assert.equal(projection.blocked, true, 'P0 한 건은 점수와 무관하게 차단');
});

test('집계기는 fixture 결과로만 점수를 만들고 축 하한과 90점 문턱을 적용한다', async () => {
  const { scoreProjection, computeScoreboard } = await scoring();
  const projection = {
    axes: { function: 30, reliability: 20, realWorld: 25, human: 15, operations: 10 },
    metrics: [
      { metricId: 'a', weight: 30, axis: 'function' },
      { metricId: 'b', weight: 20, axis: 'reliability' },
      { metricId: 'c', weight: 25, axis: 'realWorld' },
      { metricId: 'd', weight: 15, axis: 'human' },
      { metricId: 'e', weight: 10, axis: 'operations' },
    ],
  };
  const allPass = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((id) => [id, { ratio: 1, complete: true }]));
  assert.deepEqual(scoreProjection(projection, allPass), {
    score: 100, axes: { function: 30, reliability: 20, realWorld: 25, human: 15, operations: 10 },
    complete: true, blocked: false, qualifies90: true, reasons: [],
  });

  const weakHuman = { ...allPass, d: { ratio: 0.7, complete: true } };
  const scored = scoreProjection(projection, weakHuman);
  assert.equal(scored.score, 95.5);
  assert.equal(scored.qualifies90, false, '총점이 높아도 축 80% 미달은 90점 아님');

  const empty = computeScoreboard(await json(REGISTRY), []);
  assert.equal(empty.projections.p90['P90-1'].score, null, '미측정은 0점으로 가장하지 않는다');
  assert.equal(empty.projections.p90['P90-1'].complete, false);
});
