import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-F 계약은 inspect부터 settle까지 Work transaction과 정직한 상태를 고정한다', async () => {
  const value = JSON.parse(await readFile(new URL(
    '../fixtures/s4-f-authoring-transaction-contract.json', import.meta.url), 'utf8'));
  assert.equal(value.status, 'CONTRACT_ONLY_PRODUCT_CHANGES_ZERO');
  assert.deepEqual(value.phases, ['inspect', 'preview', 'prepare', 'lock_and_revalidate',
    'publish', 'verify', 'settle']);
  assert.deepEqual(value.settlements, ['published_verified', 'not_published',
    'rolled_back_verified', 'partial_effect_unknown', 'published_durability_unknown']);
  assert.ok(value.invariants.some((item) => item.includes('later target failure')));
  assert.ok(value.invariants.some((item) => item.includes('sorted canonical path order')));
  assert.ok(value.reuse.includes('S4-E5 atomic publication'));
  assert.ok(value.nonGoals.includes('shell string as the authoring protocol'));
});
