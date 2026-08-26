import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { scanUserNotes } from './user-note.js';

const GENERATION = /^generation-([a-f0-9]{24})$/u;
const HANDLE = /^[a-f0-9]{64}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const SERVABLE = new Set(['index.html', 'memory.md',
  ...['timeline', 'projects', 'decisions', 'research'].flatMap((name) => [`${name}.html`, `${name}.md`])]);
const GENERATION_FILES = new Set([...SERVABLE, 'manifest.json']);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function missing(error) { return error?.code === 'ENOENT'; }

function generationName(generationId) {
  const id = String(generationId ?? '');
  if (!/^[a-f0-9]{24}$/u.test(id)) throw new TypeError('Living Library generation id is invalid');
  return `generation-${id}`;
}

function validateManifestShape(manifest, expectedGenerationId) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Living Library manifest must be an object');
  }
  if (manifest.schema !== 't5.living-library-manifest.v1'
    || manifest.generationId !== expectedGenerationId
    || !DIGEST.test(String(manifest.sourceEventDigest ?? ''))
    || !DIGEST.test(String(manifest.userNoteSnapshotDigest ?? ''))
    || !DIGEST.test(String(manifest.manifestPayloadSha256 ?? ''))) {
    throw new Error('Living Library manifest identity is invalid');
  }
  if (!Array.isArray(manifest.memoryHandles) || manifest.memoryHandles.length > 512
    || manifest.memoryHandles.some((handle) => !HANDLE.test(String(handle)))) {
    throw new Error('Living Library manifest memory handles are invalid');
  }
  if (new Set(manifest.memoryHandles).size !== manifest.memoryHandles.length) {
    throw new Error('Living Library manifest memory handles must be unique');
  }
  for (const name of SERVABLE) {
    const descriptor = manifest.files?.[name];
    if (!descriptor || !DIGEST.test(String(descriptor.sha256 ?? ''))
      || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 0) {
      throw new Error(`Living Library ${name} descriptor is invalid`);
    }
  }
  const payload = { ...manifest }; delete payload.manifestPayloadSha256;
  if (sha256(JSON.stringify(payload)) !== manifest.manifestPayloadSha256) {
    throw new Error('Living Library manifest digest mismatch');
  }
  return manifest;
}

async function regularSingleLink(path, label) {
  const status = await lstat(path);
  if (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1) {
    throw new Error(`${label} must be a regular single-link file`);
  }
  return status;
}

async function safeExistingRoot(outputRoot) {
  const root = resolve(String(outputRoot ?? ''));
  let status;
  try { status = await lstat(root); } catch (error) { if (missing(error)) return { root, state: 'missing' }; throw error; }
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new Error('Living Library output root is unsafe');
  }
  // Work only from the kernel-resolved directory from this point onward. The root
  // itself may not be a link; canonicalising its parents also prevents later joins
  // from being evaluated against an unresolved alias (macOS /var is such an alias).
  return { root: await realpath(root), state: 'available' };
}

async function currentSourceEventDigest(memoryLedger) {
  const state = await memoryLedger.read();
  if (!state || !Array.isArray(state.events)) throw new Error('MemoryLedger state is invalid');
  return sha256(JSON.stringify(state.events));
}

async function currentUserNoteSnapshotDigest(userNotesRoot) {
  if (!userNotesRoot) return sha256('[]');
  return (await scanUserNotes(userNotesRoot)).snapshotDigest;
}

export function livingLibraryMemoryHandle(memoryId) {
  const id = String(memoryId ?? '');
  if (!id) throw new TypeError('memoryId is required');
  return sha256(`t5-memory-handle:${id}`);
}

export class LivingLibraryRegistry {
  constructor({ outputRoot, memoryLedger, userNotesRoot = null, removeGeneration = null } = {}) {
    if (!outputRoot) throw new TypeError('Living Library output root is required');
    if (!memoryLedger?.read) throw new TypeError('Living Library registry requires MemoryLedger');
    this.outputRoot = resolve(String(outputRoot));
    this.memoryLedger = memoryLedger;
    this.userNotesRoot = userNotesRoot ? resolve(String(userNotesRoot)) : null;
    this.removeGeneration = removeGeneration ?? (async (path) => rm(path, { recursive: true }));
  }

  async generationIds() {
    const root = await safeExistingRoot(this.outputRoot);
    if (root.state === 'missing') return [];
    const entries = await readdir(root.root, { withFileTypes: true });
    return entries.map((entry) => GENERATION.exec(entry.name)?.[1] ?? null).filter(Boolean).sort();
  }

