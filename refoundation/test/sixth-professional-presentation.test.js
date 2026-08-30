import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/s6-h-professional-presentation-closeout-2026-08-30.json', import.meta.url,
), 'utf8'));

test('S6-H는 자연어 editable PPTX의 전체 Preview·download를 닫고 경제성 미달을 숨기지 않는다', () => {
  assert.equal(evidence.status, 'COMPLETE_EDITABLE_PRESENTATION_SLICE');
  assert.equal(evidence.userCompletion.editablePptx, true);
  assert.equal(evidence.userCompletion.allSlidesPreviewed, true);
  assert.equal(evidence.userCompletion.artifactRegistered, true);
  assert.equal(evidence.productChange.globalInstructionBytesDelta, 0);
  assert.equal(evidence.actualConsole.passed, true);
  assert.equal(evidence.actualConsole.economyDecision, 'CARRY_TO_S6_J_FIRST_COST_FAMILY');
  assert.ok(evidence.nonClaims.some((item) => /Windows/u.test(item)));
});
