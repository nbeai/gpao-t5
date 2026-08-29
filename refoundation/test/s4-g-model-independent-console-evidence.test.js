import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('G Console integration은 model identity 대신 exact execution facts로 activation한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-g-model-independent-console-integration-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'S4_G_MODEL_INDEPENDENT_EXEC_ARTIFACT_INTEGRATION_NARROW_ONLY');
  assert.equal(evidence.deterministicModels.length, 2);
  assert.ok(evidence.deterministicModels.every((model) => model.passed));
  assert.ok(evidence.notUsedForActivation.includes('model identity'));
  assert.equal(evidence.result.modelAttachmentCalls, 0);
  assert.equal(evidence.result.artifactsPerRun, 2);
  assert.equal(evidence.payload.quickJsStillQualificationOnly, true);
  assert.equal(evidence.actual.commandShapeVarianceMiss, true);
  assert.equal(evidence.actual.economyPassed, false);
  assert.ok(evidence.nonClaims.includes('actual gpt-5.5 economy passed'));
});
