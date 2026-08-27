import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const DEFAULT_APPLICATION_IDENTITY =
  'Developer ID Application: Project Beai Co.,Ltd (5WC35NK3LA)';
export const DEFAULT_INSTALLER_IDENTITY =
  'Developer ID Installer: Project Beai Co.,Ltd (5WC35NK3LA)';
export const DEFAULT_NOTARY_PROFILE = 'gpao-t-notary';
export const DEFAULT_RELEASE_CONFIG_PATH = join(
  homedir(), 'Library', 'Application Support', 'GPAO-T5', 'release-configuration.json',
);

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' });
}

export async function loadReleaseConfiguration({ required = false } = {}) {
  const path = resolve(process.env.T5_RELEASE_CONFIG ?? DEFAULT_RELEASE_CONFIG_PATH);
  try {
    const config = JSON.parse(await readFile(path, 'utf8'));
    if (config?.schema !== 't5.macos-release-configuration.v1') {
      throw new Error('macOS release configuration schema is invalid');
    }
    return { path, config };
  } catch (error) {
    if (!required && error?.code === 'ENOENT') return { path, config: null };
    throw error;
  }
}

export function runtimeMaterial(name, configuredValue) {
  const value = process.env[name] ?? configuredValue;
  if (!value) throw new Error(`${name} is required; run refoundation:release:configure once`);
  return resolve(value);
}

export function signingConfiguration(config, { unsigned = false } = {}) {
  if (unsigned) return { applicationIdentity: null, installerIdentity: null, keychain: null };
  return {
    applicationIdentity: process.env.T5_SIGN_APP
      ?? config?.signing?.applicationIdentity ?? DEFAULT_APPLICATION_IDENTITY,
    installerIdentity: process.env.T5_SIGN_INSTALLER
      ?? config?.signing?.installerIdentity ?? DEFAULT_INSTALLER_IDENTITY,
    keychain: resolve(process.env.T5_SIGN_KEYCHAIN
      ?? config?.signing?.keychain ?? join(homedir(), 'Library', 'Keychains', 'login.keychain-db')),
  };
}

export function notaryProfile(config) {
  return process.env.T5_NOTARY_PROFILE ?? config?.notary?.profile ?? DEFAULT_NOTARY_PROFILE;
}

export function assertDeveloperIdentities({ applicationIdentity, installerIdentity, keychain }) {
  if (!applicationIdentity || !installerIdentity || !keychain) {
    throw new Error('signed release requires both Developer ID identities and a Keychain');
  }
  const basic = run('security', ['find-identity', '-v', '-p', 'basic', keychain]);
  const codesigning = run('security', ['find-identity', '-v', '-p', 'codesigning', keychain]);
  if (!basic.includes(installerIdentity)) throw new Error('Developer ID Installer identity is unavailable');
  if (!codesigning.includes(applicationIdentity)) throw new Error('Developer ID Application identity is unavailable');
  return { applicationIdentity, installerIdentity, keychain };
}
