import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-D5C 증거는 제품 격리·전체 메모리·호환·남은 범위를 함께 보존한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-d5c-product-command-explainer-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'PRODUCT_INTEGRATION_COMPLETE');
  assert.equal(evidence.implementation.newStore, false);
  assert.equal(evidence.implementation.commandInArgv, false);
  assert.equal(evidence.implementation.failClosedBeforeProcessStart, true);
  assert.equal(evidence.compatibility.commandExplanationContentPreserved, true);
  assert.ok(evidence.performance.combinedCandidateBytes < 100 * 1024 * 1024);
  assert.ok(evidence.performance.combinedReductionRatio > 0.85);
  assert.equal(evidence.performance.stdoutExactHash, true);
  assert.equal(evidence.verification.fullCiExit, 0);
  assert.equal(evidence.verification.integrationFailed, 0);
  assert.ok(evidence.nonClaims.includes('PTY parent-death containment is implemented'));
});
