import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { posix, win32 } from 'node:path';

function pathApi(platform) {
  return platform === 'win32' ? win32 : posix;
}

function isAbsoluteFor(platform, value) {
  return platform === 'win32'
    ? /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value)
    : value.startsWith('/');
}

export function revealInvocation(platform, path, targetType) {
  if (platform === 'darwin') {
    return targetType === 'file'
      ? { program: 'open', args: ['-R', path] }
      : { program: 'open', args: [path] };
  }
  if (platform === 'win32') {
    return targetType === 'file'
      ? { program: 'explorer.exe', args: [`/select,${path}`] }
      : { program: 'explorer.exe', args: [path] };
  }
  const target = targetType === 'file' ? pathApi(platform).dirname(path) : path;
  return { program: 'xdg-open', args: [target] };
}

async function closestExisting(path, platform, statPath) {
  const api = pathApi(platform);
  let candidate = path;
  while (true) {
    try {
      const info = await statPath(candidate);
      return { path: candidate, targetType: info.isDirectory() ? 'directory' : 'file' };
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      const parent = api.dirname(candidate);
      if (parent === candidate) throw new Error('No existing parent found for path');
      candidate = parent;
    }
  }
}

export function makePathRevealer({
  platform = process.platform,
  userHome,
  statPath = stat,
  spawnProcess = spawn,
} = {}) {
  return async function revealPath(rawPath, options = {}) {
    const raw = String(rawPath ?? '').trim();
    const requestedPath = /^~[\\/]/.test(raw) && userHome
      ? pathApi(platform).join(userHome, raw.slice(2)) : raw;
    if (!requestedPath || requestedPath.includes('\0') || !isAbsoluteFor(platform, requestedPath)) {
      throw Object.assign(new Error('absolute path is required'), { status: 400 });
    }
    let found;
    if (options.exactFile === true) {
      let info;
      try { info = await statPath(requestedPath); }
      catch { throw Object.assign(new Error('exact file is unavailable'), { status: 409 }); }
      if (info.isDirectory?.()) throw Object.assign(new Error('exact file is unavailable'), { status: 409 });
      if (Number.isSafeInteger(options.bytes) && info.size !== options.bytes) {
        throw Object.assign(new Error('exact file identity changed'), { status: 409 });
      }
      if (options.modifiedAt && info.mtime?.toISOString?.() !== options.modifiedAt) {
        throw Object.assign(new Error('exact file identity changed'), { status: 409 });
      }
      found = { path: requestedPath, targetType: 'file' };
    } else found = await closestExisting(requestedPath, platform, statPath);
    const invocation = revealInvocation(platform, found.path, found.targetType);
    const child = spawnProcess(invocation.program, invocation.args, { stdio: 'ignore', detached: true });
    child.unref?.();
    return {
      requestedPath,
      openedPath: found.path,
      targetType: found.path === requestedPath ? found.targetType : 'nearest_existing_parent',
    };
  };
}
