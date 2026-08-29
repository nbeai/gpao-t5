import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-UX 첫 수리는 model acceptance를 거의 완료 의미로 승격하지 않는다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-ux-grounded-progress-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.baseline.canonicalCompletionEvidence, false);
  assert.equal(evidence.repair.removedRuntimeMeaningPromotion, true);
  assert.equal(evidence.repair.additionalModelCalls, 0);
  assert.equal(evidence.repair.additionalToolCalls, 0);
  assert.equal(evidence.gate.complete, false);
});
