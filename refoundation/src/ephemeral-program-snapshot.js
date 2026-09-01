import { createHash, randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import { makeRecordReference, validateRecordReference } from './record-reference.js';

const SNAPSHOTS = new WeakSet();
const execFile = promisify(execFileCallback);
const sha256Bytes = (value) => createHash('sha256').update(value).digest('hex');
async function sha256File(path) { const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }
function inside(candidate, root) { const value = relative(root, candidate); return value === ''
  || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value)); }

async function makeWritable(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true }); await chmod(directory, 0o700);
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await makeWritable(path);
      else if (entry.isFile()) await chmod(path, 0o600);
    }
  } catch { /* cleanup remains best effort and is verified by absence */ }
}

async function removeGeneration(directory) {
  await makeWritable(directory); await rm(directory, { recursive: true, force: true });
  return lstat(directory).then(() => false).catch((error) => error?.code === 'ENOENT');
}

export async function createWorkspaceSnapshot({ workspace: workspaceValue, snapshotRoot: rootValue,
  maxEntries = 4096, maxLogicalBytes = 512 * 1024 * 1024,
  excludeTopLevelNames = [],
  clone = (source, target) => execFile('/bin/cp', ['-c', source, target], {
    timeout: 10_000, maxBuffer: 16 * 1024, env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
  }),
  makeId = randomUUID, now = () => new Date() } = {}) {
  if (!Array.isArray(excludeTopLevelNames) || excludeTopLevelNames.some((name) => (
    typeof name !== 'string' || !name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')
  ))) throw new TypeError('snapshot top-level exclusions are invalid');
  const excludedNames = new Set(excludeTopLevelNames);
  const started = performance.now(); const workspace = await realpath(resolve(workspaceValue));
  const workspaceIdentity = await lstat(workspace);
  if (!workspaceIdentity.isDirectory() || workspaceIdentity.isSymbolicLink()) {
    throw new Error('snapshot workspace is unsafe');
  }
  const snapshotRoot = resolve(rootValue); await mkdir(snapshotRoot, { recursive: true, mode: 0o700 });
  const rootIdentity = await lstat(snapshotRoot);
  if (!rootIdentity.isDirectory() || rootIdentity.isSymbolicLink() || inside(snapshotRoot, workspace)) {
    throw new Error('snapshot root is unsafe');
  }
  if ((await stat(workspace)).dev !== (await stat(snapshotRoot)).dev) {
    throw new Error('copy-on-write snapshot requires the same filesystem');
  }
  const generation = `snapshot_${String(makeId()).replaceAll('-', '_')}`;
  if (!/^snapshot_[A-Za-z0-9_]{8,200}$/u.test(generation)) throw new Error('snapshot generation is invalid');
  const directory = join(await realpath(snapshotRoot), generation); await mkdir(directory, { mode: 0o700 });
  try {
    const entries = []; const excludedTopLevel = []; let logicalBytes = 0;
    const walk = async (sourceDirectory, relativeDirectory = '') => {
      for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
        if (!relativeDirectory && excludedNames.has(entry.name)) {
          excludedTopLevel.push(entry.name); continue;
        }
        const sourcePath = join(sourceDirectory, entry.name);
        const relativePath = join(relativeDirectory, entry.name).replaceAll('\\', '/');
        const identity = await lstat(sourcePath);
        if (identity.isSymbolicLink()) throw new Error('snapshot source contains a symlink');
        if (entry.isDirectory()) { entries.push({ relativePath, kind: 'directory', identity });
          if (entries.length > maxEntries) throw new Error('snapshot entry limit exceeded');
          await walk(sourcePath, relativePath); continue; }
        if (!entry.isFile() || !identity.isFile() || identity.nlink !== 1) {
          throw new Error('snapshot source contains an unsupported or linked file');
        }
        logicalBytes += identity.size;
        if (entries.length + 1 > maxEntries || logicalBytes > maxLogicalBytes) {
          throw new Error('snapshot bound exceeded');
        }
        entries.push({ relativePath, kind: 'file', identity,
          sha256: await sha256File(sourcePath), bytes: identity.size });
      }
    };
    await walk(workspace);
    for (const entry of entries) {
      const target = join(directory, entry.relativePath);
      if (entry.kind === 'directory') await mkdir(target, { recursive: true, mode: 0o700 });
      else { await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await clone(join(workspace, entry.relativePath), target);
        if (await sha256File(target) !== entry.sha256) throw new Error('snapshot clone digest mismatch');
        await chmod(target, 0o400); }
    }
    for (const entry of entries.filter((item) => item.kind === 'file')) {
      const current = await lstat(join(workspace, entry.relativePath));
      if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1
        || current.dev !== entry.identity.dev || current.ino !== entry.identity.ino
        || current.size !== entry.identity.size || current.mtimeMs !== entry.identity.mtimeMs
        || await sha256File(join(workspace, entry.relativePath)) !== entry.sha256) {
        throw new Error('snapshot source changed during generation');
      }
    }
    for (const entry of entries.filter((item) => item.kind === 'directory').reverse()) {
      await chmod(join(directory, entry.relativePath), 0o500);
    }
    const files = entries.filter((item) => item.kind === 'file').map((item) => ({
      relativePath: item.relativePath, bytes: item.bytes, sha256: item.sha256,
      sourceIdentity: { dev: item.identity.dev, ino: item.identity.ino, size: item.identity.size,
        mtimeMs: item.identity.mtimeMs },
    }));
    const directories = entries.filter((item) => item.kind === 'directory')
      .map((item) => item.relativePath);
    const manifestSha256 = sha256Bytes(JSON.stringify(files.map(({ relativePath, bytes, sha256 }) => (
      { relativePath, bytes, sha256 }
    ))));
    const reportedFileBlocksBytes = (await Promise.all(files.map(async (item) => (
      (await stat(join(directory, item.relativePath))).blocks * 512
    )))).reduce((sum, value) => sum + value, 0);
    const snapshot = Object.freeze({ schema: 't5.workspace-snapshot-qualification.v1',
      generation, workspace, directory, files, manifestSha256, logicalBytes,
      directories, excludedTopLevelNames: excludedTopLevel.sort(), reportedFileBlocksBytes,
      recordedAt: now().toISOString(), state: 'snapshot_read_only' });
    SNAPSHOTS.add(snapshot);
    return { snapshot, receipt: { state: 'snapshot_read_only', fileCount: files.length,
      directoryCount: entries.length - files.length, logicalBytes, reportedFileBlocksBytes, manifestSha256,
      wallMs: Number((performance.now() - started).toFixed(3)), exactActualReadSet: false,
      ...(excludedTopLevel.length ? { excludedTopLevelNames: excludedTopLevel.sort() } : {}),
      originalWrites: 0, providerBytes: 0 } };
  } catch (error) {
    if (!await removeGeneration(directory)) throw new Error('snapshot cleanup is unknown');
    throw error;
  }
}

