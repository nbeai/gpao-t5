#!/usr/bin/env node
import { resolve } from 'node:path';

import { stopLocalRuntime } from '../src/local-runtime-lifecycle.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

const portFileValue = option('--port-file') ?? process.env.T5_REFOUNDATION_PORT_FILE;
if (!portFileValue) throw new Error('T5 local runtime port file is required');
const result = await stopLocalRuntime({ portFile: resolve(portFileValue), reason: option('--reason') });
console.log(JSON.stringify(result));
