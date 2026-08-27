#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const metadata = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
const pkg = join(repo, 'dist', `GPAO-T5-${metadata.version}-universal.pkg`);
const runNode = (script, args = []) => execFileSync(process.execPath, [join(here, script), ...args], {
  cwd: repo, env: process.env, stdio: 'inherit',
});
runNode('check-macos-release-readiness.mjs');
runNode('build-macos-installer.mjs');
runNode('verify-macos-installer.mjs', [pkg]);
runNode('notarize-macos-installer.mjs', [pkg]);
runNode('verify-macos-installer.mjs', [pkg]);
