import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-D5B 증거는 persistent helper의 정확성·RSS·비용·crash를 함께 보존한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-d5b-persistent-explainer-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'QUALIFICATION_COMPLETE_PRODUCT_INTEGRATION_OPEN');
  assert.equal(evidence.productChanges, 0);
  assert.equal(evidence.protocol.commandInArgv, false);
  assert.equal(evidence.protocol.automaticCommandExecution, 0);
  assert.ok(evidence.persistentQualification.warmMedianWallMs < 1);
  assert.equal(evidence.persistentQualification.concurrentExactIdentity, true);
  assert.equal(evidence.persistentQualification.crashPendingState, 'explainer_process_exited');
  assert.ok(evidence.liveOutputQualification.mainRuntimeMedianPeakRssDelta < 64 * 1024 * 1024);
  assert.equal(evidence.liveOutputQualification.stdoutExactHash, true);
  assert.equal(evidence.liveOutputQualification.stderrExactHash, true);
  assert.equal(evidence.decision.productAdopted, false);
  assert.equal(evidence.decision.productIntegrationOpened, true);
  assert.ok(evidence.nonClaims.includes('S4-D is complete'));
});
