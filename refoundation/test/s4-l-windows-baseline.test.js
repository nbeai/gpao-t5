import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-L baseline은 historical runner와 current physical Windows 미실행을 분리한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-l-windows-read-only-baseline-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.productChanges, 0);
  assert.equal(evidence.historicalExactHeadEvidence.windowsServerX64Executed, true);
  assert.equal(evidence.historicalExactHeadEvidence.arm64CrossCompiled, true);
  assert.equal(evidence.historicalExactHeadEvidence.arm64Executed, false);
  assert.ok(Object.values(evidence.currentHeadTruth).every((value) => value === false));
  assert.equal(evidence.qualificationMetadataCorrection.correctedIsolatedVmMachinePass, false);
  assert.equal(evidence.qualificationMetadataCorrection.correctedWindowsRuntimeComplete, false);
});
