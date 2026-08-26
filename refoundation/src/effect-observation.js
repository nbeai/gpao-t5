import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, readFile, readdir } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const HASH_LIMIT = 1024 * 1024;
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function observePath(path) {
  try {
    const info = await lstat(path);
    const type = info.isFile() ? 'file' : info.isDirectory() ? 'directory' : info.isSymbolicLink() ? 'symlink' : 'other';
    const observation = {
      path, exists: true, type, size: info.size, mtimeMs: info.mtimeMs,
      filesystemIdentity: process.platform === 'win32' ? null : { dev: info.dev, ino: info.ino, nlink: info.nlink },
      mode: process.platform === 'win32' ? null : info.mode & 0o7777,
      owner: process.platform === 'win32' ? null : { uid: info.uid, gid: info.gid },
      acl: null, flags: typeof info.flags === 'number' ? info.flags : null,
    };
    if (type === 'file' && info.size <= HASH_LIMIT) {
      observation.sha256 = createHash('sha256').update(await readFile(path)).digest('hex');
    }
    if (type === 'directory') {
      try {
        const entries = (await readdir(path)).sort(); observation.entryCount = entries.length;
        observation.entryDigest = createHash('sha256').update(JSON.stringify(entries)).digest('hex');
      } catch { observation.entryCount = null; observation.entryDigest = null; }
    }
    const can = async (mode) => { try { await access(path, mode); return true; } catch { return false; } };
    observation.openability = type === 'symlink' ? { readable: null, writable: null, listable: null }
      : { readable: await can(constants.R_OK), writable: await can(constants.W_OK),
        listable: type === 'directory' ? observation.entryCount != null : null };
    const after = await lstat(path);
    if (after.dev !== info.dev || after.ino !== info.ino || after.nlink !== info.nlink
      || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs
      || after.mode !== info.mode || after.uid !== info.uid || after.gid !== info.gid
      || after.flags !== info.flags) {
      return { path, exists: null, error: 'observation_changed_during_read' };
    }
    return observation;
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { path, exists: false };
    return { path, exists: null, error: error?.message ?? String(error) };
  }
}

export async function observeDeclaredEffect(effect = {}, cwd) {
  if (effect.kind === 'external_change' || effect.kind === 'external_send'
    || effect.kind === 'payment' || effect.kind === 'secret_input') {
    return {
      schema: 't5.effect-observation-state.v2', scope: 'external', observed: false,
      targets: structuredClone(effect.targets ?? []),
      bindings: [], targetSetDigest: digest(effect.targets ?? []), cwdDigest: null,
    };
  }
  const paths = (effect.targets ?? []).map((target) => (
    isAbsolute(target) ? target : resolve(cwd, target)
  ));
  return {
    schema: 't5.effect-observation-state.v2', scope: 'local', observed: true,
    bindings: paths.map((path, index) => ({ ordinal: index,
      declaredDigest: digest((effect.targets ?? [])[index]), resolvedPathDigest: digest(path) })),
    cwdDigest: digest(resolve(cwd)),
    targetSetDigest: digest(paths),
    targets: await Promise.all(paths.map(observePath)),
  };
}

export function compareEffectObservations(declared, before, after) {
  const comparable = before?.scope === 'local' && after?.scope === 'local';
  const core = {
    schema: 't5.effect-observation.v2', declared: structuredClone(declared),
    declaredDigest: digest({ kind: declared?.kind, targets: declared?.targets ?? [] }),
    targetSetDigest: before?.targetSetDigest === after?.targetSetDigest ? before?.targetSetDigest ?? null : null,
    before: structuredClone(before),
    after: structuredClone(after),
    changed: comparable ? JSON.stringify(before.targets) !== JSON.stringify(after.targets) : null,
  };
  return { ...core, receiptDigest: digest(core) };
}
