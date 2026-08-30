import { createDecipheriv, createHash, randomUUID, scrypt as rawScrypt } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { streamFileFacts } from './stream-file-facts.js';
import { isWholeStateBundleV2, materializeWholeStateBundleV2,
  writeWholeStateBundleV2 } from './whole-state-bundle-v2.js';

const scrypt = promisify(rawScrypt);
const MAGIC = Buffer.from('T5WB001\n', 'ascii');
const MAX_HEADER_BYTES = 4_096;
const LEGACY_V1_MAX_PAYLOAD_BYTES = 256 * 1024 * 1024;
const TRANSIENT_BROWSER_LINKS = new Set(['RunningChromeVersion', 'SingletonSocket', 'SingletonCookie', 'SingletonLock']);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function removeWholeStateTransientRuntimeLinks(rootInput) {
  const browserRoot = join(resolve(rootInput), 'browser'); let removed = 0;
  async function walk(directory) {
    let entries; try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error?.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const exact = join(directory, entry.name); const info = await lstat(exact);
      if (info.isSymbolicLink()) {
        if (!TRANSIENT_BROWSER_LINKS.has(entry.name)) continue;
        await rm(exact, { force: true }); removed += 1; continue;
      }
      if (info.isDirectory()) await walk(exact);
    }
  }
  await walk(browserRoot); return { removed };
}
async function capturePortableAttachmentLedger(source, target) {
  const output = await open(target, 'wx', 0o600);
  const input = createReadStream(source); const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line) continue; const event = JSON.parse(line); const record = event.payload?.record;
      if (record) {
        const leaf = String(record.objectRelativePath ?? record.storedPath ?? '').replaceAll('\\', '/').split('/').at(-1);
        const relativeObject = record.objectRelativePath ?? `objects/${record.sha256}/${leaf}`;
        if (!/^objects\/[0-9a-f]{64}\/content(?:\.[A-Za-z0-9]{1,16})?$/u.test(relativeObject)
          || !relativeObject.startsWith(`objects/${record.sha256}/`)) throw new Error('attachment ledger object identity is invalid');
        record.objectRelativePath = relativeObject; delete record.storedPath;
        if (record.sourcePath) { delete record.sourcePath; record.sourceAvailability = 'reconnect_required'; }
      }
      await output.write(`${JSON.stringify(event)}\n`);
    }
    await output.sync();
  } finally { await output.close(); input.destroy(); }
}
function safeRelative(value) {
  const path = String(value ?? '').replaceAll('\\', '/');
  if (!path || isAbsolute(path) || path.startsWith('../') || path.includes('/../') || path.includes('\0')) {
    throw new Error('whole-state bundle path is unsafe');
  }
  return path;
}
function inside(root, path) {
  const rel = relative(root, path); return rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
async function deriveKey(password, salt) {
  const text = String(password ?? '');
  if (text.length < 10 || Buffer.byteLength(text) > 1024) throw new TypeError('backup password must be 10 to 1024 bytes');
  return Buffer.from(await scrypt(text, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }));
}

