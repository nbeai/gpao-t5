import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-HQ는 KHB-A03 모델 pair의 성공과 critical 실패를 합치지 않는다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-hq-khb-a03-model-pair-stop-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'S4_HQ_EXECUTION_STOPPED_FIRST_CRITICAL_MODEL_PROVIDER_FAILURE');
  assert.equal(evidence.pairControl.onlyModelChanged, true);
  assert.equal(evidence.gpt55.purposePassed, true);
  assert.equal(evidence.terra.purposePassed, false);
  assert.deepEqual(evidence.causalEvidence.terraStageExitCodes, [1, 0]);
  assert.equal(evidence.causalEvidence.runtimeFactsSupplied, true);
  assert.equal(evidence.causalEvidence.sameFamilyAsS4C, true);
  assert.equal(evidence.decision.productChanges, 0);
  assert.equal(evidence.decision.khbS01Run, false);
  assert.equal(evidence.decision.hqComplete, false);
});
