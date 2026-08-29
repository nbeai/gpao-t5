import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('G generic snapshot shell은 exact command 자격과 제품 미통합을 분리한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-g-generic-snapshot-shell-qualification-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'S4_G_GENERIC_SNAPSHOT_SHELL_BACKEND_QUALIFIED_PRODUCT_INTEGRATION_ZERO');
  assert.equal(evidence.execution.exactCommandPreserved, true);
  assert.equal(evidence.execution.sourceWorkspaceWrites, 0);
  assert.equal(evidence.boundaries.networkDenied, true);
  assert.equal(evidence.boundaries.outsideWriteDenied, true);
  assert.equal(evidence.boundaries.deniedEffectSwallowedByShellStillPublishes, false);
  assert.equal(evidence.productIntegration.consoleExec, 0);
  assert.equal(evidence.productIntegration.payloadIncluded, false);
});
