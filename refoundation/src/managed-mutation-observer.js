import { createHash } from 'node:crypto';
import { lstat, opendir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const inside = (candidate, root) => { const value = relative(root, candidate);
  return value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value)); };
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class ManagedMutationObserver {
  constructor(root, { maxEntries = 4096, maxChangedPaths = 64 } = {}) {
    if (!root || !Number.isInteger(maxEntries) || maxEntries < 1) throw new TypeError('mutation observer root required');
    this.root = resolve(root); this.maxEntries = maxEntries; this.maxChangedPaths = maxChangedPaths;
  }
  async observe() {
    let root; try { root = await realpath(this.root); } catch { return { state: 'unknown', reason: 'root_unavailable' }; }
    const rootStat = await lstat(root); if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      return { state: 'unknown', reason: 'root_identity_invalid' };
    }
    const records = []; const pending = [root]; let unreadable = 0;
    while (pending.length) {
      const directory = pending.shift(); let opened;
      try { opened = await opendir(directory); } catch { unreadable += 1; continue; }
      try { for await (const entry of opened) {
        const path = join(directory, entry.name); let stat;
        try { stat = await lstat(path); } catch { unreadable += 1; continue; }
        records.push({ path: relative(root, path), type: stat.isSymbolicLink() ? 'symlink'
          : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
        dev: stat.dev, ino: stat.ino, nlink: stat.nlink, size: stat.size, mtimeMs: stat.mtimeMs });
        if (records.length > this.maxEntries) return { state: 'unknown', reason: 'entry_limit_exceeded' };
        if (stat.isDirectory() && !stat.isSymbolicLink()) pending.push(path);
      } } catch { unreadable += 1; }
    }
    records.sort((a, b) => a.path.localeCompare(b.path));
    const final = await lstat(root);
    if (final.dev !== rootStat.dev || final.ino !== rootStat.ino) return { state: 'unknown', reason: 'root_identity_changed' };
    return { state: unreadable ? 'unknown' : 'observed', root, rootIdentity: { dev: rootStat.dev, ino: rootStat.ino },
      coverageComplete: unreadable === 0, entryCount: records.length, manifestDigest: digest(records), records };
  }
  compare(before, after, declaredTargets = []) {
    if (before?.state !== 'observed' || after?.state !== 'observed') return { state: 'unknown',
      reason: before?.reason ?? after?.reason ?? 'coverage_incomplete' };
    if (before.rootIdentity.dev !== after.rootIdentity.dev || before.rootIdentity.ino !== after.rootIdentity.ino) {
      return { state: 'unknown', reason: 'root_identity_changed' };
    }
    const left = new Map(before.records.map((item) => [item.path, item]));
    const right = new Map(after.records.map((item) => [item.path, item]));
    const changed = [...new Set([...left.keys(), ...right.keys()])].filter((path) => (
      JSON.stringify(left.get(path) ?? null) !== JSON.stringify(right.get(path) ?? null)
    )).sort();
    const declared = declaredTargets.map((item) => resolve(item)).flatMap((item) => (
      inside(item, this.root) ? [resolve(after.root, relative(this.root, item))] : []
    ));
    const allowed = (path) => declared.some((target) => inside(resolve(after.root, path), target));
    return { state: 'observed', coverageComplete: true,
      changedEntries: changed.slice(0, this.maxChangedPaths), changedEntriesTruncated: changed.length > this.maxChangedPaths,
      declaredChanges: changed.filter(allowed).slice(0, this.maxChangedPaths),
      unexpectedChanges: changed.filter((path) => !allowed(path)).slice(0, this.maxChangedPaths),
      lateChildWrites: 'unmeasured' };
  }
}
