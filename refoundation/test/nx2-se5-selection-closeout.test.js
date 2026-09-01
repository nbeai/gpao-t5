import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const evidence = JSON.parse(readFileSync(new URL(
  '../evidence/nx2-se5-selection-side-exploration-close-2026-09-01.json', import.meta.url,
), 'utf8'));

test('SE-5는 오너 actual UI와 exact apply를 결속하고 자동화 drag 차이를 제품 패치로 만들지 않는다', () => {
  assert.equal(evidence.status, 'NX2_SE_COMPLETE_NX2_4_OPEN');
  assert.equal(evidence.humanSurface.actualConsole, true);
  assert.equal(evidence.humanSurface.nativeTextSelection, true);
  assert.equal(evidence.humanSurface.floatingWhitePanel, true);
  assert.equal(evidence.humanSurface.mainConversationResized, false);
  assert.equal(evidence.explicitApply.completionVerified, 'achieved');
  assert.equal(evidence.explicitApply.duplicateExecution, 0);
  assert.equal(evidence.qualificationBoundary.productPatchForAutomationDifference, 0);
});

test('Selection closeout은 apply 전 read-only와 기존 T5 경계를 보존한다', () => {
  assert.equal(evidence.canonicalBoundaries.mainWorkDeltaBeforeExplicitApply, 0);
  assert.equal(evidence.canonicalBoundaries.mainConversationDeltaBeforeExplicitApply, 0);
  assert.equal(evidence.canonicalBoundaries.toolsVisibleInSide, 0);
  assert.equal(evidence.canonicalBoundaries.memoryWrites, 0);
  assert.equal(evidence.canonicalBoundaries.newAgent, 0);
  assert.equal(evidence.canonicalBoundaries.newStore, 0);
  assert.equal(evidence.canonicalBoundaries.newRouter, 0);
  assert.equal(evidence.canonicalBoundaries.sideModelRunAndResourceAccounted, true);
  assert.equal(evidence.canonicalBoundaries.sideContentCopiedIntoResourceLedger, false);
  assert.equal(evidence.verification.fullCheckFailed, 0);
  assert.equal(evidence.next.gate, 'NX2-4 Auditory Intelligence');
});
