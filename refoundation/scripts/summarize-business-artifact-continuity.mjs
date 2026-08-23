#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { assessBusinessArtifactContinuity } from '../src/business-artifact-continuity.js';

function option(name) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; }
const requestedInputs = [option('--terra'), option('--gpt55')];
if (requestedInputs.some((path) => !path)) throw new TypeError('--terra and --gpt55 are required');
const inputs = requestedInputs.map((path) => resolve(path));
const output = option('--evidence') ? resolve(option('--evidence')) : null;
const sourceRuns = await Promise.all(inputs.map((path) => readFile(path, 'utf8').then(JSON.parse)));
const verdict = assessBusinessArtifactContinuity(sourceRuns);
const runs = sourceRuns.map((run) => ({
  model: run.model, provider: run.provider, naturalLanguageTurns: run.naturalLanguageTurns,
  performance: run.performance, checks: run.checks, fileRoundTrip: run.fileRoundTrip,
  finalState: run.finalState,
  restartReport: run.turns?.find((turn) => turn.id === 'restart-continuity')?.answer ?? null,
  passed: run.passed,
}));
const evidence = {
  schema: 't5.w7-business-browser-artifact-continuity.v1', recordedAt: new Date().toISOString(),
  actualUserData: false, actualBusinessAccount: false, harnessInjectedDownloadPath: false,
  runs, verdict, boundaries: {
    productionSmartStoreAccount: 'not_tested', sessionOnlyLoginMayRequireLoginAgain: true,
    artifactPersistsIndependentlyOfLogin: true, firstExternalWriteUsesLoopbackOnly: true,
  },
  passed: verdict.passed,
};
const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, serialized, 'utf8'); }
process.stdout.write(serialized); if (!evidence.passed) process.exitCode = 1;
