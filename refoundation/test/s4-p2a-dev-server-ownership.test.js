import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('S4-P2A actual은 server ownership 성공과 다음 Browser 결속 실패를 분리한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-p2a-dev-server-ownership-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.ownership.unjoinedBackgroundExecBlocked, 1);
  assert.deepEqual(evidence.ownership.activatedTools, ['terminal_session']);
  assert.equal(evidence.ownership.managedForegroundStarts, 1);
  assert.equal(evidence.ownership.processBoundaryQualified, true);
  assert.equal(evidence.ownership.orphanServerAfterRuntimeSettlement, 0);
  assert.equal(evidence.ownership.serverPidFiles, 0);
  assert.equal(evidence.ownership.serverLogFiles, 0);
  assert.equal(evidence.decision.s4p2aOwnershipContractPassed, true);
  assert.equal(evidence.nextObservedDefect.webReadVisibleBrowser, 'user_interaction');
  assert.equal(evidence.nextObservedDefect.webReadState, 'read');
  assert.equal(evidence.nextObservedDefect.browserActivated, false);
  assert.equal(evidence.decision.s4pWholeJourneyPassed, false);
  assert.equal(evidence.decision.sameOwnershipPatchContinued, false);
});
