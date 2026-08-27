import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scrypt as rawScrypt } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const scrypt = promisify(rawScrypt);
const MAGIC = Buffer.from('T5WB001\n', 'ascii');
const MAX_HEADER_BYTES = 4_096;
const MAX_PAYLOAD_BYTES = 256 * 1024 * 1024;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
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
  createdAt = new Date().toISOString(), afterSourceManifest = null } = {}) {
  if (!registry?.stateRoot || typeof registry.manifest !== 'function') throw new TypeError('whole-state registry is required');
  const manifest = await registry.manifest({ generationId, createdAt });
  await afterSourceManifest?.(manifest);
  const root = await mkdtemp(join(stagingParent, 't5-whole-state-generation-'));
  try {
    const payloadRoot = join(root, 'payload'); await mkdir(payloadRoot, { recursive: true, mode: 0o700 });
    for (const component of manifest.components) for (const file of component.files) {
      if (file.state === 'unavailable' || file.state === 'excluded_large') continue;
      const source = resolve(registry.stateRoot, file.path); const target = resolve(payloadRoot, file.path);
      if (!inside(registry.stateRoot, source) || !inside(payloadRoot, target)) throw new Error('whole-state staging path escaped root');
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await copyFile(source, target, constants.COPYFILE_EXCL); await chmod(target, 0o600);
      const [sourceAfter, copied] = await Promise.all([readFile(source), readFile(target)]);
      if (sourceAfter.length !== file.bytes || sha256(sourceAfter) !== file.sha256
        || copied.length !== file.bytes || sha256(copied) !== file.sha256) {
        throw Object.assign(new Error('whole-state source changed during staging'), { code: 'T5_BACKUP_SOURCE_CHANGED' });
      }
    }
    await writeFile(join(root, 'manifest.json'), `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
    return { root, payloadRoot, manifest };
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}

async function payloadFromStage(stage) {
  const files = [];
  for (const component of stage.manifest.components) for (const file of component.files) {
    if (file.state === 'unavailable' || file.state === 'excluded_large') continue;
    const bytes = await readFile(resolve(stage.payloadRoot, file.path));
    files.push({ path: file.path, bytes: file.bytes, sha256: file.sha256, data: bytes.toString('base64') });
  }
  const payload = Buffer.from(JSON.stringify({ manifest: stage.manifest, files }), 'utf8');
  if (payload.length > MAX_PAYLOAD_BYTES) throw Object.assign(new Error('whole-state encrypted payload is too large'), {
    code: 'T5_BACKUP_PAYLOAD_TOO_LARGE',
  });
  return payload;
}

export async function createWholeStateBundle({ registry, outputFile, password, stagingParent, generationId,
  createdAt, afterSourceManifest } = {}) {
  if (!outputFile) throw new TypeError('whole-state output file is required');
  const stage = await stageWholeStateGeneration({ registry, stagingParent, generationId, createdAt, afterSourceManifest });
  const salt = randomBytes(16); const iv = randomBytes(12); let key;
  try {
    const plaintext = await payloadFromStage(stage); key = await deriveKey(password, salt);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]); const tag = cipher.getAuthTag();
    const header = Buffer.from(JSON.stringify({ schema: 't5.whole-state-encrypted.v1',
      kdf: { name: 'scrypt', N: 16_384, r: 8, p: 1, salt: salt.toString('base64') },
      cipher: { name: 'aes-256-gcm', iv: iv.toString('base64'), tagBytes: tag.length } }), 'utf8');
    if (header.length > MAX_HEADER_BYTES) throw new Error('whole-state bundle header is too large');
    const length = Buffer.alloc(4); length.writeUInt32BE(header.length);
    const body = Buffer.concat([MAGIC, length, header, ciphertext, tag]);
    await mkdir(dirname(resolve(outputFile)), { recursive: true, mode: 0o700 });
    const temporary = `${resolve(outputFile)}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, body, { mode: 0o600 }); await chmod(temporary, 0o600);
    await rename(temporary, resolve(outputFile));
    return { schema: 't5.whole-state-backup-receipt.v1', generationId: stage.manifest.generationId,
      components: stage.manifest.components.length, bytes: body.length, sha256: sha256(body), encrypted: true };
  } finally { key?.fill(0); await rm(stage.root, { recursive: true, force: true }); }
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
    if (plaintext.length > MAX_PAYLOAD_BYTES) throw new Error('whole-state payload is too large');
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw Object.assign(new Error('whole-state backup password or integrity check failed'), {
      code: 'T5_BACKUP_AUTHENTICATION_FAILED',
    });
  } finally { key?.fill(0); }
}

function validateManifest(manifest, files) {
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
  if (!Array.isArray(files) || files.length !== expectedFiles.size) throw new Error('whole-state payload file count is invalid');
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

export async function restoreWholeStateBundle({ bundleFile, password, destinationStateRoot,
  validateRelationships = async () => true } = {}) {
  const destination = resolve(destinationStateRoot); const parent = dirname(destination);
  const payload = await decryptBundle(bundleFile, password);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const isolated = await materializeIsolated(payload, parent);
  try { await validateRelationships({ root: isolated, manifest: payload.manifest }); }
  catch (error) { await rm(isolated, { recursive: true, force: true }); throw error; }
  const rollback = `${destination}.rollback.${randomUUID()}`; let hadDestination = false;
  try {
    try { await stat(destination); hadDestination = true; await rename(destination, rollback); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    await rename(isolated, destination);
    if (hadDestination) await rm(rollback, { recursive: true, force: true });
    return { restored: true, generationId: payload.manifest.generationId,
      components: payload.manifest.components.length, secretsRequired: true, externalEffectsRetried: 0 };
  } catch (error) {
    await rm(isolated, { recursive: true, force: true }).catch(() => {});
    if (hadDestination) {
      await rm(destination, { recursive: true, force: true }).catch(() => {});
      await rename(rollback, destination).catch(() => {});
    }
    throw error;
  }
}
