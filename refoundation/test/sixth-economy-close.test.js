import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/s6-j-economy-close-2026-08-30.json', import.meta.url,
), 'utf8'));

test('S6-J는 발표자료 품질을 유지한 actual Pareto 개선과 남은 속도 carry를 함께 보존한다', () => {
  assert.equal(evidence.status, 'COMPLETE_FIRST_ACTUAL_COST_FAMILY');
  assert.ok(evidence.candidate.wallMs < evidence.baseline.wallMs);
  assert.ok(evidence.candidate.modelCalls < evidence.baseline.modelCalls);
  assert.ok(evidence.candidate.toolCalls < evidence.baseline.toolCalls);
  assert.ok(evidence.candidate.providerTokens < evidence.baseline.providerTokens);
  assert.equal(evidence.qualityInvariants.allSlidesPreviewed, true);
  assert.equal(evidence.adoptedPrinciple.globalInstructionBytesDelta, 0);
  assert.equal(evidence.remainingObservation.thirdPatchAllowed, false);
  assert.ok(evidence.carryForward.some((item) => /weather.*11\.089/u.test(item)));
});
