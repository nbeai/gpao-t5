import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('G actual은 handoff 성공과 command-shape activation 실패를 합치지 않는다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-g-actual-activation-variance-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.activatedRun.snapshotExecutions, 1);
  assert.equal(evidence.activatedRun.attachmentFailures, 0);
  assert.equal(evidence.shapeVarianceRun.snapshotExecutions, 0);
  assert.equal(evidence.shapeVarianceRun.exactHeredocObserved, true);
  assert.equal(evidence.shapeVarianceRun.singleProgramStep, false);
  assert.equal(evidence.decision.addThirdSyntaxPatch, false);
  assert.equal(evidence.decision.productActivationComplete, false);
  assert.ok(evidence.shapeVarianceRun.providerTokens > evidence.activatedRun.providerTokens);
});