  async inspect({ generationId, compareCurrent = true } = {}) {
    let name;
    try { name = generationName(generationId); } catch (error) {
      return { state: 'unsafe', generationId: String(generationId ?? ''), reason: error.message };
    }
    let root;
    try { root = await safeExistingRoot(this.outputRoot); } catch (error) {
      return { state: 'unsafe', generationId, reason: error.message };
    }
    if (root.state === 'missing') return { state: 'missing', generationId };
    const directory = join(root.root, name);
    try {
      const directoryStatus = await lstat(directory);
      if (!directoryStatus.isDirectory() || directoryStatus.isSymbolicLink()) {
        return { state: 'unsafe', generationId, reason: 'generation path is not a managed directory' };
      }
      const names = (await readdir(directory)).sort();
      if (names.length !== GENERATION_FILES.size
        || names.some((entry) => !GENERATION_FILES.has(entry))) {
        return { state: 'unsafe', generationId, reason: 'generation contains unmanaged entries' };
      }
      await regularSingleLink(join(directory, 'manifest.json'), 'Living Library manifest');
      const manifest = validateManifestShape(
        JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')), generationId,
      );
      for (const nameToVerify of SERVABLE) {
        const path = join(directory, nameToVerify);
        const status = await regularSingleLink(path, `Living Library ${nameToVerify}`);
        const content = await readFile(path);
        const descriptor = manifest.files[nameToVerify];
        if (status.size !== descriptor.bytes || content.byteLength !== descriptor.bytes
          || sha256(content) !== descriptor.sha256) {
          return { state: 'invalid', generationId, reason: `${nameToVerify} digest mismatch` };
        }
      }
      if (compareCurrent) {
        let currentDigest; let currentNoteDigest;
        try {
          [currentDigest, currentNoteDigest] = await Promise.all([
            currentSourceEventDigest(this.memoryLedger), currentUserNoteSnapshotDigest(this.userNotesRoot),
          ]);
        } catch {
          return { state: 'unknown', generationId, reason: 'current_state_unavailable' };
        }
        const staleReasons = [];
        if (currentDigest !== manifest.sourceEventDigest) staleReasons.push('memory');
        if (currentNoteDigest !== manifest.userNoteSnapshotDigest) staleReasons.push('user_notes');
        if (staleReasons.length) {
          return { state: 'stale', generationId, manifest, directory, staleReasons };
        }
      }
      return { state: 'ready', generationId, manifest, directory };
    } catch (error) {
      if (missing(error)) return { state: 'missing', generationId };
      return { state: 'invalid', generationId, reason: error.message };
    }
  }

