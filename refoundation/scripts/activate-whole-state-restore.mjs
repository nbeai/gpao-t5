#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { activatePreparedWholeStateRestore } from '../src/whole-state-bundle.js';

function option(name) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; }
const preparedStateRoot = resolve(option('--prepared-state'));
const destinationStateRoot = resolve(option('--destination-state'));
const expectedStateDigest = String(option('--state-digest') ?? '');
const portFile = resolve(option('--port-file'));
const productRoot = option('--product-root');
const deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  try { await lstat(portFile); await new Promise((resolveWait) => setTimeout(resolveWait, 100)); }
  catch (error) { if (error?.code === 'ENOENT') break; throw error; }
}
try { await lstat(portFile); throw new Error('T5 runtime did not stop before restore activation'); }
catch (error) { if (error?.code !== 'ENOENT') throw error; }
await activatePreparedWholeStateRestore({ preparedStateRoot, destinationStateRoot, expectedStateDigest });
const here = dirname(fileURLToPath(import.meta.url)); const args = [resolve(here, 'ensure-local-runtime.mjs'), '--port-file', portFile];
if (productRoot) args.push('--product-root', resolve(productRoot));
const child = spawn(process.execPath, args, { cwd: resolve(here, '..', '..'), env: process.env,
  stdio: 'ignore', windowsHide: true });
const code = await new Promise((resolveExit, rejectExit) => { child.once('error', rejectExit); child.once('close', resolveExit); });
if (code !== 0) throw new Error('T5 runtime did not restart after restore');
