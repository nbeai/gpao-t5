import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('full-tool smoke는 실제 console과 두 model을 쓰고 provider dispatch 전 모든 closed schema를 검사한다', async () => {
  const source = await readFile(new URL('../scripts/run-s3ux-full-tool-provider-smoke.mjs', import.meta.url), 'utf8');
  assert.match(source, /makeConsoleServer/u); assert.match(source, /consoleInstructions/u);
  assert.match(source, /gpt-5\.6-terra/u); assert.match(source, /gpt-5\.5/u);
  assert.match(source, /assertStrict\(tool\.parameters/u);
  assert.match(source, /loadReadOnlyConnectionCredential/u);
  assert.doesNotMatch(source, /copyFile|credentialStore\.set|secretStore\.set/u);
});
