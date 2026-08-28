import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { observePublicationPreimage, publishAtomicFile } from './atomic-file-publication.js';

const inside = (candidate, root) => { const value = relative(root, candidate);
  return value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value)); };

async function syncDirectory(path) {
  const handle = await open(path, 'r'); try { await handle.sync(); } finally { await handle.close(); }
}

export async function createExactTargetRollbackPointer({ target: targetValue, rollbackRoot: rootValue,
  makeId = randomUUID } = {}) {
  const target = resolve(targetValue); const rollbackRoot = resolve(rootValue);
  await mkdir(rollbackRoot, { recursive: true, mode: 0o700 });
  const canonicalRoot = await realpath(rollbackRoot); const preimage = await observePublicationPreimage(target);
  let backupName = null;
  if (preimage) {
    const bytes = await readFile(target); backupName = `${makeId()}.preimage`;
    const backup = join(canonicalRoot, backupName);
    const saved = await publishAtomicFile({ target: backup, bytes, expectedPreimage: null, mode: 0o600 });
    if (saved.state !== 'published' || saved.sha256 !== preimage.sha256) {
      throw new Error('rollback preimage backup is not durable');
    }
  }
  return Object.freeze({ schema: 't5.exact-target-rollback.v1', pointerId: makeId(), target,
    rollbackRoot: canonicalRoot, backupName, preimage, createdAt: new Date().toISOString() });
}

export async function restoreExactTargetRollback(options = {}) {
  const { pointer, expectedPostimage } = options;
  if (pointer?.schema !== 't5.exact-target-rollback.v1' || !pointer.target || !pointer.rollbackRoot
    || !Object.hasOwn(options, 'expectedPostimage')) throw new TypeError('exact rollback pointer is invalid');
  const rollbackRoot = await realpath(pointer.rollbackRoot);
  const target = resolve(pointer.target); const current = await observePublicationPreimage(target);
  if (JSON.stringify(current) !== JSON.stringify(expectedPostimage)) {
    throw new Error('rollback target changed after publication');
  }
  if (pointer.preimage) {
    const backup = resolve(rollbackRoot, pointer.backupName ?? '');
    if (!inside(backup, rollbackRoot)) throw new Error('rollback backup escaped managed root');
    const backupStat = await lstat(backup);
    if (!backupStat.isFile() || backupStat.isSymbolicLink() || backupStat.nlink !== 1) {
      throw new Error('rollback backup is unavailable');
    }
    const bytes = await readFile(backup); const backupIdentity = await observePublicationPreimage(backup);
    if (backupIdentity?.sha256 !== pointer.preimage.sha256) throw new Error('rollback backup changed');
    const restored = await publishAtomicFile({ target, bytes, expectedPreimage: current,
      mode: pointer.preimage.mode });
    if (restored.state !== 'published' || restored.sha256 !== pointer.preimage.sha256) {
      return { state: 'rollback_durability_unknown', effectUnknown: true };
    }
    return { state: 'restored', target, restoredSha256: restored.sha256, effectUnknown: false };
  }
  const parent = await realpath(dirname(target)); await unlink(target);
  try { await syncDirectory(parent); } catch {
    return { state: 'rollback_durability_unknown', effectUnknown: true };
  }
  if (await observePublicationPreimage(target) !== null) return { state: 'rollback_durability_unknown', effectUnknown: true };
  return { state: 'removed_created_target', target, effectUnknown: false };
}
