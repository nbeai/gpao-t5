import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('G Snapshot batch integration은 F receipt·handle·crash reconcile과 Console 미통합을 분리한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-g-snapshot-batch-handoff-integration-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'S4_G_SNAPSHOT_ADAPTER_BATCH_HANDOFF_COMPLETE_CONSOLE_INTEGRATION_ZERO');
  assert.equal(evidence.normal.verifiedOutputs, evidence.normal.durableInternalOutputHandles);
  assert.equal(evidence.normal.modelVisibleOutputHandles, 0);
  assert.equal(evidence.normal.artifactsRegistered, 2);
  assert.equal(evidence.normal.handleHashMatchesFReadback, true);
  assert.equal(evidence.crash.pythonReexecutions, 0);
  assert.equal(evidence.crash.FRepublications, 0);
  assert.equal(evidence.truthBoundary.postimageWithoutFVerifiedReceiptAccepted, false);
  assert.equal(evidence.productIntegration.consoleExec, 0);
});
