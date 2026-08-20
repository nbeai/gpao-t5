import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('macOS team installer starts the console first and lets the user choose a model connection', async () => {
  const build = await readFile(new URL('../scripts/build-macos-installer.mjs', import.meta.url), 'utf8');
  const launcher = await readFile(new URL('../scripts/macos-launcher.m', import.meta.url), 'utf8');
  assert.match(build, /refoundation[\s\S]*start-console\.mjs/u);
  assert.match(build, /node-arm64/u);
  assert.match(build, /node-x64/u);
  assert.match(build, /COPYRIGHT/u);
  assert.match(build, /THIRD_PARTY_NOTICES\.md/u);
  assert.doesNotMatch(build, /gpao-t-handoff|AuthKey_|signing-private/u);
  assert.match(launcher, /start-console\.mjs/u);
  assert.doesNotMatch(launcher, /connect-chatgpt\.mjs|startOAuth/u);
  assert.match(launcher, /applicationDidFinishLaunching[\s\S]*?\[self startConsole\]/u);
  assert.match(launcher, /T5_REFOUNDATION_MODEL_CONNECTION_FILE/u);
  assert.match(launcher, /runtime\/bin/u);
  assert.doesNotMatch(launcher, /bin\/gpao-t5\.mjs/u);
});
