import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ManagedMutationObserver } from '../src/managed-mutation-observer.js';

test('managed mutation observer는 declared와 unexpected write만 content-free diff한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-mutation-observer-'));
  try {
    const observer = new ManagedMutationObserver(root); const before = await observer.observe();
    const target = join(root, 'target.txt'); await writeFile(target, 'target');
    await writeFile(join(root, 'unexpected.txt'), 'outside');
    const after = await observer.observe(); const diff = observer.compare(before, after, [target]);
    assert.deepEqual(diff.declaredChanges, ['target.txt']);
    assert.deepEqual(diff.unexpectedChanges, ['unexpected.txt']);
    assert.equal(Object.hasOwn(diff, 'records'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('observer는 symlink를 따라가지 않고 entry bound 초과를 unknown으로 둔다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-mutation-bound-')); const outside = await mkdtemp(join(tmpdir(), 't5-outside-'));
  try {
    await writeFile(join(outside, 'secret.txt'), 'secret'); await symlink(outside, join(root, 'link'));
    await mkdir(join(root, 'dir')); await writeFile(join(root, 'dir/a'), 'a');
    const observed = await new ManagedMutationObserver(root).observe();
    assert.equal(observed.records.some((item) => item.path.includes('secret.txt')), false);
    assert.equal((await new ManagedMutationObserver(root, { maxEntries: 1 }).observe()).state, 'unknown');
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
