#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureLocalRuntime } from '../src/local-runtime-lifecycle.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..', '..');
const portFileValue = option('--port-file') ?? process.env.T5_REFOUNDATION_PORT_FILE;
if (!portFileValue) throw new Error('T5 local runtime port file is required');
const portFile = resolve(portFileValue);
const productRoot = option('--product-root');

const ready = await ensureLocalRuntime({
  portFile,
  startRuntime: async () => {
    const entry = resolve(here, 'start-console.mjs');
    const args = [entry, '--port', '0', '--port-file', portFile, '--no-open'];
    if (productRoot) args.push('--product-root', resolve(productRoot));
    const child = spawn(process.execPath, args, {
      cwd: appRoot,
      env: process.env,
      detached: true,
      stdio: 'inherit',
      windowsHide: true,
    });
    await new Promise((resolveSpawn, rejectSpawn) => {
      child.once('spawn', resolveSpawn);
      child.once('error', rejectSpawn);
    });
    child.unref();
    return { requested: true, pid: child.pid };
  },
});

console.log(JSON.stringify({ state: ready.state, started: ready.started, port: ready.port }));
