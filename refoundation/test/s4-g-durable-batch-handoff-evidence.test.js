import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('G durable batch handoff는 existing Attachment ledger와 product integration을 분리한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-g-durable-batch-handoff-contract-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'S4_G_DURABLE_BATCH_HANDOFF_CONTRACT_COMPLETE_PRODUCT_INTEGRATION_ZERO');
  assert.equal(evidence.newStore, 0);
  assert.equal(evidence.contract.singleBatchCommitEvent, true);
  assert.equal(evidence.contract.partialHandles, 0);
  assert.equal(evidence.contract.restartIdempotentHandles, true);
  assert.equal(evidence.contract.handleOnlyArtifactRegistration, true);
  assert.equal(evidence.productIntegration.snapshotAdapter, 0);
  assert.equal(evidence.productIntegration.consoleExec, 0);
});
