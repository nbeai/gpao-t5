import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/s6-i-external-mission-baseline-2026-08-30.json', import.meta.url,
), 'utf8'));

test('S6-I는 기존 외부 계약과 실제 계정 미자격을 분리하고 새 Connector로 통과를 꾸미지 않는다', () => {
  assert.equal(evidence.status, 'CLOSED_WITH_PHYSICAL_HUMAN_QUALIFICATION_PENDING');
  assert.equal(evidence.productImplementationAdopted, 0);
  assert.equal(evidence.currentInstalledReality.credentialOrMessageContentRead, false);
  assert.equal(evidence.remainingPhysicalProof.required, true);
  assert.equal(evidence.remainingPhysicalProof.automaticExecution, false);
  assert.equal(evidence.userCompletionUniversallyProven, false);
  assert.ok(evidence.counterfactualsRejected.some((item) => /new connector/i.test(item)));
});
