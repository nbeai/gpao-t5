#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REGISTRY = join(HERE, 'metric-registry.json');
const DEFAULT_MANIFEST = join(HERE, 'scenario-manifest.json');
const DEFAULT_SCHEMA = join(HERE, 'production90.schema.json');
export const RESULT_STATUSES = Object.freeze([
  'PASS', 'PRODUCT_FAIL', 'MODEL_FAIL', 'EXTERNAL_BLOCKED', 'HARNESS_INVALID', 'NOT_RUN',
]);

const rounded = (value) => Math.round((value + Number.EPSILON) * 10000) / 10000;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function contractDigest(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function resolveSchemaRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`외부 schema ref는 지원하지 않음: ${ref}`);
  return ref.slice(2).split('/').reduce((current, part) => current?.[part.replaceAll('~1', '/').replaceAll('~0', '~')], root);
}

function matchesType(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function validateSchemaNode(root, schema, value, path, errors) {
  if (!schema) {
    errors.push(`${path}: schema 정의 없음`);
    return;
  }
  if (schema.$ref) {
    validateSchemaNode(root, resolveSchemaRef(root, schema.$ref), value, path, errors);
    return;
  }
  if (schema.oneOf) {
    const branches = schema.oneOf.map((branch) => {
      const branchErrors = [];
      validateSchemaNode(root, branch, value, path, branchErrors);
      return branchErrors;
    });
    if (branches.filter((branch) => branch.length === 0).length !== 1) errors.push(`${path}: oneOf 불일치`);
    return;
  }
  if ('const' in schema && stableJson(value) !== stableJson(schema.const)) errors.push(`${path}: const 불일치`);
  if (schema.enum && !schema.enum.some((entry) => stableJson(entry) === stableJson(value))) {
    errors.push(`${path}: 허용되지 않은 값`);
  }
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.some((type) => matchesType(value, type))) {
      errors.push(`${path}: 자료형 불일치`);
      return;
    }
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: 문자열 길이 부족`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: 문자열 형식 불일치`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: 최솟값 미달`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: 최댓값 초과`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: 항목 수 부족`);
    if (schema.uniqueItems && new Set(value.map(stableJson)).size !== value.length) errors.push(`${path}: 중복 항목`);
    if (schema.items) value.forEach((item, index) => validateSchemaNode(root, schema.items, item, `${path}[${index}]`, errors));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) {
      if (!(required in value)) errors.push(`${path}.${required}: 필수 필드 누락`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!(key in properties)) errors.push(`${path}.${key}: 알 수 없는 필드`);
    }
    for (const [key, child] of Object.entries(properties)) {
      if (key in value) validateSchemaNode(root, child, value[key], `${path}.${key}`, errors);
    }
  }
}

export function validateJsonSchema(schema, value) {
  const errors = [];
  validateSchemaNode(schema, schema, value, '$', errors);
  return errors;
}

export function scoreMetric(metric, results = []) {
  const planned = metric.denominator.planned ?? results.length;
  const valid = results.filter((result) => RESULT_STATUSES.includes(result.status));
  const invalidHarness = valid.filter((result) => result.status === 'HARNESS_INVALID').length;
  const passed = valid.filter((result) => result.status === 'PASS').length;
  const failed = valid.filter((result) => result.status !== 'PASS' && result.status !== 'HARNESS_INVALID').length;
  const missing = Math.max(0, planned - valid.length);
  const unexpected = Math.max(0, valid.length - planned);
  const allDeterministicPassed = metric.kind !== 'deterministic'
    || (passed === planned && failed === 0 && invalidHarness === 0 && missing === 0 && unexpected === 0);
  const ratio = valid.length === 0 ? null : (metric.kind === 'deterministic'
    ? (allDeterministicPassed ? 1 : 0)
    : rounded(Math.min(1, passed / Math.max(1, planned))));
  const p0 = results.some((result) => result.p0 === true)
    || (metric.hardGate === 'P0' && results.some((result) => result.status === 'PRODUCT_FAIL'));
  return {
    ratio,
    passed,
    failed,
    denominator: planned,
    complete: missing === 0 && unexpected === 0 && invalidHarness === 0,
    targetMet: ratio !== null && ratio >= metric.passRule.target,
    p0,
  };
}

export function scoreProjection(projection, metricScores) {
  const axes = Object.fromEntries(Object.keys(projection.axes ?? {}).map((axis) => [axis, 0]));
  const axisMaximums = Object.fromEntries(Object.keys(projection.axes ?? {}).map((axis) => [axis, 0]));
  let score = 0;
  let complete = true;
  let blocked = false;
  const reasons = [];

  for (const entry of projection.metrics) {
    const measured = metricScores[entry.metricId];
    if (!measured) {
      complete = false;
      reasons.push(`미측정:${entry.metricId}`);
      continue;
    }
    if (measured.ratio === null) {
      complete = false;
      reasons.push(`미측정:${entry.metricId}`);
      continue;
    }
    const earned = entry.weight * measured.ratio;
    score += earned;
    if (entry.axis) {
      axes[entry.axis] = (axes[entry.axis] ?? 0) + earned;
      axisMaximums[entry.axis] = (axisMaximums[entry.axis] ?? 0) + entry.weight;
    }
    if (!measured.complete) complete = false;
    if (measured.p0) blocked = true;
  }

  score = rounded(score);
  for (const axis of Object.keys(axes)) axes[axis] = rounded(axes[axis]);
  const weakAxes = Object.keys(axes).filter((axis) => {
    const maximum = axisMaximums[axis] || projection.axes?.[axis] || 0;
    return maximum > 0 && axes[axis] / maximum < 0.8;
  });
  if (blocked) reasons.push('P0');
  for (const axis of weakAxes) reasons.push(`축80%미달:${axis}`);
  if (!complete && !reasons.some((reason) => reason.startsWith('미측정:'))) reasons.push('미완료표본');
  return {
    score: complete ? score : null,
    axes,
    complete,
    blocked,
    qualifies90: complete && !blocked && weakAxes.length === 0 && score >= 90,
    reasons,
  };
}

export function validateRegistry(registry) {
  const errors = [];
  if (registry.schemaVersion !== 1 || registry.sourceOfTruth !== true) errors.push('정본 머리말');
  const ids = registry.metrics.map((metric) => metric.id);
  const facts = registry.metrics.map((metric) => metric.factKey);
  if (new Set(ids).size !== ids.length) errors.push('metric id 중복');
  if (new Set(facts).size !== facts.length) errors.push('factKey 중복');
  const known = new Set(ids);
  for (const [groupName, group] of Object.entries(registry.projections)) {
    for (const [id, projection] of Object.entries(group)) {
      const total = projection.metrics.reduce((sum, entry) => sum + entry.weight, 0);
      if (total !== 100) errors.push(`${groupName}.${id} 배점 ${total}`);
      const refs = projection.metrics.map((entry) => entry.metricId);
      if (new Set(refs).size !== refs.length) errors.push(`${groupName}.${id} 중복 가산`);
      for (const ref of refs) if (!known.has(ref)) errors.push(`${groupName}.${id} 알 수 없는 지표 ${ref}`);
      if ('score' in projection) errors.push(`${groupName}.${id} 수기 점수`);
      if (projection.axes) {
        for (const [axis, expected] of Object.entries(projection.axes)) {
          const actual = projection.metrics.filter((entry) => entry.axis === axis)
            .reduce((sum, entry) => sum + entry.weight, 0);
          if (actual !== expected) errors.push(`${groupName}.${id} ${axis} 배점 ${actual}`);
        }
      }
    }
  }
  return errors;
}

export function validateManifest(registry, manifest) {
  const errors = [];
  if (manifest.schemaVersion !== 1) errors.push('manifest schemaVersion');
  const known = new Set(registry.metrics.map((metric) => metric.id));
  const ids = manifest.scenarios.map((scenario) => scenario.id);
  if (new Set(ids).size !== ids.length) errors.push('scenario id 중복');
  if (manifest.scenarios.length < 24) errors.push('실사용 여정 24개 미달');
  for (const scenario of manifest.scenarios) {
    if (!['deterministic', 'variable', 'human'].includes(scenario.kind)) errors.push(`${scenario.id} 판정 종류`);
    if (!Number.isInteger(scenario.denominator?.planned) || scenario.denominator.planned < 1) {
      errors.push(`${scenario.id} 분모`);
    }
    if (scenario.privacy?.rawSecrets !== false) errors.push(`${scenario.id} 원시 비밀`);
    if (!scenario.failurePolicy?.providerError) errors.push(`${scenario.id} 외부 실패 정책`);
    const refs = scenario.metrics ?? [];
    if (new Set(refs).size !== refs.length) errors.push(`${scenario.id} 지표 중복`);
    for (const ref of refs) if (!known.has(ref)) errors.push(`${scenario.id} 알 수 없는 지표 ${ref}`);
  }
  const covered = new Set(manifest.scenarios.flatMap((scenario) => scenario.metrics ?? []));
  for (const metric of registry.metrics) if (!covered.has(metric.id)) errors.push(`측정 시나리오 없는 지표 ${metric.id}`);
  return errors;
}

export function validateRunBundle(registry, manifest, bundle, schema, options = {}) {
  const errors = validateJsonSchema(schema, bundle).map((error) => `schema ${error}`);
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return errors;

  const expectedManifestDigest = contractDigest(manifest);
  if (bundle.manifestDigest !== expectedManifestDigest) errors.push('bundle manifestDigest 불일치');
  if (!/^[a-f0-9]{64}$/.test(options.expectedBuildDigest ?? '')) {
    errors.push('신뢰 기준 buildDigest 누락');
  } else if (bundle.buildDigest !== options.expectedBuildDigest) {
    errors.push('bundle buildDigest가 신뢰 기준과 불일치');
  }
  const metrics = new Map(registry.metrics.map((metric) => [metric.id, metric]));
  const scenarios = new Map(manifest.scenarios.map((scenario) => [scenario.id, scenario]));
  const runIds = new Set();
  const scenarioSlots = new Set();
  const metricSlots = new Set();

  for (const [runIndex, run] of (Array.isArray(bundle.runs) ? bundle.runs : []).entries()) {
    if (!run || typeof run !== 'object' || Array.isArray(run)) continue;
    const label = `runs[${runIndex}]`;
    if (runIds.has(run.runId)) errors.push(`${label} runId 중복 ${run.runId}`);
    runIds.add(run.runId);

    const scenario = scenarios.get(run.scenarioId);
    if (!scenario) errors.push(`${label} 등록되지 않은 시나리오 ${run.scenarioId}`);
    if (run.manifestDigest !== expectedManifestDigest) errors.push(`${label} manifestDigest 불일치`);
    if (run.buildDigest !== bundle.buildDigest) errors.push(`${label} buildDigest 불일치`);
    if (scenario && run.environmentDigest !== contractDigest(scenario.environment)) {
      errors.push(`${label} environmentDigest 불일치`);
    }
    if (scenario && (!Number.isInteger(run.scenarioSampleIndex)
      || run.scenarioSampleIndex < 1 || run.scenarioSampleIndex > scenario.denominator.planned)) {
      errors.push(`${label} 시나리오 표본 범위 이탈`);
    }
    const scenarioSlot = `${run.scenarioId}:${run.scenarioSampleIndex}`;
    if (scenarioSlots.has(scenarioSlot)) errors.push(`${label} 시나리오 표본 중복 ${scenarioSlot}`);
    scenarioSlots.add(scenarioSlot);

    for (const [resultIndex, result] of (Array.isArray(run.results) ? run.results : []).entries()) {
      if (!result || typeof result !== 'object' || Array.isArray(result)) continue;
      const resultLabel = `${label}.results[${resultIndex}]`;
      const metric = metrics.get(result.metricId);
      if (!metric) {
        errors.push(`${resultLabel} 등록되지 않은 지표 ${result.metricId}`);
        continue;
      }
      if (scenario && !scenario.metrics.includes(metric.id)) {
        errors.push(`${resultLabel} 시나리오에 귀속되지 않은 지표 ${metric.id}`);
      }
      if (!Number.isInteger(result.sampleIndex)
        || result.sampleIndex < 1 || result.sampleIndex > metric.denominator.planned) {
        errors.push(`${resultLabel} 지표 표본 범위 이탈`);
      }
      const metricSlot = `${metric.id}:${result.sampleIndex}`;
      if (metricSlots.has(metricSlot)) errors.push(`${resultLabel} 지표 표본 중복 ${metricSlot}`);
      metricSlots.add(metricSlot);

      const evidenceRefs = Array.isArray(result.evidenceRefs) ? result.evidenceRefs : [];
      const evidenceKinds = evidenceRefs.map((entry) => entry?.kind).filter(Boolean);
      if (evidenceRefs.length === 0) errors.push(`${resultLabel} 증거 없음`);
      if (new Set(evidenceKinds).size !== evidenceKinds.length) errors.push(`${resultLabel} 증거 종류 중복`);
      const passed = result.status === 'PASS';
      const requiredEvidence = passed ? metric.evidence : ['status-receipt'];
      for (const required of requiredEvidence) if (!evidenceKinds.includes(required)) {
        errors.push(`${resultLabel} 필수 증거 누락 ${required}`);
      }
      const allowedEvidence = new Set([...metric.evidence, 'status-receipt']);
      for (const kind of evidenceKinds) {
        if (!allowedEvidence.has(kind)) errors.push(`${resultLabel} 등록되지 않은 증거 종류 ${kind}`);
      }
      const needsModelReceipt = metric.evidence.some((kind) => ['model-receipt', 'provider-receipt'].includes(kind));
      if (passed && needsModelReceipt && !run.modelReceipt) errors.push(`${resultLabel} 모델 영수증 누락`);
    }
  }
  return errors;
}

export function computeScoreboard(registry, manifest, bundle = null, schema = null, options = {}) {
  if (bundle) {
    const errors = validateRunBundle(registry, manifest, bundle, schema, options);
    if (errors.length) throw new Error(`점수 입력 계약 위반\n${errors.join('\n')}`);
  }
  const runs = bundle?.runs ?? [];
  const byMetric = new Map();
  for (const run of runs) {
    for (const result of run.results ?? []) {
      if (!byMetric.has(result.metricId)) byMetric.set(result.metricId, []);
      byMetric.get(result.metricId).push(result);
    }
  }
  const metrics = Object.fromEntries(registry.metrics.map((metric) => [
    metric.id,
    scoreMetric(metric, byMetric.get(metric.id) ?? []),
  ]));
  const expectedScenarioSlots = manifest.scenarios.reduce((sum, scenario) => sum + scenario.denominator.planned, 0);
  const observedScenarioSlots = new Set(runs.map((run) => `${run.scenarioId}:${run.scenarioSampleIndex}`)).size;
  const runCoverage = {
    observed: observedScenarioSlots,
    planned: expectedScenarioSlots,
    complete: observedScenarioSlots === expectedScenarioSlots,
  };
  const projections = Object.fromEntries(Object.entries(registry.projections).map(([group, entries]) => [
    group,
    Object.fromEntries(Object.entries(entries).map(([id, projection]) => {
      const scored = scoreProjection(projection, metrics);
      if (!runCoverage.complete) {
        scored.score = null;
        scored.complete = false;
        scored.qualifies90 = false;
        if (!scored.reasons.includes('미완료시나리오표본')) scored.reasons.push('미완료시나리오표본');
      }
      return [id, scored];
    })),
  ]));
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), runCoverage, metrics, projections };
}

async function main() {
  const registryPath = resolve(process.argv[2] ?? DEFAULT_REGISTRY);
  const resultPath = process.argv[3] ? resolve(process.argv[3]) : null;
  const manifestPath = resolve(process.argv[4] ?? DEFAULT_MANIFEST);
  const expectedBuildDigest = process.argv[5] ?? process.env.T5_PRODUCTION90_BUILD_DIGEST ?? null;
  const [registry, manifest, schema] = await Promise.all([
    readFile(registryPath, 'utf8').then(JSON.parse),
    readFile(manifestPath, 'utf8').then(JSON.parse),
    readFile(DEFAULT_SCHEMA, 'utf8').then(JSON.parse),
  ]);
  const errors = [...validateRegistry(registry), ...validateManifest(registry, manifest)];
  if (errors.length) {
    for (const error of errors) console.error(`FAIL · ${error}`);
    process.exitCode = 1;
    return;
  }
  const bundle = resultPath ? JSON.parse(await readFile(resultPath, 'utf8')) : null;
  try {
    console.log(JSON.stringify(computeScoreboard(
      registry, manifest, bundle, schema, { expectedBuildDigest },
    ), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
