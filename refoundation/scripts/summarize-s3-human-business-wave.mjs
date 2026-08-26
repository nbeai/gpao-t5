#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  loadS3HumanBusinessScenarios, planS3HumanBusinessWave,
} from '../src/s3-human-business-scenarios.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function options(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return values;
}

const waveId = option('--wave');
if (!waveId) throw new Error('--wave is required');
const rooms = options('--room').map((path) => resolve(path));
if (rooms.length === 0) throw new Error('at least one --room is required');

const catalog = await loadS3HumanBusinessScenarios();
const plan = planS3HumanBusinessWave(catalog, waveId);
const expectedIds = new Set(plan.scenarios.map((item) => item.id));
const summaries = await Promise.all(rooms.map(async (room) => {
  const summary = JSON.parse(await readFile(join(room, 'tester-control', 'run-summary.json'), 'utf8'));
  if (summary?.schema !== 't5.s3.human-business-live-summary.v1') {
    throw new Error(`invalid business summary in ${room}`);
  }
  if (!expectedIds.has(summary.scenario?.id)) {
    throw new Error(`scenario ${summary.scenario?.id} is outside wave ${waveId}`);
  }
  return { room, summary };
}));

const latest = new Map();
for (const entry of summaries) {
  const key = `${entry.summary.scenario.id}\u0000${entry.summary.model?.modelId ?? 'unknown'}`;
  const previous = latest.get(key);
  if (!previous || Date.parse(entry.summary.summarizedAt) >= Date.parse(previous.summary.summarizedAt)) {
    latest.set(key, entry);
  }
}

const scenarioResults = plan.scenarios.map((scenario) => {
  const runs = [...latest.values()].filter((entry) => entry.summary.scenario.id === scenario.id);
  let state = 'not_run';
  if (runs.length > 0) {
    if (runs.some((entry) => entry.summary.verdict === 'failed')) state = 'failed';
    else if (runs.some((entry) => entry.summary.verdict !== 'passed')) state = 'pending_human_review';
    else state = 'passed';
  }
  return {
    ...scenario,
    state,
    runs: runs.map((entry) => ({
      room: entry.room,
      sourceCommit: entry.summary.sourceCommit,
      model: entry.summary.model,
      verdict: entry.summary.verdict,
      failedCriteria: entry.summary.failureRoutingInput?.failedCriteria ?? [],
      observedFailureFamilies: entry.summary.failureRoutingInput?.observedFailureFamilies ?? [],
      wallMs: entry.summary.machineObservation?.runSummaries
        ?.reduce((sum, item) => sum + Number(item.wallMs ?? 0), 0) ?? null,
      modelCalls: entry.summary.machineObservation?.modelCalls ?? null,
      toolCalls: entry.summary.machineObservation?.toolCalls ?? null,
      providerTokens: entry.summary.machineObservation?.providerTokens ?? null,
    })),
  };
});

const counts = Object.fromEntries(['passed', 'failed', 'pending_human_review', 'not_run']
  .map((state) => [state, scenarioResults.filter((item) => item.state === state).length]));
const laneCounts = Object.fromEntries(['observed_demand', 'workflow_coverage', 'structural_stress']
  .map((role) => [role, {
    expected: scenarioResults.filter((item) => item.portfolioRole === role).length,
    passed: scenarioResults.filter((item) => item.portfolioRole === role && item.state === 'passed').length,
  }]));
const failureFamilies = [...new Set(scenarioResults.flatMap((scenario) => (
  scenario.runs.flatMap((run) => run.observedFailureFamilies)
)))].sort();
const verdict = counts.failed > 0 ? 'failed'
  : (counts.not_run > 0 || counts.pending_human_review > 0 ? 'incomplete' : 'passed');

const report = {
  schema: 't5.s3.human-business-wave-summary.v1',
  wave: { id: plan.id, purpose: plan.purpose, modelPolicy: plan.modelPolicy, close: plan.close },
  verdict,
  counts,
  laneCounts,
  failureFamilies,
  scenarioResults,
  routingRule: catalog.failureRouting,
  nonClaims: [
    'This report does not turn a research-derived scenario into measured demand.',
    'A wave PASS does not qualify real accounts or real external writes.',
    'Failure-family routing remains a product judgment; the aggregator does not patch prompts or code.',
  ],
};

const output = option('--output');
if (output) await writeFile(resolve(output), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
