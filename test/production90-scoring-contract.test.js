import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

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
  for (const scenario of broken.scenarios) scenario.metrics = scenario.metrics.filter((id) => id !== 'response.stock');
  const errors = validateManifest(registry, broken).join('\n');
  assert.match(errors, /원시 비밀/);
  assert.match(errors, /분모/);
  assert.match(errors, /알 수 없는 지표/);
  assert.match(errors, /측정 시나리오 없는 지표 response.stock/);
});

test('모든 원자 지표는 적어도 한 사전 등록 시나리오에서 측정 가능하다', async () => {
  const [registry, manifest] = await Promise.all([json(REGISTRY), json(MANIFEST)]);
  const covered = new Set(manifest.scenarios.flatMap((scenario) => scenario.metrics));
  const uncovered = registry.metrics.map((metric) => metric.id).filter((id) => !covered.has(id));
  assert.deepEqual(uncovered, []);
});

test('점수 입력은 시나리오·digest·표본·증거 신분이 맞아야 한다', async () => {
  const [registry, manifest, schema] = await Promise.all([json(REGISTRY), json(MANIFEST), json(SCHEMA)]);
  const { computeScoreboard, contractDigest, validateRunBundle } = await scoring();
  const digest = 'a'.repeat(64);
  const fake = {
    schemaVersion: 1,
    manifestDigest: contractDigest(manifest),
    buildDigest: digest,
    runs: [{
      runId: 'fabricated-run',
      scenarioId: 'not-registered',
      scenarioSampleIndex: 1,
      manifestDigest: 'b'.repeat(64),
      buildDigest: 'c'.repeat(64),
      environmentDigest: 'd'.repeat(64),
      modelReceipt: null,
      results: registry.metrics.flatMap((metric) => Array.from(
        { length: metric.denominator.planned },
        (_, index) => ({
          metricId: metric.id,
          sampleIndex: index + 1,
          status: 'PASS',
          evidenceRefs: [],
        }),
      )),
    }],
  };

  const errors = validateRunBundle(registry, manifest, fake, schema, { expectedBuildDigest: digest }).join('\n');
  assert.match(errors, /등록되지 않은 시나리오/);
  assert.match(errors, /manifestDigest/);
  assert.match(errors, /buildDigest/);
  assert.match(errors, /증거/);
  assert.throws(() => computeScoreboard(
    registry, manifest, fake, schema, { expectedBuildDigest: digest },
  ), /점수 입력 계약 위반/);
});

test('같은 실행과 같은 지표 표본은 중복 가산할 수 없다', async () => {
  const [registry, manifest, schema] = await Promise.all([json(REGISTRY), json(MANIFEST), json(SCHEMA)]);
  const { contractDigest, validateRunBundle } = await scoring();
  const metric = registry.metrics.find((entry) => entry.id === 'intent.current');
  const scenario = manifest.scenarios.find((entry) => entry.id === 'p90-01-short-intent');
  const evidenceRefs = metric.evidence.map((kind) => ({ kind, digest: 'e'.repeat(64) }));
  const result = { metricId: metric.id, sampleIndex: 1, status: 'PASS', evidenceRefs };
  const run = {
    runId: 'duplicate-run',
    scenarioId: scenario.id,
    scenarioSampleIndex: 1,
    manifestDigest: contractDigest(manifest),
    buildDigest: 'a'.repeat(64),
    environmentDigest: contractDigest(scenario.environment),
    modelReceipt: null,
    results: [result, structuredClone(result)],
  };
  const bundle = {
    schemaVersion: 1,
    manifestDigest: contractDigest(manifest),
    buildDigest: 'a'.repeat(64),
    runs: [run, structuredClone(run)],
  };

  const errors = validateRunBundle(
    registry, manifest, bundle, schema, { expectedBuildDigest: 'a'.repeat(64) },
  ).join('\n');
  assert.match(errors, /runId 중복/);
  assert.match(errors, /시나리오 표본 중복/);
  assert.match(errors, /지표 표본 중복/);
});

test('유효한 일부 표본은 집계하되 미측정 분모를 완료로 만들지 않는다', async () => {
  const [registry, manifest, schema] = await Promise.all([json(REGISTRY), json(MANIFEST), json(SCHEMA)]);
  const { computeScoreboard, contractDigest, validateRunBundle } = await scoring();
  const buildDigest = 'a'.repeat(64);
  const scenario = manifest.scenarios.find((entry) => entry.id === 'p90-01-short-intent');
  const metric = registry.metrics.find((entry) => entry.id === 'intent.current');
  const bundle = {
    schemaVersion: 1,
    manifestDigest: contractDigest(manifest),
    buildDigest,
    runs: [{
      runId: 'short-intent-1',
      scenarioId: scenario.id,
      scenarioSampleIndex: 1,
      manifestDigest: contractDigest(manifest),
      buildDigest,
      environmentDigest: contractDigest(scenario.environment),
      modelReceipt: null,
      results: [{
        metricId: metric.id,
        sampleIndex: 1,
        status: 'PASS',
        evidenceRefs: metric.evidence.map((kind) => ({ kind, digest: 'e'.repeat(64) })),
      }],
    }],
  };

  assert.deepEqual(validateRunBundle(
    registry, manifest, bundle, schema, { expectedBuildDigest: buildDigest },
  ), []);
  const scored = computeScoreboard(
    registry, manifest, bundle, schema, { expectedBuildDigest: buildDigest },
  );
  assert.equal(scored.metrics['intent.current'].passed, 1);
  assert.equal(scored.metrics['intent.current'].complete, false);
  assert.equal(scored.projections.p90['P90-1'].score, null);
});

