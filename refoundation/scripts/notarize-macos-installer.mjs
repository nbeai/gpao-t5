#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { loadReleaseConfiguration, notaryProfile } from './macos-release-configuration.mjs';
import { assertNotarySourceBoundary } from './macos-release-source-boundary.mjs';

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options });
}

const pkg = resolve(process.argv[2] ?? '');
if (!pkg) throw new Error('signed pkg path is required');
await stat(pkg);
const manifestPath = join(dirname(pkg), `${basename(pkg, '.pkg')}.manifest.json`);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const packageBytesBeforeNotary = await readFile(pkg);
const packageSha256BeforeNotary = createHash('sha256').update(packageBytesBeforeNotary).digest('hex');
assertNotarySourceBoundary({ manifest, packageSha256: packageSha256BeforeNotary });
const signature = run('pkgutil', ['--check-signature', pkg]);
if (!signature.includes('Developer ID Installer')) throw new Error('pkg is not Developer ID Installer signed');
const { config } = await loadReleaseConfiguration({ required: true });
const profile = notaryProfile(config);
const submission = JSON.parse(run('xcrun', [
  'notarytool', 'submit', pkg, '--keychain-profile', profile, '--wait', '--output-format', 'json',
]));
if (submission.status !== 'Accepted') throw new Error(`Apple notarization was not accepted: ${submission.status}`);
run('xcrun', ['stapler', 'staple', pkg], { stdio: 'inherit' });
run('xcrun', ['stapler', 'validate', pkg], { stdio: 'inherit' });
run('spctl', ['-a', '-vv', '-t', 'install', pkg], { stdio: 'inherit' });

const bytes = await readFile(pkg);
manifest.notarized = true;
manifest.stapled = true;
manifest.notarization = { profile, submissionId: submission.id, status: submission.status };
manifest.package = { ...manifest.package, path: pkg, bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex') };
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ passed: true, pkg, manifestPath,
  submissionId: submission.id, status: submission.status, stapled: true }, null, 2));
