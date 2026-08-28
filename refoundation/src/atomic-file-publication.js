import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const missing = (error) => error?.code === 'ENOENT' ? null : Promise.reject(error);
const identity = (stat, digest = null) => stat == null ? null : ({ dev: stat.dev, ino: stat.ino,
  nlink: stat.nlink, size: stat.size, mtimeMs: stat.mtimeMs, mode: stat.mode & 0o7777, sha256: digest });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export async function observePublicationPreimage(targetValue) {
  const target = resolve(targetValue); let stat;
  try { stat = await lstat(target); } catch (error) { return missing(error); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error('atomic publication target is not a regular single-link file');
  }
  return identity(stat, sha256(await readFile(target)));
}

export async function publishAtomicFile({ target: targetValue, bytes: source,
  expectedPreimage, mode = null, makeId = randomUUID, io = {} } = {}) {
  const target = resolve(targetValue); const parent = await realpath(dirname(target));
  const parentBefore = await lstat(parent);
  if (!parentBefore.isDirectory() || parentBefore.isSymbolicLink()) throw new Error('publication parent is unavailable');
  const current = await observePublicationPreimage(target);
  if (!same(current, expectedPreimage ?? null)) throw new Error('publication preimage changed');
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source ?? '');
  const digest = sha256(bytes); const temporary = join(parent, `.${basename(target)}.t5-${makeId()}.tmp`);
  const openFile = io.open ?? open; const renameFile = io.rename ?? rename; const removeFile = io.rm ?? rm;
  let handle = null; let replaced = false;
  try {
    handle = await openFile(temporary, 'wx', mode ?? current?.mode ?? 0o600);
    await handle.writeFile(bytes); await handle.sync();
    if (mode != null || current) await handle.chmod(mode ?? current.mode);
    await handle.close(); handle = null;
    const parentNow = await lstat(parent);
    if (parentNow.dev !== parentBefore.dev || parentNow.ino !== parentBefore.ino
      || !same(await observePublicationPreimage(target), current)) throw new Error('publication identity changed');
    await renameFile(temporary, target); replaced = true;
    let directorySynced = false;
    try { const directory = await openFile(parent, 'r'); try { await directory.sync(); directorySynced = true; }
      finally { await directory.close(); } } catch { directorySynced = false; }
    let observed = null; try { observed = await observePublicationPreimage(target); } catch { observed = null; }
    if (!directorySynced || observed?.sha256 !== digest) return { state: 'published_durability_unknown',
      target, expectedSha256: digest, observedSha256: observed?.sha256 ?? null, effectUnknown: true };
    return { state: 'published', target, sha256: digest, bytes: bytes.length,
      preimage: current, postimage: observed, effectUnknown: false };
  } catch (error) {
    if (replaced) return { state: 'published_durability_unknown', target,
      expectedSha256: digest, observedSha256: null, effectUnknown: true,
      reason: error?.code ?? 'post_replace_failure' };
    throw error;
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (!replaced) await removeFile(temporary, { force: true }).catch(() => {});
  }
}
