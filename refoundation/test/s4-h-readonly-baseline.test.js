import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-H baseline은 current product 결함과 oracle 결함을 분리한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-h-readonly-baseline-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'CURRENT_HEAD_POSITIVE_CONTROL_ORACLE_REPAIRED_NO_IMPLEMENTATION_OPENED');
  assert.equal(evidence.productChanges, 0);
  assert.equal(evidence.verification.sourceKeyJoinExact, true);
  assert.equal(evidence.verification.requiredFieldCoverageExact, true);
  assert.equal(evidence.verification.outputClosure, true);
  assert.equal(evidence.oracleCorrection.productDefectReproduced, false);
  assert.deepEqual(evidence.observedOutput.unknownRows,
    [['REQ-001', '김서윤', 'UNIQUE-001', '100000', '', 'contact']]);
});

test('S4-H runner는 합성 source-key·missing·privacy canary만 사용하고 제품 변경은 0으로 판정한다', async () => {
  const source = await readFile(new URL('../scripts/run-s4h-readonly-baseline.mjs', import.meta.url), 'utf8');
  assert.match(source, /REQ-001[\s\S]*REQ-002[\s\S]*UNIQUE-002[\s\S]*UNIQUE-001/u);
  assert.match(source, /DO_NOT_INCLUDE/u);
  assert.match(source, /productChanges: 0/u);
  assert.doesNotMatch(source, /writeFile\([^\n]*T5-FOURTH-COMPLETION/u);
});
