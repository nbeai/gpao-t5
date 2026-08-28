import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('S4-D3 증거는 exact output 성공과 RSS 미해결을 분리한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-d3-live-output-spine-2026-08-28.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'COMPLETE_WITH_RSS_OBSERVATION');
  assert.equal(evidence.implementation.storeReused, 'TerminalOutputStore');
  assert.equal(evidence.implementation.newOutputStore, false);
  assert.equal(evidence.implementation.commandReexecution, 0);
  assert.equal(evidence.qualification.exactFullHashMatched.stdout, true);
  assert.equal(evidence.qualification.exactFullHashMatched.stderr, true);
  assert.equal(evidence.qualification.runningRangeRead, true);
  assert.equal(evidence.qualification.completionSameHandle, true);
  assert.equal(evidence.qualification.diskFailure.outputRecallState, 'degraded');
  assert.equal(evidence.performance.shortCommandRegressionObserved, false);
  assert.equal(evidence.performance.rss.improvementClaimed, false);
  assert.equal(evidence.verification.fullCi.unitFailed, 0);
  assert.equal(evidence.verification.fullCi.integrationFailed, 0);
  assert.ok(evidence.nonClaims.includes('high RSS is fixed'));
});
