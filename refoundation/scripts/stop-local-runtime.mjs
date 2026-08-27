#!/usr/bin/env node
import { resolve } from 'node:path';

import { stopLocalRuntime } from '../src/local-runtime-lifecycle.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

const portFileValue = option('--port-file') ?? process.env.T5_REFOUNDATION_PORT_FILE;
if (!portFileValue) throw new Error('T5 local runtime port file is required');
const timeoutValue = option('--timeout-ms');
const timeoutMs = timeoutValue == null ? undefined : Number(timeoutValue);
if (timeoutMs != null && (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000)) {
  throw new TypeError('local runtime stop timeout is invalid');
}
const result = await stopLocalRuntime({ portFile: resolve(portFileValue), reason: option('--reason'), timeoutMs });
console.log(JSON.stringify(result));
