import { createHash, randomUUID } from 'node:crypto';
import {
  appendFile, chmod, copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile,
} from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { delimiter, join } from 'node:path';
import { EFFECT_SCHEMA } from './exec-tool.js';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const PLATFORM_KEYS = new Set([
  'darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64',
]);
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const EXPOSURES = new Set(['path', 'tool_only']);
const TOOL_SURFACE = /^[a-z][a-z0-9_]{0,63}$/u;

function https(value, label) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${label} must be an HTTPS URL`); }
  if (parsed.protocol !== 'https:') throw new Error(`${label} must be an HTTPS URL`);
  return parsed.href;
}

function executableName(command, platform) {
  return platform === 'win32' ? `${command}.exe` : command;
}

function publicPackage(entry) {
  return {
    id: entry.id, title: entry.title, command: entry.command, description: entry.description,
    exposure: entry.exposure, ...(entry.toolSurface ? { toolSurface: entry.toolSurface } : {}),
    officialSource: entry.officialSource, license: structuredClone(entry.license),
    defaultVersion: entry.defaultVersion, versions: Object.keys(entry.versions).sort(),
  };
}

export async function loadCliCatalog(input) {
  const raw = typeof input === 'string' ? JSON.parse(await readFile(input, 'utf8')) : structuredClone(input);
  if (raw?.schema !== 't5.cli-catalog.v1' || !Array.isArray(raw.packages)) throw new Error('invalid CLI catalog schema');
  const byId = new Map(); const commands = new Set();
  for (const entry of raw.packages) {
    if (!ID.test(entry?.id ?? '') || !ID.test(entry?.command ?? '')) throw new Error('invalid CLI package identity');
    if (byId.has(entry.id) || commands.has(entry.command)) throw new Error('duplicate CLI package id or command');
    if (typeof entry.title !== 'string' || typeof entry.description !== 'string') throw new Error('invalid CLI package metadata');
    if (!EXPOSURES.has(entry.exposure)
      || (entry.exposure === 'tool_only' && !TOOL_SURFACE.test(entry.toolSurface ?? ''))
      || (entry.exposure === 'path' && entry.toolSurface != null)) throw new Error('invalid CLI exposure');
    entry.verifyTimeoutMs ??= 5000;
    if (!Number.isInteger(entry.verifyTimeoutMs) || entry.verifyTimeoutMs < 1000 || entry.verifyTimeoutMs > 30_000) {
      throw new Error('invalid CLI verification timeout');
    }
    entry.officialSource = https(entry.officialSource, 'officialSource');
    if (!entry.license || typeof entry.license.spdx !== 'string') throw new Error('CLI package license is required');
    entry.license.url = https(entry.license.url, 'license URL');
    if (!VERSION.test(entry.defaultVersion ?? '') || !entry.versions?.[entry.defaultVersion]) throw new Error('invalid default CLI version');
    for (const [version, release] of Object.entries(entry.versions)) {
      if (!VERSION.test(version) || !release?.assets || typeof release.assets !== 'object') throw new Error('invalid CLI version');
      release.releaseUrl = https(release.releaseUrl, 'release URL');
      for (const [key, asset] of Object.entries(release.assets)) {
        if (!PLATFORM_KEYS.has(key) || !SHA256.test(asset?.sha256 ?? '')
          || !Number.isInteger(asset?.bytes) || asset.bytes < 1 || asset.bytes > DEFAULT_MAX_BYTES) throw new Error('invalid CLI asset');
        asset.url = https(asset.url, 'asset URL');
      }
    }
    byId.set(entry.id, entry); commands.add(entry.command);
  }
  return Object.freeze({
    packages: Object.freeze([...byId.values()].map(publicPackage)), byId,
    asset(id, version, platform, architecture) {
      const entry = byId.get(id); const release = entry?.versions?.[version];
      const asset = release?.assets?.[`${platform}-${architecture}`];
      if (!entry) throw new Error('trusted CLI package not found');
      if (!release) throw new Error('trusted CLI version not found');
      if (!asset) throw new Error('CLI package is not available for this computer');
      return { ...structuredClone(asset), releaseUrl: release.releaseUrl };
    },
  });
}

async function rejectSymlink(path) {
  try { if ((await lstat(path)).isSymbolicLink()) throw new Error('managed CLI root contains a symlink'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

async function regularFile(path) {
  try { const info = await lstat(path); return info.isFile() && !info.isSymbolicLink(); }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

async function responseBytes(response, maxBytes, expectedBytes) {
  if (!response?.ok) throw new Error(`CLI download failed (${response?.status ?? 'unknown'})`);
  const declaredHeader = response.headers?.get?.('content-length');
  const declared = declaredHeader == null ? null : Number(declaredHeader);
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('CLI download is too large');
  if (Number.isFinite(declared) && declared !== expectedBytes) throw new Error('CLI download size mismatch');
  const reader = response.body?.getReader?.();
  if (!reader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error('CLI download is too large');
    if (bytes.length !== expectedBytes) throw new Error('CLI download size mismatch');
    return bytes;
  }
  const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel().catch(() => {}); throw new Error('CLI download is too large'); }
    chunks.push(Buffer.from(value));
  }
  if (total !== expectedBytes) throw new Error('CLI download size mismatch');
  return Buffer.concat(chunks, total);
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

async function defaultVerifyExecutable({ path, expectedVersion, timeoutMs = 5000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(path, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', LANG: 'C' }, windowsHide: true,
    });
    let stdout = ''; let stderr = ''; let bytes = 0; let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const collect = (kind) => (chunk) => {
      bytes += chunk.length;
      if (bytes > 8192) { child.kill(); finish(new Error('CLI verification output is too large')); return; }
      if (kind === 'stdout') stdout += chunk; else stderr += chunk;
    };
    child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
    child.once('error', (error) => finish(error));
    child.once('close', (code) => {
      const output = `${stdout}\n${stderr}`.trim();
      if (code !== 0 || !output.includes(expectedVersion)) finish(new Error('CLI version verification failed'));
      else finish(null, { version: expectedVersion, output });
    });
    const timer = setTimeout(() => { child.kill(); finish(new Error('CLI version verification timed out')); }, timeoutMs);
  });
}

export class ManagedCliStore {
  constructor({ root, catalog, platform = process.platform, architecture = process.arch, fetchImpl = fetch, verifyExecutable = defaultVerifyExecutable, maxBytes = DEFAULT_MAX_BYTES } = {}) {
    if (!root || !catalog?.byId) throw new TypeError('managed CLI store inputs are required');
    this.root = root; this.catalog = catalog; this.platform = platform; this.architecture = architecture;
    this.fetch = fetchImpl; this.verifyExecutable = verifyExecutable; this.maxBytes = maxBytes;
    this.bin = join(root, 'bin'); this.privateBin = join(root, 'private-bin'); this.versions = join(root, 'versions'); this.trash = join(root, 'trash');
    this.ledger = join(root, 'cli-lifecycle.jsonl'); this.queue = Promise.resolve();
  }
  serialize(work) { const next = this.queue.then(work, work); this.queue = next.catch(() => {}); return next; }
  async ensure() {
    await rejectSymlink(this.root);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    for (const path of [this.root, this.bin, this.privateBin, this.versions, this.trash]) {
      await rejectSymlink(path); await mkdir(path, { recursive: true, mode: 0o700 }); await chmod(path, 0o700);
    }
  }
  prependPath(existing = '') { return [this.bin, existing].filter(Boolean).join(delimiter); }
  entry(id) { const entry = this.catalog.byId.get(id); if (!entry) throw new Error('trusted CLI package not found'); return entry; }
  binaryPath(id) { const entry = this.entry(id); return join(entry.exposure === 'tool_only' ? this.privateBin : this.bin, executableName(entry.command, this.platform)); }
  versionPath(id, version) { const entry = this.entry(id); return join(this.versions, id, version, executableName(entry.command, this.platform)); }
  statePath(id) { return join(this.root, `${id}.json`); }
  async append(type, payload) { await this.ensure(); await appendFile(this.ledger, `${JSON.stringify({ schema: 't5.cli-lifecycle.v1', type, recordedAt: new Date().toISOString(), ...payload })}\n`, { mode: 0o600 }); await chmod(this.ledger, 0o600); }
  async readState(id) { try { return JSON.parse(await readFile(this.statePath(id), 'utf8')); } catch (error) { if (error?.code === 'ENOENT') return { activeVersion: null, history: [] }; throw error; } }
  async writeState(id, state) { const temp = `${this.statePath(id)}.${randomUUID()}.tmp`; try { await writeFile(temp, JSON.stringify({ schema: 't5.cli-state.v1', id, ...state }), { mode: 0o600 }); await chmod(temp, 0o600); await rename(temp, this.statePath(id)); } finally { await rm(temp, { force: true }); } }
  async matchingVersion(id, path) {
    let bytes; try { bytes = await readFile(path); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
    const actual = digest(bytes); const entry = this.entry(id);
    return Object.keys(entry.versions).find((version) => {
      try { return this.catalog.asset(id, version, this.platform, this.architecture).sha256 === actual; } catch { return false; }
    }) ?? null;
  }
  async status(id) {
    await this.ensure(); const entry = this.entry(id); const path = this.binaryPath(id); const actualVersion = await this.matchingVersion(id, path);
    const state = await this.readState(id);
    if (actualVersion !== state.activeVersion) await this.writeState(id, { activeVersion: actualVersion, history: state.history ?? [] });
    return {
      state: actualVersion ? 'installed' : 'not_installed', ...publicPackage(entry), activeVersion: actualVersion,
      ...(entry.exposure === 'path' ? { managedPath: actualVersion ? path : null } : { availableThrough: entry.toolSurface }),
    };
  }
  async installed() { const results = await Promise.all(this.catalog.packages.map((item) => this.status(item.id))); return results.filter((item) => item.state === 'installed'); }
  async activeRevision(id) { const current = await this.status(id); if (!current.activeVersion) return { active: false, version: null, digest: null }; const asset = this.catalog.asset(id, current.activeVersion, this.platform, this.architecture); return { active: true, version: current.activeVersion, digest: asset.sha256 }; }
  async attributeCommand(explanation) {
    const executables = new Set((explanation?.steps ?? []).map((step) => String(step?.executable ?? '')).filter(Boolean));
    if (!executables.size) return [];
    const used = [];
    for (const active of await this.installed()) {
      if (this.entry(active.id).exposure !== 'path') continue;
      const command = executableName(this.entry(active.id).command, this.platform);
      const matched = [...executables].some((executable) => (
        executable === active.managedPath
        || (!/[\\/]/u.test(executable) && (executable === command || executable === this.entry(active.id).command))
      ));
      if (!matched) continue;
      const asset = this.catalog.asset(active.id, active.activeVersion, this.platform, this.architecture);
      used.push({ kind: 'cli', id: active.id, version: active.activeVersion, digest: asset.sha256 });
    }
    return used;
  }
  async ensureVersion(id, version) {
    const asset = this.catalog.asset(id, version, this.platform, this.architecture); const target = this.versionPath(id, version);
    const packageDirectory = join(this.versions, id); const directory = join(packageDirectory, version);
    await rejectSymlink(packageDirectory); await mkdir(packageDirectory, { recursive: true, mode: 0o700 }); await chmod(packageDirectory, 0o700);
    await rejectSymlink(directory); await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
    await rejectSymlink(target);
    if (await this.matchingVersion(id, target) === version) return { target, asset, downloaded: false };
    const bytes = await responseBytes(
      await this.fetch(asset.url, { redirect: 'follow' }), Math.min(this.maxBytes, asset.bytes), asset.bytes,
    );
    if (digest(bytes) !== asset.sha256) throw new Error('CLI SHA-256 verification failed');
    const temporary = join(directory, `.download-${randomUUID()}`);
    try {
      await writeFile(temporary, bytes, { mode: 0o600 }); await chmod(temporary, 0o700);
      await this.verifyExecutable({ path: temporary, id, expectedVersion: version, timeoutMs: this.entry(id).verifyTimeoutMs });
      await rename(temporary, target); await chmod(target, 0o700);
    } catch (error) { await rm(temporary, { force: true }); throw error; }
    return { target, asset, downloaded: true };
  }
  async activate(id, version, type = 'installed') {
    const { target, asset, downloaded } = await this.ensureVersion(id, version); const active = this.binaryPath(id);
    const entry = this.entry(id); const current = await this.status(id);
    const surface = entry.exposure === 'path' ? { managedPath: active } : { availableThrough: entry.toolSurface };
    if (current.activeVersion === version) return { state: 'already_installed', id, version, ...surface, sha256: asset.sha256 };
    const temp = `${active}.${randomUUID()}.tmp`;
    try { await copyFile(target, temp); await chmod(temp, 0o700); await rename(temp, active); }
    finally { await rm(temp, { force: true }); }
    const before = await this.readState(id); const history = [...(before.history ?? []), ...(current.activeVersion ? [current.activeVersion] : [])].slice(-20);
    await this.writeState(id, { activeVersion: version, history }); await this.append(type, { id, version, previousVersion: current.activeVersion, sha256: asset.sha256, sourceUrl: asset.url });
    return { state: type, id, version, previousVersion: current.activeVersion, ...surface, sha256: asset.sha256, downloaded };
  }
  async install(id, { version } = {}) { return this.serialize(async () => { await this.ensure(); const entry = this.entry(id); return this.activate(id, version ?? entry.defaultVersion, 'installed'); }); }
  async remove(id) { return this.serialize(async () => { await this.ensure(); const current = await this.status(id); if (!current.activeVersion) throw new Error('managed CLI is not installed');
    const trashName = `${id}-${current.activeVersion}-${Date.now()}-${executableName(this.entry(id).command, this.platform)}`; await rename(this.binaryPath(id), join(this.trash, trashName));
    const state = await this.readState(id); await this.writeState(id, { activeVersion: null, history: [...(state.history ?? []), current.activeVersion].slice(-20) }); await this.append('removed', { id, version: current.activeVersion, trashName });
    return { state: 'removed', id, version: current.activeVersion, recoverable: true }; }); }
  async restore(id) { return this.serialize(async () => { await this.ensure(); if ((await this.status(id)).activeVersion) throw new Error('managed CLI is already installed');
    const names = (await readdir(this.trash)).filter((name) => name.startsWith(`${id}-`)).sort().reverse();
    for (const name of names) { const source = join(this.trash, name); if (!(await regularFile(source))) continue; const version = await this.matchingVersion(id, source); if (!version) continue;
      await rename(source, this.binaryPath(id)); await chmod(this.binaryPath(id), 0o700); const state = await this.readState(id); await this.writeState(id, { activeVersion: version, history: state.history ?? [] }); await this.append('restored', { id, version, trashName: name });
      return {
        state: 'restored', id, version,
        ...(this.entry(id).exposure === 'path' ? { managedPath: this.binaryPath(id) } : { availableThrough: this.entry(id).toolSurface }),
      }; }
    throw new Error('removed managed CLI not found'); }); }
  async restoreExact(id, revision) { return this.serialize(async () => { await this.ensure(); if ((await this.status(id)).activeVersion) throw new Error('managed CLI is already installed'); const asset = this.catalog.asset(id, revision?.version, this.platform, this.architecture); if (asset.sha256 !== revision?.digest) throw new Error('exact CLI revision is not trusted'); const names = (await readdir(this.trash)).filter((name) => name.startsWith(`${id}-${revision.version}-`)).sort().reverse(); for (const name of names) { const source = join(this.trash, name); if (!(await regularFile(source)) || await this.matchingVersion(id, source) !== revision.version) continue; await rename(source, this.binaryPath(id)); await chmod(this.binaryPath(id), 0o700); const state = await this.readState(id); await this.writeState(id, { activeVersion: revision.version, history: state.history ?? [] }); await this.append('restored', { id, version: revision.version, digest: revision.digest, trashName: name }); return { state: 'restored', id, version: revision.version, digest: revision.digest }; } throw new Error('exact removed managed CLI not found'); }); }
  async rollbackTo(id, revision) { return this.serialize(async () => { await this.ensure(); const asset = this.catalog.asset(id, revision?.version, this.platform, this.architecture); if (asset.sha256 !== revision?.digest) throw new Error('exact CLI rollback revision is not trusted'); const target = this.versionPath(id, revision.version); if (await this.matchingVersion(id, target) !== revision.version) throw new Error('exact CLI rollback revision is unavailable'); return this.activate(id, revision.version, 'rolled_back'); }); }
  async rollback(id) { return this.serialize(async () => { await this.ensure(); const current = await this.status(id); if (!current.activeVersion) throw new Error('managed CLI is not installed');
    const state = await this.readState(id); const version = [...(state.history ?? [])].reverse().find((candidate) => candidate !== current.activeVersion && this.entry(id).versions[candidate]);
    if (!version) throw new Error('previous managed CLI version not found'); return this.activate(id, version, 'rolled_back'); }); }
}

export function makeCliAcquisitionTool({ store, authorizeEffect } = {}) {
  if (!store?.catalog) throw new TypeError('CLI acquisition store is required');
  return {
    name: 'cli_prepare',
    description: 'Find and prepare a trusted T5-managed capability only when the current hands lack a suitable means. Candidates are pinned official single-file releases with exact platform, byte size, and SHA-256 verification. Never use arbitrary URLs, package managers, sudo, global installs, or shell profile changes. Path-exposed tools are used through the terminal; tool-only candidates are available only through their named restricted tool surface.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      action: { type: 'string', enum: ['search', 'preview', 'status', 'install', 'remove', 'restore', 'rollback'] },
      id: { type: ['string', 'null'] }, version: { type: ['string', 'null'] }, effect: { anyOf: [EFFECT_SCHEMA, { type: 'null' }] },
    }, required: ['action', 'id', 'version', 'effect'] },
    async preflight(args, context) {
      if (['search', 'preview', 'status'].includes(args.action)) return { allowed: true };
      if (args.effect?.kind !== 'local_change' || args.effect?.reversible !== true) return { allowed: false, outcome: 'not_executed', result: { state: 'reversible_local_change_required' } };
      return typeof authorizeEffect === 'function' ? authorizeEffect(args, context) : { allowed: true };
    },
    async execute(args) {
      if (args.action === 'search') { const installed = new Map((await store.installed()).map((item) => [item.id, item.activeVersion])); return { packages: store.catalog.packages.filter((item) => !args.id || item.id.includes(args.id)).map((item) => ({ ...item, installedVersion: installed.get(item.id) ?? null })) }; }
      if (!args.id) throw new TypeError('CLI package id is required');
      if (args.action === 'preview') { const entry = store.entry(args.id); return { state: 'previewed', ...publicPackage(entry), asset: store.catalog.asset(args.id, args.version ?? entry.defaultVersion, store.platform, store.architecture), codeExecution: true, systemInstall: false }; }
      if (args.action === 'status') return store.status(args.id);
      if (args.action === 'install') return store.install(args.id, { version: args.version ?? undefined });
      if (args.action === 'remove') return store.remove(args.id);
      if (args.action === 'restore') return store.restore(args.id);
      if (args.action === 'rollback') return store.rollback(args.id);
      throw new Error('unsupported CLI acquisition action');
    },
  };
}
