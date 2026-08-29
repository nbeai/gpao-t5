import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-H는 existing capability 관측과 HQ carry-forward를 분리해 닫는다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-h-existing-capability-closeout-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'S4_H_CLOSED_WITH_EXISTING_CAPABILITY_OBSERVATION_HQ_REQUIRED');
  assert.equal(evidence.productImplementation, 0);
  assert.equal(evidence.currentActual.sourceKeyJoinExact, true);
  assert.equal(evidence.crossDomainEvidence.find((item) => item.scenario === 'KHB-M05').resultCorrect, true);
  assert.ok(evidence.carryForward.some((item) => item.scenario === 'KHB-A03'));
  assert.ok(evidence.carryForward.some((item) => item.scenario === 'personal_cross_source_join'));
  assert.equal(evidence.nextGate, 'S4_I_READ_ONLY_BASELINE');
});

test('S4-H가 인용한 cross-domain evidence는 현재 파일로 존재한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-h-existing-capability-closeout-2026-08-29.json', import.meta.url), 'utf8'));
  for (const item of evidence.crossDomainEvidence) {
    await readFile(new URL(`../../${item.source}`, import.meta.url));
  }
});
