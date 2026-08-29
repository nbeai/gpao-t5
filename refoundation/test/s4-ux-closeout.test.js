import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-UX는 세 current 수리와 기존 실제 모델 증거를 분리해 완료한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-ux-interaction-continuity-complete-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'S4_UX_INTERACTION_CONTINUITY_COMPLETE');
  assert.equal(evidence.repairs.length, 3);
  assert.equal(evidence.reusedActualModelEvidence.correctedOraclePassed, '4/4');
  assert.equal(evidence.currentProductCoverage.additionalModelCalls, 0);
  assert.ok(evidence.notClaimed.includes('current-head external provider journey rerun'));
  assert.equal(evidence.nextGate, 'S4_L_WINDOWS_PHYSICAL_QUALIFICATION_READ_ONLY_BASELINE');
});
