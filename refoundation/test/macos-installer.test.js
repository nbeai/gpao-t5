import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('macOS team installer starts the console first and lets the user choose a model connection', async () => {
  const build = await readFile(new URL('../scripts/build-macos-installer.mjs', import.meta.url), 'utf8');
  const launcher = await readFile(new URL('../scripts/macos-launcher.m', import.meta.url), 'utf8');
  assert.match(build, /refoundation[\s\S]*start-console\.mjs/u);
  assert.match(build, /restrict-kordoc-bin\.mjs/u);
  assert.match(build, /node-arm64/u);
  assert.match(build, /node-x64/u);
  assert.match(build, /COPYRIGHT/u);
  assert.match(build, /THIRD_PARTY_NOTICES\.md/u);
  assert.match(build, /'skill-packages'/u);
  assert.match(build, /'capabilities'/u);
  assert.match(build, /PACKAGE_SOURCE_PATHS/u);
  assert.match(build, /'status', '--porcelain', '--', ...PACKAGE_SOURCE_PATHS/u);
  assert.match(build, /sourceScope: 'packaged-inputs'/u);
  assert.match(build, /pkg-scripts[\s\S]*preinstall[\s\S]*tell application id/u);
  assert.match(build, /do shell script[\s\S]*with administrator privileges/u);
  assert.match(build, /pkgutil --forget/u);
  assert.doesNotMatch(build, /ADMIN_COMMAND=/u);
  assert.doesNotMatch(build, /set -e\nrm -rf/u);
  assert.doesNotMatch(build, /gpao-t-handoff|AuthKey_|signing-private/u);
  assert.match(launcher, /start-console\.mjs/u);
  assert.doesNotMatch(launcher, /connect-chatgpt\.mjs|startOAuth/u);
  assert.match(launcher, /applicationDidFinishLaunching[\s\S]*?\[self startConsole\]/u);
  assert.match(launcher, /T5_REFOUNDATION_MODEL_CONNECTION_FILE/u);
  assert.match(launcher, /runtime\/bin/u);
  assert.doesNotMatch(launcher, /bin\/gpao-t5\.mjs/u);
  const verifier = await readFile(new URL('../scripts/verify-macos-installer.mjs', import.meta.url), 'utf8');
  assert.match(verifier, /const childExit = new Promise/u);
  assert.doesNotMatch(verifier, /child\.kill\('SIGTERM'\);\s*await new Promise\(\(resolveExit\) => child\.once/u);
  assert.match(verifier, /\^-----BEGIN \(RSA \|OPENSSH \)\?PRIVATE KEY-----\$/u);
  assert.doesNotMatch(verifier, /'-l', 'BEGIN \(RSA \)\?PRIVATE KEY/u);
});

test('7차 macOS package version은 제품 version 0.1.7과 일치한다', async () => {
  const packageMetadata = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  const build = await readFile(new URL('../scripts/build-macos-installer.mjs', import.meta.url), 'utf8');
  assert.equal(packageMetadata.version, '0.1.7');
  assert.match(build, /version:\s*'0\.1\.7'/u);
});
