import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(here, 'scenarios.json'), 'utf8'));
const input = process.argv[2];
if (!input) throw new Error('usage: npm run human-use:verify -- <evidence.json>');
const evidence = JSON.parse(await readFile(resolve(input), 'utf8'));
const failures = [];
const requiredIds = manifest.suites[evidence.suite] ?? [];
const byId = new Map((evidence.scenarios ?? []).map((s) => [s.id, s]));

if (evidence.schemaVersion !== 1 || evidence.manifestVersion !== manifest.version) failures.push('schema_or_manifest_version');
if (evidence.actualBrowser !== true) failures.push('actual_browser_not_proven');
if (evidence.isolated !== true) failures.push('isolation_not_proven');
if (!evidence.model || /stub/i.test(evidence.model)) failures.push('actual_model_not_proven');
if (!evidence.productCommit) failures.push('product_commit_missing');
if (!evidence.startedAt || !evidence.finishedAt) failures.push('run_time_missing');
if ((evidence.p0 ?? []).length) failures.push('p0_present');

for (const id of requiredIds) {
  const scenario = byId.get(id);
  const contract = manifest.scenarios.find((s) => s.id === id);
  if (!scenario) { failures.push(`${id}:missing`); continue; }
  if (!['pass', 'fail', 'blocked'].includes(scenario.status)) failures.push(`${id}:status`);
  if (scenario.status !== 'pass' && !['product', 'model', 'test_agent', 'environment'].includes(scenario.attribution)) {
    failures.push(`${id}:attribution`);
  }
  const checks = new Map((scenario.checks ?? []).map((c) => [c.id, c]));
  for (const checkId of contract.requiredChecks) {
    const check = checks.get(checkId);
    if (!check || typeof check.pass !== 'boolean' || !String(check.evidence ?? '').trim()) {
      failures.push(`${id}:${checkId}:unproven`);
    } else if (!check.pass && scenario.status === 'pass') {
      failures.push(`${id}:${checkId}:failed_but_scenario_passed`);
    }
  }
  if (!(scenario.turns ?? []).length) failures.push(`${id}:no_visible_turns`);
}

if (evidence.status === 'pass' && [...byId.values()].some((s) => s.status !== 'pass')) failures.push('run_pass_with_nonpass_scenario');
if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, suite: evidence.suite, scenarios: requiredIds.length }, null, 2));
