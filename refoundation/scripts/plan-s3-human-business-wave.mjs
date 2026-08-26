#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  auditS3HumanBusinessPortfolio, loadS3HumanBusinessScenarios, planS3HumanBusinessWave,
} from '../src/s3-human-business-scenarios.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const catalog = await loadS3HumanBusinessScenarios();
const audit = auditS3HumanBusinessPortfolio(catalog);
if (process.argv.includes('--audit')) {
  console.log(JSON.stringify({ schema: 't5.s3.human-business-portfolio-audit.v1', ...audit }, null, 2));
  process.exit(0);
}

const waveId = option('--wave');
if (!waveId) throw new Error('--wave is required, or use --audit');
const wave = planS3HumanBusinessWave(catalog, waveId);
const plan = {
  ...wave,
  execution: wave.scenarios.map((scenario) => ({
    scenarioId: scenario.id,
    command: [
      'npm', 'run', 'refoundation:qualify:business-human', '--',
      '--scenario', scenario.id,
      ...(scenario.qualificationStatus === 'source_grounded'
        ? [] : ['--include-research-derived']),
    ],
    state: 'not_run',
  })),
  nonClaims: [
    'This plan does not execute a model or qualify T5.',
    'Research-derived scenarios test coverage or structure but do not prove measured user demand.',
    'A completed tool call is not a completed human purpose.',
  ],
};

const output = option('--output');
if (output) await writeFile(resolve(output), `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(plan, null, 2));