export async function stageWholeStateGeneration({ registry, stagingParent = tmpdir(), generationId = randomUUID(),
  createdAt = new Date().toISOString(), afterSourceManifest = null, manifest: providedManifest = null } = {}) {
  if (!registry?.stateRoot || typeof registry.manifest !== 'function') throw new TypeError('whole-state registry is required');
  const manifest = providedManifest ?? await registry.manifest({ generationId, createdAt });
  await afterSourceManifest?.(manifest);
  const root = await mkdtemp(join(stagingParent, 't5-whole-state-generation-'));
  try {
    const payloadRoot = join(root, 'payload'); await mkdir(payloadRoot, { recursive: true, mode: 0o700 });
    for (const component of manifest.components) for (const file of component.files) {
      if (file.state === 'unavailable' || file.state === 'excluded_large') continue;
      const source = resolve(registry.stateRoot, file.path); const target = resolve(payloadRoot, file.path);
      if (!inside(registry.stateRoot, source) || !inside(payloadRoot, target)) throw new Error('whole-state staging path escaped root');
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      if (component.capture === 'sqlite_online') {
        const { backup: sqliteBackup, DatabaseSync } = await import('node:sqlite');
        const database = new DatabaseSync(source, { readOnly: true });
        try { await sqliteBackup(database, target); } finally { database.close(); }
        const copied = await streamFileFacts(target); file.bytes = copied.bytes; file.sha256 = copied.sha256;
        file.capture = 'sqlite_online';
      } else if (component.capture === 'attachment_portable') {
        await capturePortableAttachmentLedger(source, target);
        const copied = await streamFileFacts(target); file.bytes = copied.bytes; file.sha256 = copied.sha256;
        file.capture = 'attachment_portable';
      } else {
        await copyFile(source, target, constants.COPYFILE_EXCL);
        const [sourceAfter, copied] = await Promise.all([streamFileFacts(source), streamFileFacts(target)]);
        if (sourceAfter.bytes !== file.bytes || sourceAfter.sha256 !== file.sha256
          || copied.bytes !== file.bytes || copied.sha256 !== file.sha256) {
          throw Object.assign(new Error('whole-state source changed during staging'), { code: 'T5_BACKUP_SOURCE_CHANGED' });
        }
      }
      await chmod(target, 0o600);
    }
    for (const component of manifest.components) for (const file of component.files) {
      if (file.state === 'unavailable' || file.state === 'excluded_large') continue;
      if (component.capture !== 'file') continue;
      const sourceAfterGeneration = await streamFileFacts(resolve(registry.stateRoot, file.path));
      if (sourceAfterGeneration.bytes !== file.bytes || sourceAfterGeneration.sha256 !== file.sha256) {
        throw Object.assign(new Error('whole-state source changed before generation closed'), {
          code: 'T5_BACKUP_SOURCE_CHANGED',
        });
      }
    }
    await writeFile(join(root, 'manifest.json'), `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
    return { root, payloadRoot, manifest };
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}

export async function createWholeStateBundle({ registry, outputFile, password, stagingParent, generationId,
  createdAt = new Date().toISOString(), afterSourceManifest, onProgress = null } = {}) {
  if (!outputFile) throw new TypeError('whole-state output file is required');
  const parent = stagingParent ?? tmpdir(); const manifest = await registry.manifest({ generationId: generationId ?? randomUUID(), createdAt });
  await assertWholeStateDiskCapacity({ manifest, stagingParent: parent, outputFile,
    sourceRoot: registry.stateRoot });
  const stage = await stageWholeStateGeneration({ registry, stagingParent: parent, manifest, afterSourceManifest });
  try { return await writeWholeStateBundleV2({ stage, outputFile, password, onProgress }); }
  finally { await rm(stage.root, { recursive: true, force: true }); }
}

export async function assertWholeStateDiskCapacity({ manifest, stagingParent, outputFile, sourceRoot = null } = {}) {
  let sourceBytes = manifest.components.flatMap((component) => component.files)
    .filter((file) => !file.state).reduce((sum, file) => sum + Number(file.bytes ?? 0), 0);
  if (sourceRoot) for (const component of manifest.components.filter((item) => item.capture === 'sqlite_online')) {
    for (const file of component.files.filter((item) => !item.state)) {
      const walBytes = await lstat(`${resolve(sourceRoot, file.path)}-wal`).then((value) => value.size).catch(() => 0);
      sourceBytes += walBytes;
    }
  }
  const outputParent = dirname(resolve(outputFile)); await mkdir(outputParent, { recursive: true, mode: 0o700 });
  const [stageFs, outputFs, stageInfo, outputInfo] = await Promise.all([
    statfs(stagingParent), statfs(outputParent), lstat(stagingParent), lstat(outputParent),
  ]);
  const available = (value) => Number(value.bavail) * Number(value.bsize);
  const reserve = 64 * 1024 * 1024; const sameDevice = stageInfo.dev === outputInfo.dev;
  if (sameDevice ? available(stageFs) < (sourceBytes * 2) + reserve
    : available(stageFs) < sourceBytes + reserve || available(outputFs) < sourceBytes + reserve) {
    throw Object.assign(new Error('whole-state backup needs more free disk space'), {
      code: 'T5_BACKUP_DISK_SPACE_INSUFFICIENT', requiredBytes: sameDevice
        ? (sourceBytes * 2) + reserve : sourceBytes + reserve,
    });
  }
  return { sourceBytes, sameDevice };
}

async function decryptBundle(bundleFile, password) {
  const body = await readFile(bundleFile);
  if (body.length < MAGIC.length + 4 + 16 || !body.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw Object.assign(new Error('whole-state bundle is invalid'), { code: 'T5_BACKUP_INVALID' });
  }
  const headerBytes = body.readUInt32BE(MAGIC.length);
  if (headerBytes <= 0 || headerBytes > MAX_HEADER_BYTES || MAGIC.length + 4 + headerBytes + 16 > body.length) {
    throw Object.assign(new Error('whole-state bundle is invalid'), { code: 'T5_BACKUP_INVALID' });
  }
  let header;
  try { header = JSON.parse(body.subarray(MAGIC.length + 4, MAGIC.length + 4 + headerBytes).toString('utf8')); }
  catch { throw Object.assign(new Error('whole-state bundle is invalid'), { code: 'T5_BACKUP_INVALID' }); }
  if (header?.schema !== 't5.whole-state-encrypted.v1' || header.kdf?.name !== 'scrypt'
    || header.kdf.N !== 16_384 || header.kdf.r !== 8 || header.kdf.p !== 1
    || header.cipher?.name !== 'aes-256-gcm' || header.cipher.tagBytes !== 16) {
    throw Object.assign(new Error('whole-state bundle version is unsupported'), { code: 'T5_BACKUP_VERSION_UNSUPPORTED' });
  }
  const salt = Buffer.from(header.kdf.salt, 'base64'); const iv = Buffer.from(header.cipher.iv, 'base64');
  if (salt.length !== 16 || iv.length !== 12) throw Object.assign(new Error('whole-state bundle is invalid'), { code: 'T5_BACKUP_INVALID' });
  const cipherStart = MAGIC.length + 4 + headerBytes; const tag = body.subarray(body.length - 16);
  let key;
  try {
    key = await deriveKey(password, salt); const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(body.subarray(cipherStart, body.length - 16)), decipher.final()]);
    if (plaintext.length > LEGACY_V1_MAX_PAYLOAD_BYTES) throw new Error('whole-state payload is too large');
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw Object.assign(new Error('whole-state backup password or integrity check failed'), {
      code: 'T5_BACKUP_AUTHENTICATION_FAILED',
    });
  } finally { key?.fill(0); }
}

function validateManifest(manifest, files = null) {
  if (manifest?.schema !== 't5.whole-state-generation-manifest.v1' || !Array.isArray(manifest.components)) {
    throw Object.assign(new Error('whole-state manifest is invalid'), { code: 'T5_BACKUP_MANIFEST_INVALID' });
  }
  const components = new Map(); const expectedFiles = new Map();
  for (const component of manifest.components) {
    if (!component?.id || components.has(component.id) || !Number.isSafeInteger(component.restoreOrder)) throw new Error('whole-state component manifest is invalid');
    components.set(component.id, component);
    for (const file of component.files ?? []) {
      const path = safeRelative(file.path); if (file.state === 'unavailable' || file.state === 'excluded_large') continue;
      if (expectedFiles.has(path) || !/^[0-9a-f]{64}$/u.test(file.sha256) || !Number.isSafeInteger(file.bytes)) throw new Error('whole-state file manifest is invalid');
      expectedFiles.set(path, file);
    }
  }
  for (const component of components.values()) for (const dependency of component.relationships ?? []) {
    const target = components.get(dependency);
    if (!target || target.restoreOrder >= component.restoreOrder) throw new Error('whole-state relationship manifest is invalid');
  }
  if (files != null && (!Array.isArray(files) || files.length !== expectedFiles.size)) throw new Error('whole-state payload file count is invalid');
  return expectedFiles;
}

async function materializeIsolated(payload, parent) {
  const root = await mkdtemp(join(parent, '.t5-restore-isolated-')); const expected = validateManifest(payload.manifest, payload.files);
  try {
    for (const item of payload.files) {
      const path = safeRelative(item.path); const expectedFile = expected.get(path);
      const bytes = Buffer.from(String(item.data ?? ''), 'base64');
      if (!expectedFile || item.bytes !== bytes.length || expectedFile.bytes !== bytes.length
        || item.sha256 !== sha256(bytes) || expectedFile.sha256 !== item.sha256) throw new Error('whole-state payload digest mismatch');
      const target = resolve(root, path); if (!inside(root, target)) throw new Error('whole-state restore path escaped root');
      await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await writeFile(target, bytes, { mode: 0o600 });
    }
    return root;
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}

export async function wholeStateTreeDigest(rootInput) {
  const root = resolve(rootInput); const facts = [];
  async function walk(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const exact = join(directory, entry.name); const info = await lstat(exact);
      if (info.isSymbolicLink()) throw new Error('prepared restore contains a symbolic link');
      if (info.isDirectory()) await walk(exact);
      else if (info.isFile() && info.nlink === 1) {
        const streamed = await streamFileFacts(exact);
        facts.push(`${relative(root, exact).replaceAll('\\', '/')}:${streamed.bytes}:${streamed.sha256}`);
      } else throw new Error('prepared restore contains an unsafe file');
    }
  }
  await walk(root); return sha256(Buffer.from(facts.join('\n'), 'utf8'));
}

export async function activatePreparedWholeStateRestore({ preparedStateRoot, destinationStateRoot,
  expectedStateDigest } = {}) {
  const prepared = resolve(preparedStateRoot); const destination = resolve(destinationStateRoot);
  if (dirname(prepared) !== dirname(destination) || prepared === destination) throw new Error('prepared restore must be a sibling state root');
  if (await wholeStateTreeDigest(prepared) !== expectedStateDigest) throw Object.assign(
    new Error('prepared restore changed before activation'), { code: 'T5_RESTORE_PREPARED_CHANGED' });
  const rollback = `${destination}.rollback.${randomUUID()}`; let hadDestination = false; let activated = false;
  try {
    try { await stat(destination); hadDestination = true; await rename(destination, rollback); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    await rename(prepared, destination); activated = true;
    const parentHandle = await open(dirname(destination), 'r');
    try { await parentHandle.sync(); } finally { await parentHandle.close(); }
    return { activated: true, stateDigest: expectedStateDigest,
      previousStatePreserved: hadDestination, previousStateName: hadDestination ? basename(rollback) : null };
  } catch (error) {
    if (activated) await rm(destination, { recursive: true, force: true }).catch(() => {});
    if (hadDestination) {
      await rename(rollback, destination).catch(() => {});
    }
    throw error;
  }
}

export async function restoreWholeStateBundle({ bundleFile, password, destinationStateRoot,
  validateRelationships = async () => true } = {}) {
  const destination = resolve(destinationStateRoot); const parent = dirname(destination);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  let isolated; let manifest;
  if (await isWholeStateBundleV2(bundleFile)) {
    const materialized = await materializeWholeStateBundleV2({ bundleFile, password, parent,
      validateManifest }); isolated = materialized.root; manifest = materialized.manifest;
  } else {
    const payload = await decryptBundle(bundleFile, password); manifest = payload.manifest;
    isolated = await materializeIsolated(payload, parent);
  }
  try { await validateRelationships({ root: isolated, manifest }); }
  catch (error) { await rm(isolated, { recursive: true, force: true }); throw error; }
  const stateDigest = await wholeStateTreeDigest(isolated);
  await activatePreparedWholeStateRestore({ preparedStateRoot: isolated, destinationStateRoot: destination,
    expectedStateDigest: stateDigest });
  return { restored: true, generationId: manifest.generationId,
    components: manifest.components.length, secretsRequired: true, externalEffectsRetried: 0,
    unavailableFiles: manifest.components.flatMap((component) => component.files)
      .filter((file) => ['excluded_large', 'unavailable'].includes(file.state)).length,
    stateDigest };
}
