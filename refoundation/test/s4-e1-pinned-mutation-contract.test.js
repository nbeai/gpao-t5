import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-E1 계약은 여섯 원리·POSIX/Windows 의미·첫 구현 중단선을 고정한다', async () => {
  const contract = JSON.parse(await readFile(new URL(
    '../fixtures/s4-e1-pinned-mutation-contract.json', import.meta.url), 'utf8'));
  assert.equal(contract.status, 'CONTRACT_ONLY_PRODUCT_CHANGES_ZERO');
  assert.deepEqual(contract.contracts.map((item) => item.id), [
    'exact_target_admission', 'pinned_mutation', 'pre_execution_revalidation',
    'atomic_publication', 'exact_rollback_pointer', 'post_effect_observation',
  ]);
  assert.ok(contract.platforms.posix.includes('openat'));
  assert.ok(contract.platforms.windows.includes('reparsePointRejected'));
  assert.ok(contract.platforms.windows.includes('ntfsHardlinkCount'));
  assert.ok(contract.countertests.includes('destination_parent_replaced_by_symlink_after_plan'));
  assert.ok(contract.countertests.includes('late_child_writes_outside_declared_targets'));
  assert.equal(contract.firstImplementation, 'destination_parent_identity_revalidation');
  assert.ok(contract.implementationOpenRequires.some((item) => item.includes('remaining TOCTOU')));
  assert.ok(contract.nonGoals.includes('whole-workspace shadow Git'));
  assert.ok(contract.nonGoals.includes('complete confinement of arbitrary shell effects'));
});
