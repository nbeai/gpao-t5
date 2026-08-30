import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { validateCapabilityPackage } from './capability-package-contract.js';

const MAX_FILES = 400; const MAX_BYTES = 64 * 1024 * 1024;
const hash = (value) => createHash('sha256').update(value).digest('hex');
function inside(root, path) { const rel = relative(root, path); return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`)); }

async function tree(root) {
  const entries = []; let bytes = 0; let fileCount = 0;
  async function walk(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name); const info = await lstat(path);
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()) || (info.isFile() && info.nlink !== 1)) {
        throw new Error('capability package tree contains an unsafe entry');
      }
      if (info.isDirectory()) await walk(path);
      else { bytes += info.size; if (++fileCount > MAX_FILES || bytes > MAX_BYTES) throw new Error('capability package tree is too large');
        const rel = relative(root, path).split(sep).join('/');
        entries.push({ path: rel, bytes: info.size, sha256: hash(await readFile(path)) }); }
    }
  }
  await walk(root);
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const payload = entries.filter((item) => item.path !== 'capability.json');
  return { entries, bytes, payloadDigest: hash(JSON.stringify(payload)) };
}

export async function inspectLocalCapabilityPackage(sourcePath) {
  const requested = resolve(String(sourcePath ?? '')); const root = await realpath(requested);
  const rootInfo = await lstat(root); if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('capability package root is invalid');
  const raw = await readFile(join(root, 'capability.json'), 'utf8');
  const packageDefinition = validateCapabilityPackage(JSON.parse(raw));
  if (packageDefinition.manifest.source.kind !== 'local_directory') throw new Error('local package requires local_directory source');
  const observed = await tree(root);
  if (observed.payloadDigest !== packageDefinition.manifest.source.artifactDigest) throw new Error('capability package payload digest mismatch');
  return { root, package: packageDefinition, manifestDigest: hash(raw), observed };
}

async function readState(file) { try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return { schema: 't5.capability-package-store.v1', packages: {} }; throw error; } }
async function atomic(file, value) { await mkdir(resolve(file, '..'), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await rename(temp, file); }

export class LocalCapabilityPackageStore {
  constructor(root) { if (!root) throw new TypeError('capability package store root is required'); this.root = root; this.file = join(root, 'state.json'); this.queue = Promise.resolve(); }
  serialize(work) { const next = this.queue.then(work, work); this.queue = next.catch(() => {}); return next; }
  generationPath(id, generationId) { return join(this.root, 'packages', id, generationId); }
  async inspect(sourcePath) { const value = await inspectLocalCapabilityPackage(sourcePath); return { id: value.package.id,
    version: value.package.version, kind: value.package.manifest.kind, source: value.package.manifest.source,
    manifestDigest: value.manifestDigest,
    payloadDigest: value.observed.payloadDigest, files: value.observed.entries.length, bytes: value.observed.bytes,
    state: 'structurally_checked' }; }
  async installInactive(sourcePath) { return this.serialize(async () => { const inspected = await inspectLocalCapabilityPackage(sourcePath);
    const state = await readState(this.file); const id = inspected.package.id; const generationId = `gen-${randomUUID()}`;
    const destination = this.generationPath(id, generationId); const staging = `${destination}.staging`;
    await mkdir(resolve(destination, '..'), { recursive: true, mode: 0o700 });
    try { await cp(inspected.root, staging, { recursive: true, force: false, errorOnExist: true });
      const copied = await inspectLocalCapabilityPackage(staging);
      if (copied.observed.payloadDigest !== inspected.observed.payloadDigest) throw new Error('installed package readback mismatch');
      await rename(staging, destination);
    } finally { await rm(staging, { recursive: true, force: true }); }
    const row = state.packages[id] ?? { activeGenerationId: null, previousGenerationIds: [], generations: [] };
    row.generations.push({ generationId, version: inspected.package.version,
      manifestDigest: inspected.manifestDigest, payloadDigest: inspected.observed.payloadDigest,
      source: inspected.package.manifest.source, state: 'installed_inactive' }); state.packages[id] = row; await atomic(this.file, state);
    return { id, generationId, version: inspected.package.version, state: 'installed_inactive' }; }); }
  async enable(id, generationId) { return this.serialize(async () => { const state = await readState(this.file); const row = state.packages[id];
    const generation = row?.generations.find((item) => item.generationId === generationId);
    if (!generation) throw new Error('capability generation not found');
    if (row.activeGenerationId && row.activeGenerationId !== generationId) row.previousGenerationIds.push(row.activeGenerationId);
    row.activeGenerationId = generationId; for (const item of row.generations) item.state = item.generationId === generationId ? 'active' : 'installed_inactive';
    await atomic(this.file, state); return { id, generationId, state: 'active' }; }); }
  async disable(id) { return this.serialize(async () => { const state = await readState(this.file); const row = state.packages[id];
    if (!row?.activeGenerationId) return { id, state: 'inactive' }; row.previousGenerationIds.push(row.activeGenerationId);
    const prior = row.generations.find((item) => item.generationId === row.activeGenerationId); if (prior) prior.state = 'installed_inactive';
    row.activeGenerationId = null; await atomic(this.file, state); return { id, state: 'inactive' }; }); }
  async rollback(id) { return this.serialize(async () => { const state = await readState(this.file); const row = state.packages[id];
    const previous = row?.previousGenerationIds.pop(); if (!previous) throw new Error('rollback generation not found');
    if (row.activeGenerationId && row.activeGenerationId !== previous) row.previousGenerationIds.push(row.activeGenerationId);
    row.activeGenerationId = previous; for (const item of row.generations) item.state = item.generationId === previous ? 'active' : 'installed_inactive';
    await atomic(this.file, state); return { id, generationId: previous, state: 'active' }; }); }
  async openActive(id) {
    const state = await readState(this.file); const row = state.packages[id];
    if (!row?.activeGenerationId) throw new Error('capability package is not active');
    const generation = row.generations.find((item) => item.generationId === row.activeGenerationId);
    if (!generation || generation.state !== 'active') throw new Error('active capability generation is inconsistent');
    const reopened = await inspectLocalCapabilityPackage(this.generationPath(id, generation.generationId));
    if (reopened.package.id !== id || reopened.package.version !== generation.version
      || reopened.manifestDigest !== generation.manifestDigest
      || reopened.observed.payloadDigest !== generation.payloadDigest) {
      throw new Error('active capability generation readback mismatch');
    }
    return { id, generationId: generation.generationId, version: generation.version,
      payloadDigest: generation.payloadDigest, package: reopened.package };
  }
  async uninstall(id, generationId) { return this.serialize(async () => { const state = await readState(this.file); const row = state.packages[id];
    if (!row) throw new Error('capability package not found'); if (row.activeGenerationId === generationId) throw new Error('active generation must be disabled first');
    const index = row.generations.findIndex((item) => item.generationId === generationId); if (index < 0) throw new Error('capability generation not found');
    const target = this.generationPath(id, generationId); if (!inside(this.root, target)) throw new Error('capability generation path escaped store');
    await rm(target, { recursive: true, force: true }); row.generations.splice(index, 1); row.previousGenerationIds = row.previousGenerationIds.filter((item) => item !== generationId);
    if (!row.generations.length) delete state.packages[id]; await atomic(this.file, state); return { id, generationId, state: 'removed' }; }); }
  async list() { const state = await readState(this.file); return structuredClone(state.packages); }
}
