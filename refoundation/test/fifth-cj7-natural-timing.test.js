import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/fifth-cj7-natural-timing-2026-08-30.json', import.meta.url), 'utf8'));

test('CJ7 taxonomy는 사후 자격이며 여섯 행동 경계가 실제 결과로 닫힌다', () => {
  assert.equal(evidence.status, 'COMPLETE'); assert.equal(evidence.taxonomyRuntimeEnum, false);
  assert.deepEqual(evidence.actual.map((item) => item.taxonomy), [
    'ANSWER', 'ASK', 'ACT', 'GROUND_PUBLIC', 'GROUND_PERSONAL', 'STOP',
  ]);
  assert.ok(evidence.actual.every((item) => item.status.startsWith('PASS')));
  assert.equal(evidence.actual.find((item) => item.taxonomy === 'ANSWER').toolCalls, 0);
  assert.equal(evidence.actual.find((item) => item.taxonomy === 'ASK').externalSend, 0);
  assert.equal(evidence.actual.find((item) => item.taxonomy === 'ACT').artifact.reopenedExact, true);
  assert.equal(evidence.fixtureCorrection.productOrPromptChanges, 0);
  assert.equal(Object.values(evidence.judgmentEquation).every(Boolean), true);
});