test('지표 표본을 모두 채워도 사전 등록 시나리오 회차가 비면 최종 점수를 내지 않는다', async () => {
  const [registry, manifest, schema] = await Promise.all([json(REGISTRY), json(MANIFEST), json(SCHEMA)]);
  const { computeScoreboard, contractDigest } = await scoring();
  const buildDigest = 'a'.repeat(64);
  const runs = new Map();
  for (const metric of registry.metrics) {
    const scenario = manifest.scenarios.find((entry) => entry.metrics.includes(metric.id));
    if (!runs.has(scenario.id)) {
      runs.set(scenario.id, {
        runId: `collapsed-${scenario.id}`,
        scenarioId: scenario.id,
        scenarioSampleIndex: 1,
        manifestDigest: contractDigest(manifest),
        buildDigest,
        environmentDigest: contractDigest(scenario.environment),
        modelReceipt: null,
        results: [],
      });
    }
    const run = runs.get(scenario.id);
    if (metric.evidence.some((kind) => ['model-receipt', 'provider-receipt'].includes(kind))) {
      run.modelReceipt = { provider: 'fixture', model: 'fixture', receiptDigest: 'd'.repeat(64) };
    }
    for (let sampleIndex = 1; sampleIndex <= metric.denominator.planned; sampleIndex += 1) {
      run.results.push({
        metricId: metric.id,
        sampleIndex,
        status: 'PASS',
        evidenceRefs: metric.evidence.map((kind) => ({ kind, digest: 'e'.repeat(64) })),
      });
    }
  }
  const bundle = {
    schemaVersion: 1, manifestDigest: contractDigest(manifest), buildDigest, runs: [...runs.values()],
  };
  const scored = computeScoreboard(
    registry, manifest, bundle, schema, { expectedBuildDigest: buildDigest },
  );
  assert.ok(Object.values(scored.metrics).every((metric) => metric.complete && metric.ratio === 1));
  assert.equal(scored.runCoverage.complete, false);
  assert.equal(scored.projections.p90['P90-1'].score, null);
  assert.equal(scored.projections.p90['P90-1'].qualifies90, false);
  assert.ok(scored.projections.p90['P90-1'].reasons.includes('미완료시나리오표본'));
});

test('미실행과 실패는 성공 증거 대신 상태 영수증으로 정직하게 기록할 수 있다', async () => {
  const [registry, manifest, schema] = await Promise.all([json(REGISTRY), json(MANIFEST), json(SCHEMA)]);
  const { contractDigest, validateRunBundle } = await scoring();
  const scenario = manifest.scenarios.find((entry) => entry.id === 'p90-01-short-intent');
  const bundle = {
    schemaVersion: 1, manifestDigest: contractDigest(manifest), buildDigest: 'a'.repeat(64),
    runs: [{
      runId: 'not-run-1', scenarioId: scenario.id, scenarioSampleIndex: 1,
      manifestDigest: contractDigest(manifest), buildDigest: 'a'.repeat(64),
      environmentDigest: contractDigest(scenario.environment), modelReceipt: null,
      results: [{
        metricId: 'intent.current', sampleIndex: 1, status: 'NOT_RUN',
        evidenceRefs: [{ kind: 'status-receipt', digest: 'e'.repeat(64) }],
      }],
    }],
  };
  assert.deepEqual(validateRunBundle(
    registry, manifest, bundle, schema, { expectedBuildDigest: 'a'.repeat(64) },
  ), []);
});

test('bundle의 build 신분은 호출자가 별도로 고정한 신뢰 기준과 일치해야 한다', async () => {
  const [registry, manifest, schema] = await Promise.all([json(REGISTRY), json(MANIFEST), json(SCHEMA)]);
  const { contractDigest, validateRunBundle } = await scoring();
  const bundle = {
    schemaVersion: 1,
    manifestDigest: contractDigest(manifest),
    buildDigest: 'b'.repeat(64),
    runs: [],
  };
  const errors = validateRunBundle(
    registry, manifest, bundle, schema, { expectedBuildDigest: 'a'.repeat(64) },
  ).join('\n');
  assert.match(errors, /buildDigest가 신뢰 기준과 불일치/);
});

