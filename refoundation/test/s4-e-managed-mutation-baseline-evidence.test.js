import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-E baseline 증거는 세 gap과 기존 양성 대조·비주장을 분리한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-e-managed-mutation-baseline-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'READ_ONLY_BASELINE_COMPLETE_THREE_GAPS_REPRODUCED');
  assert.equal(evidence.productChanges, 0);
  assert.equal(evidence.reproduced.destinationParentSymlinkEscape, true);
  assert.equal(evidence.reproduced.hardlinkSourceAdmitted, true);
  assert.equal(evidence.reproduced.undeclaredTerminalWriteObserved, false);
  assert.equal(evidence.positiveControls.sourceIdentityChangeBlocked, true);
  assert.equal(evidence.absorbedPrinciples.length, 6);
  assert.ok(evidence.nonClaims.includes('S4-E implementation is open'));
});
