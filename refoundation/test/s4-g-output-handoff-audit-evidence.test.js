import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('G output handoff audit은 구조적 gap과 과거 네 실패의 미확정을 분리한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-g-output-handoff-p1-audit-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'S4_G_OUTPUT_HANDOFF_P1_AUDIT_COMPLETE_CAUSE_NOT_UNIQUE');
  assert.equal(evidence.productChanges, 0);
  assert.equal(evidence.currentDeterministicReplay.outputHandlesReturned, 0);
  assert.equal(evidence.currentDeterministicReplay.approvedFilePathWithoutHandleRegistered, true);
  assert.equal(evidence.findings.verifiedPublicationHandoffGapConfirmed, true);
  assert.equal(evidence.findings.missingOutputHandleAloneExplainsAllFailures, false);
  assert.equal(evidence.findings.oldFailureCauseFullyKnown, false);
  assert.equal(evidence.decision.newStore, false);
});
