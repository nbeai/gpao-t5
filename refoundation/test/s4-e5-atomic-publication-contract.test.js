import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-E5 계약은 replace 전 실패와 replace 후 durability unknown을 분리한다', async () => {
  const value = JSON.parse(await readFile(new URL(
    '../fixtures/s4-e5-atomic-publication-contract.json', import.meta.url), 'utf8'));
  assert.deepEqual(value.states, ['published', 'not_published', 'published_durability_unknown']);
  assert.equal(value.failureMeaning.beforeAtomicReplace, 'not_published');
  assert.equal(value.failureMeaning.atomicReplaceSucceededDirectorySyncFailed,
    'published_durability_unknown');
  assert.ok(value.orderedFacts.indexOf('file_sync') < value.orderedFacts.indexOf('atomic_replace'));
  assert.ok(value.orderedFacts.indexOf('atomic_replace') < value.orderedFacts.indexOf('directory_sync'));
  assert.ok(value.invariants.some((item) => item.includes('never partial bytes')));
  assert.ok(value.nonGoals.includes('public workspace_patch tool'));
});
