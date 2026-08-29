import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-HQ preparation은 기존 실제 wave와 current-head 미실행을 분리한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-hq-read-only-preparation-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'S4_HQ_READ_ONLY_PREPARATION_COMPLETE_EXECUTION_NOT_STARTED');
  assert.equal(evidence.productChanges, 0);
  assert.equal(evidence.windows.status, 'DEFERRED_NOT_WAIVED_OWNER_DECISION');
  assert.equal(evidence.windows.allowsFourthCompletion, false);
  assert.equal(evidence.minimumCurrentHeadWave.length, 8);
  assert.deepEqual(evidence.comparisonContract.fixedModelsAtExecution, ['gpt-5.6-terra', 'gpt-5.5']);
  assert.equal(evidence.execution.currentHeadActualProviderRuns, 0);
  assert.equal(evidence.execution.comparisonRuns, 0);
});

test('S4-HQ 최소 wave가 인용한 current evidence는 모두 존재한다', async () => {
  for (const path of [
    '../evidence/s4-c-situation-hand-baseline-2026-08-28.json',
    '../evidence/s4-g-final-closeout-2026-08-29.json',
    '../evidence/s4-h-existing-capability-closeout-2026-08-29.json',
    '../evidence/s4-i-existing-recovery-complete-2026-08-29.json',
    '../evidence/s4-ux-interaction-continuity-complete-2026-08-29.json',
  ]) await readFile(new URL(path, import.meta.url));
});
