import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-D4B 증거는 exact successor settlement와 남은 PTY·Windows·RSS 경계를 분리한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-d4b-successor-settlement-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'COMPLETE');
  assert.equal(evidence.implementation.newStore, false);
  assert.equal(evidence.implementation.processReattach, false);
  assert.equal(evidence.qualification.settledPurposeFamilies, 3);
  assert.equal(evidence.qualification.partialOutputSameHandleReopened, 3);
  assert.equal(evidence.qualification.modelCalls, 0);
  assert.equal(evidence.qualification.toolReexecutions, 0);
  assert.equal(evidence.qualification.secondSuccessorAdditionalWorkEvents, 0);
  assert.equal(evidence.qualification.unqualifiedPtySettledAsTerminal, false);
  assert.equal(evidence.qualification.unqualifiedPtyClaimReleased, false);
  assert.equal(evidence.verification.dailyCheckExit, 0);
  assert.equal(evidence.verification.fullCiExit, 0);
  assert.equal(evidence.verification.unitFailed, 0);
  assert.equal(evidence.verification.integrationFailed, 0);
  assert.equal(evidence.verification.mutationKills, 2);
  assert.ok(evidence.nonClaims.includes('physical Windows crash recovery is qualified'));
  assert.ok(evidence.nonClaims.includes('the unresolved full Terminal Hand RSS is fixed'));
});
