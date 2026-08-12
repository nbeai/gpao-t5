#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REGISTRY = join(HERE, 'metric-registry.json');
export const RESULT_STATUSES = Object.freeze([
  'PASS', 'PRODUCT_FAIL', 'MODEL_FAIL', 'EXTERNAL_BLOCKED', 'HARNESS_INVALID', 'NOT_RUN',
]);

const rounded = (value) => Math.round((value + Number.EPSILON) * 10000) / 10000;

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
  return errors;
}

export function computeScoreboard(registry, runs = []) {
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
  const projections = Object.fromEntries(Object.entries(registry.projections).map(([group, entries]) => [
    group,
    Object.fromEntries(Object.entries(entries).map(([id, projection]) => [id, scoreProjection(projection, metrics)])),
  ]));
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), metrics, projections };
}

async function main() {
  const registryPath = resolve(process.argv[2] ?? DEFAULT_REGISTRY);
  const resultPath = process.argv[3] ? resolve(process.argv[3]) : null;
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  const errors = validateRegistry(registry);
  if (errors.length) {
    for (const error of errors) console.error(`FAIL · ${error}`);
    process.exitCode = 1;
    return;
  }
  const runs = resultPath ? JSON.parse(await readFile(resultPath, 'utf8')).runs ?? [] : [];
  console.log(JSON.stringify(computeScoreboard(registry, runs), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
