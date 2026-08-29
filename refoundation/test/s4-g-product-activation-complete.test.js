import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-G product activation은 세 actual 목적과 model-independent Artifact 계약으로 완료된다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-g-product-activation-complete-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.finalTruth.productActivation, 'COMPLETE');
  assert.equal(evidence.activation.modelIdentityUsed, false);
  assert.equal(evidence.activation.businessRouterUsed, false);
  assert.equal(evidence.activation.artifactRegistrationRequiresModel, false);
  assert.deepEqual(evidence.actualPurposes.map((item) => item.purpose), ['business', 'development', 'personal_file']);
  assert.ok(evidence.actualPurposes.every((item) => item.passed && item.snapshotExecutions === 1
    && item.attachmentCalls === 0 && item.artifactCount === 2 && item.sourceUnchanged));
  assert.equal(evidence.businessComparison.paretoImproved, true);
  assert.equal(evidence.safety.partialArtifactPublication, 0);
});
