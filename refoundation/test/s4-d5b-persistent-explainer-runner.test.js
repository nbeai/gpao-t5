import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-D5B persistent qualification은 exact pairing·crash·cold/warm 비용을 제품 밖에서 잰다', async () => {
  const [host, runner] = await Promise.all([
    readFile(new URL('../scripts/command-explainer-child.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/run-s4-d5b-persistent-explainer.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(host, /--persistent/u);
  assert.match(host, /Object\.keys\(request\)\.sort/u);
  assert.match(host, /process\.stdin/u);
  assert.doesNotMatch(host, /eval\(|exec\(|workspace|credential|provider/u);
  assert.match(runner, /Array\.from\(\{ length: 8 \}/u);
  assert.match(runner, /kill\('SIGKILL'\)/u);
  assert.match(runner, /automaticCommandExecution: 0/u);
  assert.match(runner, /productChanges: 0/u);
  assert.match(runner, /realUserData: false/u);
  assert.match(runner, /externalWrites: 0/u);
});
