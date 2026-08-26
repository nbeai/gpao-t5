import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidenceUrl = new URL('../evidence/s3-a-terminal-baseline-2026-08-26.json', import.meta.url);

test('S3-T0 증거는 현재 강점·간극·다음 후보를 분리하고 fixture 비밀 원문을 보존하지 않는다', async () => {
  const raw = await readFile(evidenceUrl, 'utf8');
  const evidence = JSON.parse(raw);
  assert.equal(evidence.status, 'baseline_gap_observed_optimization_not_started');
  assert.equal(evidence.productChanged, false);
  assert.equal(evidence.fixture.homeMatchesWorkingRoot, false);
  assert.equal(evidence.fixture.loginShellEscapedConfiguredHome, true);
  assert.equal(evidence.fixture.normalReadable, true);
  assert.equal(evidence.fixture.privateKeyReadable, true);
  assert.equal(evidence.fixture.cliCredentialReadable, true);
  assert.equal(evidence.foregroundOutput.truncated, true);
  assert.equal(evidence.foregroundOutput.exactRecallHandlePresent, false);
  assert.equal(evidence.processContinuity.startedWithHandle, true);
  assert.equal(evidence.processContinuity.terminalState, 'completed');
  assert.equal(evidence.processContinuity.duplicateSecondCount, 1);
  assert.equal(evidence.nextCandidate,
    'login_shell_snapshot_and_secret_safe_environment_countertests');
  assert.deepEqual(evidence.comparisonSources.map((source) => source.system), [
    'Codex', 'OpenClaw', 'Hermes', 'OpenHands',
  ]);
  assert.doesNotMatch(raw, /FIXTURE-PRIVATE-KEY|FIXTURE-CLI-TOKEN/u);
});
