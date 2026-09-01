import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/nx2-se3-explicit-apply-2026-09-01.json', import.meta.url), 'utf8'));

test('SE-3는 최초 unresolved를 숨기지 않고 structural completion schema 뒤 achieved로 닫는다', () => {
  assert.equal(evidence.firstActual.workOutcome, 'unresolved');
  assert.equal(evidence.firstActual.blocker, 'admitted_input_identity_mismatch');
  assert.equal(evidence.structuralRepair.workingMemoryPatch, false);
  assert.equal(evidence.structuralRepair.zeroBusyHandlesRequiresEmptyArray, true);
  assert.equal(evidence.finalActual.completionVerified, 'achieved');
  assert.equal(evidence.finalActual.blockers, 0);
  assert.equal(evidence.finalActual.resultingRevision, 2);
});

test('SE-3 provenance는 네 Work 상태와 crash exact once를 닫고 SE-5만 남긴다', () => {
  assert.equal(evidence.deterministic.activeR1ToR2, true);
  assert.equal(evidence.deterministic.pausedResumeR1ToR2, true);
  assert.equal(evidence.deterministic.completedDerivedWork, true);
  assert.equal(evidence.deterministic.directDerivedWork, true);
  assert.equal(evidence.deterministic.assistantAutoApplyBlocked, true);
  assert.equal(evidence.deterministic.otherActiveWorkSilentRebind, 0);
  assert.equal(evidence.deterministic.crashPointsRecoveredExactOnce, 4);
  assert.equal(evidence.boundaries.se4Opened, false);
  assert.match(evidence.boundaries.cleanSecondWholeFlow, /PENDING/u);
  assert.equal(evidence.next.se3Complete, true);
});
