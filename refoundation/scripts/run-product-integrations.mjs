#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const testDirectory = resolve(here, '..', 'test');
const visibleBrowserTests = new Set(['persistent-browser-live.integration.js']);
const files = (await readdir(testDirectory))
  .filter((name) => name.endsWith('.integration.js') && !visibleBrowserTests.has(name))
  .sort()
  .map((name) => resolve(testDirectory, name));

if (!files.length) throw new Error('product integration tests are missing');

const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], {
  stdio: 'inherit',
});
child.once('error', (error) => { throw error; });
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
