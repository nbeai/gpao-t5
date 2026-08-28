import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('S4-C 기준선은 목적 성공·Hand 경제성 미달·Terra 승인 대기를 분리한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-c-situation-hand-baseline-2026-08-28.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'GPT55_FAILURE_REPRODUCED_TERRA_EXPLICIT_APPROVAL_PENDING');
  assert.equal(evidence.productChanges, 0);
  assert.equal(evidence.currentGpt55.purposeAchieved, true);
  assert.equal(evidence.currentGpt55.connectionResultUsedInFinalAnswer, false);
  assert.deepEqual(evidence.currentGpt55.toolSequence,
    ['connection', 'exec', 'exec', 'exec', 'work_completion']);
  assert.deepEqual(evidence.reproducedFailureFamilies.map((item) => item.id), [
    'local_evidence_after_unused_connection_probe',
    'nonportable_file_discovery_hidden_by_pipeline_exit',
  ]);
  assert.equal(evidence.terraComparison.status,
    'not_run_explicit_payload_destination_approval_required');
  assert.ok(evidence.notYetProven.includes('connection should be deferred globally'));
});
