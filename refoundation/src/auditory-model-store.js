import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  chmod, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, statfs, writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/u;
const ID = /^[a-z0-9][a-z0-9-]{1,63}$/u;
const REVISION = /^[a-f0-9]{40}$/u;
const STATE_SCHEMA = 't5.auditory-model-store.v1';

function clone(value) { return structuredClone(value); }
function inside(root, path) { const rel = relative(root, path); return rel === ''
  || (rel !== '..' && !rel.startsWith(`..${sep}`)); }

async function digestFile(path) {
  const digest = createHash('sha256');
  await new Promise((resolve, reject) => { const stream = createReadStream(path);
    stream.on('data', (chunk) => digest.update(chunk)); stream.once('error', reject); stream.once('end', resolve); });
  return digest.digest('hex');
}

async function rejectSymlink(path) {
  try { if ((await lstat(path)).isSymbolicLink()) throw new Error('auditory model root contains a symlink'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

function validateAsset(value) {
  if (!ID.test(value?.id ?? '') || typeof value.model !== 'string' || !value.model
    || !['ggml-f16', 'ggml-q5_0'].includes(value.format)
    || !REVISION.test(value.sourceRevision ?? '') || !SHA256.test(value.sha256 ?? '')
    || !Number.isInteger(value.bytes) || value.bytes < 1024 * 1024 || value.bytes > 4 * 1024 * 1024 * 1024
    || value.license !== 'MIT') throw new Error('invalid auditory model asset');
  const url = new URL(value.url);
  if (url.protocol !== 'https:' || url.username || url.password
    || !url.pathname.includes(value.sourceRevision)) throw new Error('auditory model URL is not immutable');
  return Object.freeze({ ...clone(value), url: url.href });
}

export function loadAuditoryModelCatalog(value) {
  const raw = typeof value === 'string' ? JSON.parse(value) : clone(value);
  if (raw?.schema !== 't5.auditory-model-assets.v1' || !Array.isArray(raw.assets)) {
    throw new Error('invalid auditory model catalog');
  }
  const assets = raw.assets.map(validateAsset); const byId = new Map();
  for (const asset of assets) { if (byId.has(asset.id)) throw new Error('duplicate auditory model asset'); byId.set(asset.id, asset); }
  if (!byId.has(raw.defaultAssetId) || byId.get(raw.defaultAssetId).default !== true
    || assets.filter((asset) => asset.default).length !== 1) throw new Error('auditory default model is invalid');
  return Object.freeze({ defaultAssetId: raw.defaultAssetId, assets: Object.freeze(assets), byId });
}

async function readState(path) {
  try { const state = JSON.parse(await readFile(path, 'utf8'));
    if (state?.schema !== STATE_SCHEMA || !state.models || typeof state.models !== 'object') throw new Error('invalid auditory model state');
    return state;
  } catch (error) { if (error?.code === 'ENOENT') return { schema: STATE_SCHEMA, models: {} }; throw error; }
}

async function atomic(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

function contentRangeStart(response) {
  const header = response.headers?.get?.('content-range');
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(String(header ?? ''));
  return match ? { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) } : null;
}

export class AuditoryModelStore {
  constructor({ root, catalog, fetchImpl = fetch, makeId = randomUUID, minimumFreeBytes = 512 * 1024 * 1024 } = {}) {
    if (!root || !catalog?.byId) throw new TypeError('auditory model store inputs are required');
    this.root = root; this.catalog = catalog; this.fetch = fetchImpl; this.makeId = makeId;
    this.minimumFreeBytes = minimumFreeBytes; this.stateFile = join(root, 'state.json');
    this.downloads = join(root, 'downloads'); this.generations = join(root, 'generations'); this.queue = Promise.resolve();
  }
  serialize(work) { const next = this.queue.then(work, work); this.queue = next.catch(() => {}); return next; }
  async ensure() { await rejectSymlink(this.root); await mkdir(this.root, { recursive: true, mode: 0o700 });
    for (const path of [this.root, this.downloads, this.generations]) { await rejectSymlink(path); await mkdir(path, { recursive: true, mode: 0o700 }); await chmod(path, 0o700); } }
  partialPath(asset) { return join(this.downloads, `${asset.id}-${asset.sourceRevision}.partial`); }
  generationPath(assetId, generationId) { return join(this.generations, assetId, generationId, 'model.bin'); }
  async streamAsset(asset, { signal = null, onProgress = null } = {}) {
    await this.ensure(); const partial = this.partialPath(asset); await rejectSymlink(partial);
    let existing = 0;
    try { const info = await lstat(partial); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > asset.bytes) throw new Error('auditory model partial is unsafe'); existing = info.size; }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const free = await statfs(this.root).then((value) => Number(value.bavail) * Number(value.bsize));
    if (free < asset.bytes - existing + this.minimumFreeBytes) throw new Error('auditory model disk space is insufficient');
    const headers = existing ? { Range: `bytes=${existing}-` } : {};
    const response = await this.fetch(asset.url, { redirect: 'follow', headers, signal });
    if (!response?.ok) throw new Error(`auditory model download failed (${response?.status ?? 'unknown'})`);
    const range = contentRangeStart(response); let offset = existing;
    if (existing && (response.status !== 206 || range?.start !== existing || range.total !== asset.bytes)) {
      if (response.status !== 200) throw new Error('auditory model resume response is invalid');
      offset = 0;
    }
    const handle = await open(partial, offset ? 'r+' : 'w', 0o600);
    try {
      if (!offset) await handle.truncate(0);
      const reader = response.body?.getReader?.(); if (!reader) throw new Error('auditory model response is not streamable');
      let position = offset;
      for (;;) { if (signal?.aborted) throw signal.reason ?? new Error('auditory model download interrupted');
        const { done, value } = await reader.read(); if (done) break;
        if (position + value.byteLength > asset.bytes) { await reader.cancel().catch(() => {}); throw new Error('auditory model download is too large'); }
        await handle.write(Buffer.from(value), 0, value.byteLength, position); position += value.byteLength;
        await onProgress?.({ assetId: asset.id, receivedBytes: position, expectedBytes: asset.bytes }); }
      await handle.sync(); if (position !== asset.bytes) throw new Error('auditory model download is incomplete');
    } finally { await handle.close(); }
    await chmod(partial, 0o600);
    if (await digestFile(partial) !== asset.sha256) { await rm(partial, { force: true }); throw new Error('auditory model digest mismatch'); }
    return partial;
  }
  async installInactive(assetId, options = {}) { return this.serialize(async () => {
    const asset = this.catalog.byId.get(assetId); if (!asset) throw new Error('auditory model asset not found');
    const partial = await this.streamAsset(asset, options); const generationId = `gen-${this.makeId()}`;
    const target = this.generationPath(assetId, generationId); await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await rename(partial, target); await chmod(target, 0o600);
    const state = await readState(this.stateFile); const row = state.models[assetId]
      ?? { activeGenerationId: null, previousGenerationIds: [], generations: [] };
    row.generations.push({ generationId, assetId, sourceRevision: asset.sourceRevision,
      bytes: asset.bytes, sha256: asset.sha256, state: 'installed_inactive', qualificationDigest: null });
    state.models[assetId] = row; await atomic(this.stateFile, state);
    return { state: 'installed_inactive', assetId, generationId, bytes: asset.bytes };
  }); }
  async qualify(assetId, generationId, qualify) { return this.serialize(async () => {
    if (typeof qualify !== 'function') throw new TypeError('auditory model qualifier is required');
    const state = await readState(this.stateFile); const row = state.models[assetId];
    const generation = row?.generations.find((item) => item.generationId === generationId);
    if (!generation || generation.state !== 'installed_inactive') throw new Error('auditory model generation is unavailable');
    const path = this.generationPath(assetId, generationId); const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== generation.bytes
      || await digestFile(path) !== generation.sha256) throw new Error('auditory model generation identity changed');
    const receipt = await qualify({ path, asset: clone(this.catalog.byId.get(assetId)) });
    if (receipt?.qualified !== true || !SHA256.test(receipt.receiptDigest ?? '')) {
      return { state: 'installed_inactive', assetId, generationId, qualified: false };
    }
    generation.state = 'fixture_qualified'; generation.qualificationDigest = receipt.receiptDigest;
    await atomic(this.stateFile, state); return { state: 'fixture_qualified', assetId, generationId,
      qualificationDigest: receipt.receiptDigest };
  }); }
  async activate(assetId, generationId) { return this.serialize(async () => {
    const state = await readState(this.stateFile); const row = state.models[assetId];
    const generation = row?.generations.find((item) => item.generationId === generationId);
    if (!generation || generation.state !== 'fixture_qualified') throw new Error('auditory model is not fixture-qualified');
    if (row.activeGenerationId && row.activeGenerationId !== generationId) row.previousGenerationIds.push(row.activeGenerationId);
    row.activeGenerationId = generationId;
    for (const item of row.generations) item.state = item.generationId === generationId ? 'active'
      : item.state === 'active' ? 'fixture_qualified' : item.state;
    await atomic(this.stateFile, state); return { state: 'active', assetId, generationId };
  }); }
  async openActive(assetId) { await this.ensure(); const state = await readState(this.stateFile); const row = state.models[assetId];
    const generation = row?.generations.find((item) => item.generationId === row.activeGenerationId);
    if (!generation || generation.state !== 'active') return { state: 'not_present', assetId };
    const path = this.generationPath(assetId, generation.generationId); const exact = await realpath(path);
    const canonicalRoot = await realpath(this.root);
    if (!inside(canonicalRoot, exact)) throw new Error('auditory model generation escaped store'); const info = await lstat(exact);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== generation.bytes
      || await digestFile(exact) !== generation.sha256) throw new Error('active auditory model identity changed');
    return { state: 'active', assetId, generationId: generation.generationId, path: exact,
      bytes: generation.bytes, sha256: generation.sha256, qualificationDigest: generation.qualificationDigest };
  }
}