test('schema는 임의 필드와 원시 문자열 증거를 점수 입구에서 거부한다', async () => {
  const [registry, manifest, schema] = await Promise.all([json(REGISTRY), json(MANIFEST), json(SCHEMA)]);
  const { contractDigest, validateRunBundle } = await scoring();
  const scenario = manifest.scenarios[0];
  const bundle = {
    schemaVersion: 1,
    manifestDigest: contractDigest(manifest),
    buildDigest: 'a'.repeat(64),
    rawPrompt: '저장하면 안 되는 원문',
    runs: [{
      runId: 'bad-shape', scenarioId: scenario.id, scenarioSampleIndex: 1,
      manifestDigest: contractDigest(manifest), buildDigest: 'a'.repeat(64),
      environmentDigest: contractDigest(scenario.environment), modelReceipt: null,
      results: [{ metricId: 'intent.current', sampleIndex: 1, status: 'PASS', evidenceRefs: ['local/path'] }],
    }],
  };
  const errors = validateRunBundle(
    registry, manifest, bundle, schema, { expectedBuildDigest: 'a'.repeat(64) },
  ).join('\n');
  assert.match(errors, /rawPrompt: 알 수 없는 필드/);
  assert.match(errors, /evidenceRefs\[0\]: 자료형 불일치/);
});

test('점수 CLI도 같은 schema와 신뢰 build 경계를 실제로 적용한다', async () => {
  const [registry, manifest] = await Promise.all([json(REGISTRY), json(MANIFEST)]);
  const { contractDigest } = await scoring();
  const buildDigest = 'a'.repeat(64);
  const scenario = manifest.scenarios[0];
  const metric = registry.metrics.find((entry) => entry.id === 'intent.current');
  const bundle = {
    schemaVersion: 1, manifestDigest: contractDigest(manifest), buildDigest,
    runs: [{
      runId: 'cli-1', scenarioId: scenario.id, scenarioSampleIndex: 1,
      manifestDigest: contractDigest(manifest), buildDigest,
      environmentDigest: contractDigest(scenario.environment), modelReceipt: null,
      results: [{
        metricId: metric.id, sampleIndex: 1, status: 'PASS',
        evidenceRefs: metric.evidence.map((kind) => ({ kind, digest: 'e'.repeat(64) })),
      }],
    }],
  };
  const dir = await mkdtemp(join(tmpdir(), 't5-p90-score-'));
  const validPath = join(dir, 'valid.json');
  const invalidPath = join(dir, 'invalid.json');
  try {
    await writeFile(validPath, JSON.stringify(bundle));
    await writeFile(invalidPath, JSON.stringify({ ...bundle, rawPrompt: '저장하면 안 되는 원문' }));
    const valid = spawnSync(process.execPath, [SCORER, REGISTRY, validPath, MANIFEST, buildDigest], { encoding: 'utf8' });
    const invalid = spawnSync(process.execPath, [SCORER, REGISTRY, invalidPath, MANIFEST, buildDigest], { encoding: 'utf8' });
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(JSON.parse(valid.stdout).metrics['intent.current'].passed, 1);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /rawPrompt: 알 수 없는 필드/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('모델 증거가 필요한 지표는 구조화된 모델 영수증 없이는 점수화되지 않는다', async () => {
  const [registry, manifest, schema] = await Promise.all([json(REGISTRY), json(MANIFEST), json(SCHEMA)]);
  const { contractDigest, validateRunBundle } = await scoring();
  const scenario = manifest.scenarios.find((entry) => entry.id === 'p90-22-latency-chat-file');
  const metric = registry.metrics.find((entry) => entry.id === 'model.portability');
  const bundle = {
    schemaVersion: 1, manifestDigest: contractDigest(manifest), buildDigest: 'a'.repeat(64),
    runs: [{
      runId: 'portability-1', scenarioId: scenario.id, scenarioSampleIndex: 1,
      manifestDigest: contractDigest(manifest), buildDigest: 'a'.repeat(64),
      environmentDigest: contractDigest(scenario.environment), modelReceipt: null,
      results: [{
        metricId: metric.id, sampleIndex: 1, status: 'PASS',
        evidenceRefs: metric.evidence.map((kind) => ({ kind, digest: 'e'.repeat(64) })),
      }],
    }],
  };
  const errors = validateRunBundle(
    registry, manifest, bundle, schema, { expectedBuildDigest: 'a'.repeat(64) },
  ).join('\n');
  assert.match(errors, /모델 영수증 누락/);
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
  const [registry, manifest, schema] = await Promise.all([json(REGISTRY), json(MANIFEST), json(SCHEMA)]);
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

  const empty = computeScoreboard(registry, manifest, null, schema);
  assert.equal(empty.projections.p90['P90-1'].score, null, '미측정은 0점으로 가장하지 않는다');
  assert.equal(empty.projections.p90['P90-1'].complete, false);
});
