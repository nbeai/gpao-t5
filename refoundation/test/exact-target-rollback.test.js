import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { observePublicationPreimage, publishAtomicFile } from '../src/atomic-file-publication.js';
import { createExactTargetRollbackPointer, restoreExactTargetRollback } from '../src/exact-target-rollback.js';

test('exact rollback pointer는 기존 target 하나의 bytes·digest·mode만 복원한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-exact-rollback-')); const target = join(root, 'target.txt');
  try {
    await writeFile(target, 'old'); await chmod(target, 0o640);
    const pointer = await createExactTargetRollbackPointer({ target, rollbackRoot: join(root, 'rollback') });
    const published = await publishAtomicFile({ target, bytes: 'new', expectedPreimage: pointer.preimage });
    const restored = await restoreExactTargetRollback({ pointer, expectedPostimage: published.postimage });
    assert.equal(restored.state, 'restored'); assert.equal(await readFile(target, 'utf8'), 'old');
    assert.equal((await observePublicationPreimage(target)).mode, 0o640);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('새 target rollback은 exact postimage일 때만 생성 파일을 제거한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-exact-created-')); const target = join(root, 'target.txt');
  try {
    const pointer = await createExactTargetRollbackPointer({ target, rollbackRoot: join(root, 'rollback') });
    const published = await publishAtomicFile({ target, bytes: 'created', expectedPreimage: null });
    assert.equal((await restoreExactTargetRollback({ pointer, expectedPostimage: published.postimage })).state,
      'removed_created_target');
    assert.equal(await observePublicationPreimage(target), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('restore 전 target 또는 backup이 바뀌면 overwrite하지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-exact-stale-')); const target = join(root, 'target.txt');
  try {
    await writeFile(target, 'old'); const pointer = await createExactTargetRollbackPointer({
      target, rollbackRoot: join(root, 'rollback') });
    const published = await publishAtomicFile({ target, bytes: 'new', expectedPreimage: pointer.preimage });
    await writeFile(target, 'third-party');
    await assert.rejects(restoreExactTargetRollback({ pointer, expectedPostimage: published.postimage }), /target changed/u);
    assert.equal(await readFile(target, 'utf8'), 'third-party');
    const current = await observePublicationPreimage(target); const pointer2 = await createExactTargetRollbackPointer({
      target, rollbackRoot: join(root, 'rollback2') });
    const next = await publishAtomicFile({ target, bytes: 'next', expectedPreimage: current });
    await writeFile(join(pointer2.rollbackRoot, pointer2.backupName), 'tampered');
    await assert.rejects(restoreExactTargetRollback({ pointer: pointer2, expectedPostimage: next.postimage }), /backup changed/u);
    assert.equal(await readFile(target, 'utf8'), 'next');
  } finally { await rm(root, { recursive: true, force: true }); }
});