export function snapshotProgramBindings(snapshot, { sessionId, workId, excludeRelativePaths = [] } = {}) {
  if (!SNAPSHOTS.has(snapshot) || snapshot.state !== 'snapshot_read_only') {
    throw new TypeError('qualified workspace snapshot required');
  }
  const records = new Map();
  const excluded = new Set(excludeRelativePaths.map(String));
  const bindings = snapshot.files.filter((file) => !excluded.has(file.relativePath)).map((file, index) => {
    const recordRef = makeRecordReference({ sourceKind: 'local_file', sourceStore: 'workspace_snapshot',
      sourceId: `${snapshot.generation}:${index}`, sourceRevision: snapshot.manifestSha256,
      sha256: file.sha256, occurredAt: null, recordedAt: snapshot.recordedAt,
      scope: { sessionId, workId, subjectKeys: [], channel: null }, trust: 'runtime_observed',
      sensitivity: 'personal', coverage: 'full', availability: 'available' });
    records.set(recordRef.recordId, file); return { relativePath: file.relativePath, recordRef };
  });
  return { bindings, sourceReader: { async reopen(input, expectations = {}) {
    const reference = validateRecordReference(input); const file = records.get(reference.recordId);
    if (!file || expectations.expectedSessionId !== sessionId || expectations.expectedWorkId !== workId) {
      return { state: 'permission_denied', source: null, accounting: { digestMatched: null } };
    }
    try { const source = await readFile(join(snapshot.directory, file.relativePath));
      const digestMatched = sha256Bytes(source) === file.sha256;
      return digestMatched ? { state: 'reopened', source, accounting: { digestMatched: true } }
        : { state: 'changed', source: null, accounting: { digestMatched: false } }; }
    catch (error) { return { state: error?.code === 'ENOENT' ? 'missing' : 'unknown',
      source: null, accounting: { digestMatched: null } }; }
  } } };
}

export async function verifyWorkspaceSnapshotSources(snapshot) {
  if (!SNAPSHOTS.has(snapshot) || snapshot.state !== 'snapshot_read_only') {
    throw new TypeError('qualified workspace snapshot required');
  }
  for (const file of snapshot.files) {
    const path = join(snapshot.workspace, file.relativePath); const current = await lstat(path);
    if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1
      || current.dev !== file.sourceIdentity.dev || current.ino !== file.sourceIdentity.ino
      || current.size !== file.sourceIdentity.size || current.mtimeMs !== file.sourceIdentity.mtimeMs
      || await sha256File(path) !== file.sha256) return { state: 'source_universe_changed', verified: false };
  }
  return { state: 'source_universe_verified', verified: true, fileCount: snapshot.files.length,
    manifestSha256: snapshot.manifestSha256 };
}

export async function cleanupWorkspaceSnapshotRoot(rootValue) {
  const root = resolve(rootValue); let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error?.code === 'ENOENT') return { state: 'snapshot_root_clean', removed: 0 };
    throw error; }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^snapshot_[A-Za-z0-9_]{8,200}$/u.test(entry.name)) continue;
    if (await removeGeneration(join(root, entry.name))) removed += 1;
  }
  return { state: 'snapshot_root_clean', removed };
}

export async function removeWorkspaceSnapshot(snapshot) {
  if (!SNAPSHOTS.has(snapshot)) throw new TypeError('qualified workspace snapshot required');
  const removed = await removeGeneration(snapshot.directory); SNAPSHOTS.delete(snapshot);
  return { state: removed ? 'snapshot_removed' : 'snapshot_cleanup_unknown', removed };
}
