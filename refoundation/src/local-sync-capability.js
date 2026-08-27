import { createHash } from 'node:crypto';
import { readdir, realpath, stat } from 'node:fs/promises';
import { posix, win32 } from 'node:path';

const PROVIDERS = Object.freeze([
  { id: 'dropbox', label: 'Dropbox', matches: (name) => name === 'dropbox' || name.startsWith('dropbox-') },
  { id: 'google-drive', label: 'Google Drive', matches: (name) => name === 'google drive' || name.startsWith('googledrive') },
  { id: 'onedrive', label: 'OneDrive', matches: (name) => name === 'onedrive' || name.startsWith('onedrive-') },
  { id: 'icloud-drive', label: 'iCloud Drive', matches: (name) => name === 'icloud drive' || name.includes('clouddocs') },
]);

function provider(name) {
  const normalized = String(name ?? '').trim().toLowerCase();
  return PROVIDERS.find((candidate) => candidate.matches(normalized)) ?? null;
}

function digest(value) { return createHash('sha256').update(String(value)).digest('hex'); }

function pathApi(platform) { return platform === 'win32' ? win32 : posix; }

function inside(root, candidate, separator) {
  return candidate === root || candidate.startsWith(`${root}${separator}`);
}

async function directory(path, { inspect = stat, canonicalize = realpath } = {}) {
  try {
    const info = await inspect(path);
    if (!info.isDirectory()) return null;
    return await canonicalize(path);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error?.code)) return null;
    throw error;
  }
}

async function cloudStorageCandidates(home, read = readdir, api = posix) {
  const root = api.join(home, 'Library', 'CloudStorage');
  try {
    const entries = await read(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).flatMap((entry) => {
      const matched = provider(entry.name);
      return matched ? [{ path: api.join(root, entry.name), provider: matched }] : [];
    });
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error?.code)) return [];
    throw error;
  }
}

export async function discoverLocalSyncRoots({
  platform = process.platform, home, env = process.env,
  readDirectory = readdir, inspect = stat, canonicalize = realpath,
} = {}) {
  const api = pathApi(platform);
  if (!home || !api.isAbsolute(home)) throw new TypeError('absolute home is required');
  const candidates = [];
  if (platform === 'darwin') candidates.push(...await cloudStorageCandidates(home, readDirectory, api));
  for (const item of [
    { path: api.join(home, 'Dropbox'), provider: PROVIDERS[0] },
    { path: api.join(home, 'Google Drive'), provider: PROVIDERS[1] },
    { path: api.join(home, 'OneDrive'), provider: PROVIDERS[2] },
    ...(platform === 'darwin' ? [{
      path: api.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'), provider: PROVIDERS[3],
    }] : []),
    ...(platform === 'win32' ? [env.OneDrive, env.OneDriveConsumer, env.OneDriveCommercial]
      .filter(Boolean).map((path) => ({ path, provider: PROVIDERS[2] })) : []),
  ]) candidates.push(item);
  const roots = [];
  for (const candidate of candidates) {
    if (!candidate?.path || !api.isAbsolute(candidate.path)) continue;
    const path = await directory(candidate.path, { inspect, canonicalize });
    if (!path || roots.some((item) => item.path === path)) continue;
    roots.push(Object.freeze({
      id: `sync-${candidate.provider.id}-${digest(path).slice(0, 12)}`,
      providerId: candidate.provider.id, providerLabel: candidate.provider.label, path,
      aliases: [...new Set([candidate.path, path])],
    }));
  }
  return roots;
}

export function makeLocalSyncCapability({ ttlMs = 30_000, now = Date.now, ...options } = {}) {
  const api = pathApi(options.platform ?? process.platform);
  let cached = null; let pending = null;
  async function roots() {
    if (cached && now() - cached.checkedAt < ttlMs) return cached.value;
    if (pending) return pending;
    pending = discoverLocalSyncRoots(options).then((value) => {
      cached = { checkedAt: now(), value }; return value;
    });
    try { return await pending; } finally { pending = null; }
  }
  return {
    id: 'local-sync-files', label: '컴퓨터의 동기화 폴더', category: 'local_file',
    async inspect() {
      const current = await roots(); const available = current.length > 0;
      return {
        state: available ? 'ready' : 'unavailable',
        reason: available ? 'local_sync_roots_observed' : 'local_sync_roots_absent',
        userSafeSummary: available
          ? `${[...new Set(current.map((item) => item.providerLabel))].join(', ')}의 이 컴퓨터 파일을 사용할 수 있어요.`
          : '이 컴퓨터에서 확인된 동기화 폴더가 없어요.',
        capabilities: { read: available, write: available, remote_sync_observed: false },
        routes: [],
        identity: {
          ownerApplication: 'local sync applications', transport: 'local_filesystem',
          permissions: available ? ['read', 'write'] : [],
          resources: current.slice(0, 32).map((item) => ({
            id: item.id, label: `${item.providerLabel} 로컬 폴더`, scope: 'local_files',
          })),
          observed: available,
        },
      };
    },
    async attributeCommand({ commandExplanation, cwd, declaredEffect } = {}) {
      const current = await roots(); if (!current.length) return [];
      const candidates = [cwd, ...(commandExplanation?.steps ?? []).flatMap((step) => step.argv ?? [])]
        .map(String).filter((value) => api.isAbsolute(value)).map((value) => api.resolve(value));
      const matched = current.filter((root) => root.aliases.some((alias) => candidates.some((candidate) => (
        inside(alias, candidate, api.sep)
      ))));
      if (!matched.length) return [];
      const action = declaredEffect?.kind === 'observe' ? 'read' : 'write';
      return [{
        kind: 'local_file', id: 'local-sync-files',
        providers: [...new Set(matched.map((item) => item.providerId))],
        capabilityAdmission: {
          kind: 'local_file', capabilityId: 'local-sync-files', action,
          credential: { owner: 'none', storage: 'not_applicable' },
          authority: { state: 'observed', permissions: [action] },
          execution: { state: 'unknown', adapter: 'local-filesystem' },
          effect: { state: 'unknown', kind: declaredEffect?.kind ?? 'observe' },
        },
      }];
    },
  };
}
