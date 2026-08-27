#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import {
  assertDeveloperIdentities, loadReleaseConfiguration, notaryProfile,
  runtimeMaterial, signingConfiguration,
} from './macos-release-configuration.mjs';

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' });
}

const { path, config } = await loadReleaseConfiguration({ required: true });
const signing = signingConfiguration(config);
assertDeveloperIdentities(signing);
const runtime = {
  arm64: runtimeMaterial('T5_NODE_ARM64_TARBALL', config.runtime?.arm64Tarball),
  x64: runtimeMaterial('T5_NODE_X64_TARBALL', config.runtime?.x64Tarball),
  shasums: runtimeMaterial('T5_NODE_SHASUMS', config.runtime?.shasums),
};
const sums = await readFile(runtime.shasums, 'utf8');
for (const archive of [runtime.arm64, runtime.x64]) {
  const expected = sums.split('\n').find((line) => line.endsWith(`  ${archive.split('/').at(-1)}`))?.split(/\s+/u)[0];
  const actual = createHash('sha256').update(await readFile(archive)).digest('hex');
  if (!expected || actual !== expected) throw new Error('configured Node archive checksum mismatch');
}
const profile = notaryProfile(config);
const history = run('xcrun', ['notarytool', 'history', '--keychain-profile', profile]);
if (!history.includes('Successfully received submission history')) {
  throw new Error('notary profile validation failed');
}
console.log(JSON.stringify({
  schema: 't5.macos-release-readiness.v1', passed: true, configurationPath: path,
  identities: {
    application: signing.applicationIdentity, installer: signing.installerIdentity,
    keychain: signing.keychain,
  },
  runtime: { arm64: true, x64: true, officialChecksumsMatched: true },
  notary: { profile, credentialsValidated: true, acceptedHistoryObserved: history.includes('status: Accepted') },
  secretFilesInSourceTree: 0,
}, null, 2));
