import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-E4 계약은 managed 범위·content-free diff·coverage unknown을 고정한다', async () => {
  const contract = JSON.parse(await readFile(new URL(
    '../fixtures/s4-e4-post-effect-scope-contract.json', import.meta.url), 'utf8'));
  assert.equal(contract.status, 'CONTRACT_ONLY_PRODUCT_CHANGES_ZERO');
  assert.deepEqual(contract.observedRoots, [
    'current_managed_workspace', 'declared_scratch', 'declared_output',
  ]);
  assert.equal(contract.privacy.fileContent, false);
  assert.equal(contract.privacy.unchangedEntryPathsProjected, false);
  assert.equal(contract.bounds.maximumEntries, 4096);
  assert.equal(contract.bounds.followSymlinks, false);
  assert.equal(contract.bounds.wholeComputer, false);
  assert.ok(contract.unknownWhen.includes('late_child_window_unmeasured'));
  assert.equal(contract.firstProductScope,
    'completed foreground local_change inside current managed workspace');
  assert.ok(contract.nonGoals.includes('full filesystem watcher'));
});
