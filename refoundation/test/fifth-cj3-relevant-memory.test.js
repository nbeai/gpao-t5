import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('CJ3은 자동 의미 저장 없이 long conversation 선택과 exact Memory reopen을 분리한다', async () => {
  const evidence = JSON.parse(await read('../evidence/fifth-cj3-relevant-memory-conversation-2026-08-30.json'));
  assert.equal(evidence.status, 'COMPLETE'); assert.equal(evidence.productSourceChanges, 0);
  assert.equal(evidence.terraLongConversationObservation.recalculatedCurrentContractStatus, 'PASS');
  assert.equal(evidence.terraLongConversationObservation.unverifiedAutomaticMemoryWrites, 0);
  assert.deepEqual(evidence.gpt55ExactRecall.cases.map((item) => item.status), ['PASS', 'PASS']);
  assert.deepEqual(evidence.gpt55ExactRecall.cases.map((item) => item.sourceReopened), [true, true]);
  assert.equal(evidence.deterministicCountertests.failed, 0);

  const runner = await read('../scripts/run-memory-selection-qualification.mjs');
  assert.match(runner, /makePlatformSecretStore/u);
  assert.match(runner, /memory\.current/u);
  assert.match(runner, /record_provenance_and_sensitivity_required/u);
  assert.doesNotMatch(runner, /selection\.memoryFlushCompleted/u);
});
