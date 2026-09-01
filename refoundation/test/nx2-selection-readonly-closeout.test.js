import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/nx2-se1-se2-selection-readonly-integration-2026-09-01.json', import.meta.url), 'utf8'));

test('SE-1은 exact anchor와 main projection delta 0으로 완료된다', () => {
  assert.equal(evidence.se1.canonicalAnchor, true);
  assert.equal(evidence.se1.markdownUnicodeUtf16, true);
  assert.equal(evidence.se1.staleProjectionBlocked, true);
  assert.equal(evidence.se1.crossMainProjectionDelta, 0);
});

test('SE-2는 Tool 0 read-only 제품 연결과 인간 자격 pending을 분리한다', () => {
  assert.equal(evidence.status, 'SE1_COMPLETE_SE2_PRODUCT_INTEGRATED_HUMAN_SIDE_ANSWER_PENDING');
  assert.equal(evidence.se2.toolDefinitions, 0);
  assert.equal(evidence.se2.workDeltaBeforeApply, 0);
  assert.equal(evidence.se2.artifactDeltaBeforeApply, 0);
  assert.equal(evidence.ui.ownerFirstReview, 'REJECTED_SPLIT_LAYOUT');
  assert.equal(evidence.ui.position, 'fixed');
  assert.equal(evidence.ui.background, 'rgb(255, 255, 255)');
  assert.equal(evidence.ui.humanSideQuestionAnswer, 'PENDING');
  assert.equal(evidence.verification.fullCheck.failed, 0);
  assert.equal(evidence.boundaries.applyOpened, false);
  assert.equal(evidence.next.se3Open, false);
});
