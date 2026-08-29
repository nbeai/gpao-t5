import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-UX 결과 복구는 canonical identity를 보존하되 공개 pending-result에서 숨긴다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-ux-result-recovery-projection-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.baseline.resultBytesPreserved, true);
  assert.equal(evidence.baseline.nextTurnRegisteredWithoutRegeneration, true);
  assert.equal(evidence.repair.canonicalPendingOutputStoreChanged, false);
  assert.deepEqual(evidence.repair.publicPendingOutputFields, ['name', 'bytes']);
  assert.equal(evidence.repair.programReexecution, 0);
  assert.equal(evidence.gate.complete, false);
});
