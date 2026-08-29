import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('generic G business actual은 자연 경로보다 정확하고 경제적이다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-g-generic-shell-business-actual-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.result.purposePassed, true);
  assert.equal(evidence.result.snapshotExecutions, 1);
  assert.equal(evidence.result.attachmentCalls, 0);
  assert.equal(evidence.result.attachmentFailures, 0);
  assert.equal(evidence.comparisons.wallImprovedVsNatural, true);
  assert.equal(evidence.comparisons.callsImprovedVsNatural, true);
  assert.equal(evidence.comparisons.tokensImprovedVsNatural, true);
});
