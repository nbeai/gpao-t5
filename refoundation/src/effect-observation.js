import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const HASH_LIMIT = 1024 * 1024;

async function observePath(path) {
  try {
    const info = await lstat(path);
    const type = info.isFile() ? 'file' : info.isDirectory() ? 'directory' : info.isSymbolicLink() ? 'symlink' : 'other';
    const observation = {
      path, exists: true, type, size: info.size, mtimeMs: info.mtimeMs,
    };
    if (type === 'file' && info.size <= HASH_LIMIT) {
      observation.sha256 = createHash('sha256').update(await readFile(path)).digest('hex');
    }
    return observation;
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { path, exists: false };
    return { path, exists: null, error: error?.message ?? String(error) };
  }
}

export async function observeDeclaredEffect(effect = {}, cwd) {
  if (effect.kind === 'external_send' || effect.kind === 'payment' || effect.kind === 'secret_input') {
    return {
      scope: 'external', observed: false,
      targets: structuredClone(effect.targets ?? []),
    };
  }
  const paths = (effect.targets ?? []).map((target) => (
    isAbsolute(target) ? target : resolve(cwd, target)
  ));
  return {
    scope: 'local', observed: true,
    targets: await Promise.all(paths.map(observePath)),
  };
}

export function compareEffectObservations(declared, before, after) {
  const comparable = before?.scope === 'local' && after?.scope === 'local';
  return {
    declared: structuredClone(declared),
    before: structuredClone(before),
    after: structuredClone(after),
    changed: comparable ? JSON.stringify(before.targets) !== JSON.stringify(after.targets) : null,
  };
}
