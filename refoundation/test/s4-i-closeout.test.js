import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-I는 runner·ruler 결함과 current recovery product capability를 분리한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-i-existing-recovery-complete-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'S4_I_COMPLETE_EXISTING_RECOVERY_CAPABILITY_PRODUCT_IMPLEMENTATION_ZERO');
  assert.equal(evidence.productImplementation, 0);
  assert.equal(evidence.qualificationRunnerRepair.productDefect, false);
  assert.equal(evidence.rulerCorrection.productDefectReproduced, false);
  assert.equal(evidence.aggregate.passed, 5);
  assert.equal(evidence.invariants.blindEffectRetry, 0);
  assert.equal(evidence.nextGate, 'S4_UX_READ_ONLY_BASELINE');
});

test('S4-I actual case는 다섯 recovery dimension을 모두 덮는다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-i-existing-recovery-complete-2026-08-29.json', import.meta.url), 'utf8'));
  assert.deepEqual(evidence.actualCases.map((item) => item.dimension),
    ['method_failure', 'partial_result', 'safe_retry', 'interaction_mode', 'impossible_stop']);
  assert.ok(evidence.actualCases.every((item) => item.passed));
});