  async serve({ generationId, file = 'index.html' } = {}) {
    if (!SERVABLE.has(file)) return { state: 'unsafe', generationId, file, content: null };
    const inspected = await this.inspect({ generationId, compareCurrent: true });
    if (inspected.state !== 'ready') return { ...inspected, file, content: null };
    const path = join(inspected.directory, file);
    const status = await regularSingleLink(path, `Living Library ${file}`);
    const content = await readFile(path);
    const descriptor = inspected.manifest.files[file];
    if (status.size !== descriptor.bytes || content.byteLength !== descriptor.bytes
      || sha256(content) !== descriptor.sha256) {
      return { state: 'invalid', generationId, file, content: null, reason: `${file} digest mismatch` };
    }
    let finalMemoryDigest; let finalNoteDigest;
    try {
      [finalMemoryDigest, finalNoteDigest] = await Promise.all([
        currentSourceEventDigest(this.memoryLedger), currentUserNoteSnapshotDigest(this.userNotesRoot),
      ]);
    } catch {
      return { state: 'unknown', generationId, file, content: null, reason: 'current_state_unavailable' };
    }
    if (finalMemoryDigest !== inspected.manifest.sourceEventDigest
      || finalNoteDigest !== inspected.manifest.userNoteSnapshotDigest) {
      return { state: 'stale', generationId, file, content: null,
        manifest: inspected.manifest, directory: inspected.directory };
    }
    return { state: 'ready', generationId, file, content,
      contentType: file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8' };
  }

  async purgeStale() {
    let currentDigest; let currentNoteDigest; let generationIds;
    try {
      [currentDigest, currentNoteDigest] = await Promise.all([
        currentSourceEventDigest(this.memoryLedger), currentUserNoteSnapshotDigest(this.userNotesRoot),
      ]);
      generationIds = await this.generationIds();
    } catch {
      return { state: 'unknown', currentSourceEventDigest: null, deletedGenerationIds: [],
        currentUserNoteSnapshotDigest: null, retainedGenerations: [], unknownGenerationIds: [],
        ledgerChangedDuringPurge: null, userNotesChangedDuringPurge: null };
    }
    const deletedGenerationIds = []; const retainedGenerations = []; const unknownGenerationIds = [];
    for (const generationId of generationIds) {
      const inspected = await this.inspect({ generationId, compareCurrent: false });
      if (inspected.state !== 'ready') {
        if (inspected.state !== 'missing') retainedGenerations.push({ generationId,
          reason: `library_generation_${inspected.state}` });
        continue;
      }
      if (inspected.manifest.sourceEventDigest === currentDigest
        && inspected.manifest.userNoteSnapshotDigest === currentNoteDigest) continue;
      try {
        await this.removeGeneration(inspected.directory);
      } catch {
        const after = await this.inspect({ generationId, compareCurrent: false });
        if (after.state === 'missing') unknownGenerationIds.push(generationId);
        else retainedGenerations.push({ generationId, reason: 'library_generation_delete_failed' });
        continue;
      }
      const after = await this.inspect({ generationId, compareCurrent: false });
      if (after.state === 'missing') deletedGenerationIds.push(generationId);
      else if (after.state === 'ready') retainedGenerations.push({ generationId,
        reason: 'library_generation_retained' });
      else unknownGenerationIds.push(generationId);
    }
    let ledgerStable = false; let userNotesStable = false;
    try {
      [ledgerStable, userNotesStable] = await Promise.all([
        currentSourceEventDigest(this.memoryLedger).then((digest) => digest === currentDigest),
        currentUserNoteSnapshotDigest(this.userNotesRoot).then((digest) => digest === currentNoteDigest),
      ]);
    } catch { ledgerStable = false; userNotesStable = false; }
    const state = !ledgerStable || !userNotesStable || unknownGenerationIds.length ? 'unknown'
      : retainedGenerations.length ? 'retained' : 'executed';
    return { state, currentSourceEventDigest: currentDigest, currentUserNoteSnapshotDigest: currentNoteDigest,
      deletedGenerationIds, retainedGenerations, unknownGenerationIds,
      ledgerChangedDuringPurge: !ledgerStable, userNotesChangedDuringPurge: !userNotesStable };
  }

  async generationsForHandle(memoryHandle) {
    const handle = String(memoryHandle ?? '');
    if (!HANDLE.test(handle)) throw new TypeError('Living Library memory handle is invalid');
    const matches = []; let unknown = false;
    for (const generationId of await this.generationIds()) {
      const inspected = await this.inspect({ generationId, compareCurrent: false });
      if (inspected.state === 'ready') {
        if (inspected.manifest.memoryHandles.includes(handle)) matches.push(inspected);
      } else if (inspected.state !== 'missing') unknown = true;
    }
    return { matches, unknown };
  }

  async purgeHandle(memoryHandle) {
    if (!HANDLE.test(String(memoryHandle ?? ''))) {
      return { state: 'retained', reason: 'library_memory_handle_invalid', deletedGenerationIds: [] };
    }
    let found;
    try { found = await this.generationsForHandle(memoryHandle); }
    catch { return { state: 'unknown', reason: 'library_registry_read_failed', deletedGenerationIds: [] }; }
    if (found.unknown) return { state: 'unknown', reason: 'library_registry_incomplete', deletedGenerationIds: [] };
    const deletedGenerationIds = [];
    for (const match of found.matches) {
      try {
        await this.removeGeneration(match.directory);
      } catch {
        const after = await this.inspect({ generationId: match.generationId, compareCurrent: false });
        if (after.state === 'missing') {
          return { state: 'unknown', reason: 'library_delete_settlement_unknown', deletedGenerationIds };
        }
        return { state: 'retained', reason: 'library_generation_delete_failed', deletedGenerationIds };
      }
      const after = await this.inspect({ generationId: match.generationId, compareCurrent: false });
      if (after.state !== 'missing') {
        return { state: after.state === 'ready' ? 'retained' : 'unknown',
          reason: after.state === 'ready' ? 'library_generation_retained' : 'library_delete_probe_unknown',
          deletedGenerationIds };
      }
      deletedGenerationIds.push(match.generationId);
    }
    return { state: 'executed', deletedGenerationIds };
  }

  async probeHandle(memoryHandle) {
    try {
      const found = await this.generationsForHandle(memoryHandle);
      if (found.unknown) return null;
      return found.matches.length;
    } catch { return null; }
  }

  forgetAdapter() {
    return {
      preview: async (claim) => {
        const handle = livingLibraryMemoryHandle(claim?.memoryId);
        let found;
        try { found = await this.generationsForHandle(handle); }
        catch { return { id: handle, action: 'delete', revision: null }; }
        if (!found.matches.length && !found.unknown) return null;
        return { id: handle, action: 'delete', revision: found.unknown ? null
          : sha256(JSON.stringify(found.matches.map((item) => item.generationId))) };
      },
      settle: async ({ target }) => {
        const result = await this.purgeHandle(target.id);
        return result.state === 'executed' ? { state: 'executed' }
          : { state: result.state, reason: result.reason };
      },
      probe: async ({ target }) => this.probeHandle(target.id),
    };
  }
}
