#!/usr/bin/env node
import { mkdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import {
  DEFAULT_APPLICATION_IDENTITY, DEFAULT_INSTALLER_IDENTITY, DEFAULT_NOTARY_PROFILE,
  DEFAULT_RELEASE_CONFIG_PATH,
} from './macos-release-configuration.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const requestedRoot = option('--runtime-root');
if (!requestedRoot) throw new Error('--runtime-root is required');
const runtimeRoot = await realpath(resolve(requestedRoot));
const files = {
  arm64Tarball: join(runtimeRoot, 'node-v24.14.0-darwin-arm64.tar.gz'),
  x64Tarball: join(runtimeRoot, 'node-v24.14.0-darwin-x64.tar.gz'),
  shasums: join(runtimeRoot, 'SHASUMS256.txt'),
};
for (const path of Object.values(files)) {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`release material is not a file: ${basename(path)}`);
}

const path = resolve(process.env.T5_RELEASE_CONFIG ?? DEFAULT_RELEASE_CONFIG_PATH);
const keychain = resolve(option('--keychain')
  ?? join(homedir(), 'Library', 'Keychains', 'login.keychain-db'));
const config = {
  schema: 't5.macos-release-configuration.v1',
  runtime: files,
  signing: {
    applicationIdentity: DEFAULT_APPLICATION_IDENTITY,
    installerIdentity: DEFAULT_INSTALLER_IDENTITY,
    keychain,
  },
  notary: { profile: option('--notary-profile') ?? DEFAULT_NOTARY_PROFILE },
};
await mkdir(dirname(path), { recursive: true, mode: 0o700 });
const temporary = `${path}.tmp-${process.pid}`;
await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
await rename(temporary, path);
console.log(JSON.stringify({ configured: true, path, runtimeRoot, keychain,
  notaryProfile: config.notary.profile }, null, 2));
