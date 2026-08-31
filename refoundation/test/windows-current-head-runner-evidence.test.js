import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('current-head runner evidence는 step 0 외부 실패를 Windows code 실패나 PASS로 만들지 않는다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s6-wp0-current-head-runner-blocked-2026-08-31.json', import.meta.url,
  ), 'utf8'));
  assert.equal(evidence.status, 'BLOCKED_BEFORE_STEPS_EXTERNAL_RUNNER_ALLOCATION');
  assert.equal(evidence.sourceCommit, 'a6ae7ddc62a88d802ab6853899903aecfde45249');
  assert.equal(evidence.classification.productCodeExecuted, false);
  assert.equal(evidence.classification.windowsCompileAttempted, false);
  assert.equal(evidence.classification.sameRunRetried, false);
  assert.equal(evidence.jobs.every((job) => job.stepsStarted === 0), true);
  assert.ok(evidence.notClaimed.includes('current-head Windows runner PASS'));
});
