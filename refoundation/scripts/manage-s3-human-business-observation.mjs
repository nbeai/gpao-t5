#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  makeS3HumanBusinessObservationTemplate, validateS3HumanBusinessObservation,
} from '../src/s3-human-business-observation.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv.includes('--template')) {
  const output = option('--output');
  if (!output) throw new Error('--output is required with --template');
  await writeFile(resolve(output), `${JSON.stringify(makeS3HumanBusinessObservationTemplate(), null, 2)}\n`, {
    mode: 0o600, flag: 'wx',
  });
  console.log(JSON.stringify({ created: true, output: resolve(output) }, null, 2));
  process.exit(0);
}

const input = option('--validate');
if (!input) throw new Error('use --template --output <file> or --validate <file>');
const observation = JSON.parse(await readFile(resolve(input), 'utf8'));
console.log(JSON.stringify(validateS3HumanBusinessObservation(observation), null, 2));
