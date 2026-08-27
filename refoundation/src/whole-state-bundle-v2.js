import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scrypt as rawScrypt } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, rename, rm, stat, statfs } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { promisify } from 'node:util';
import { createGunzip, createGzip } from 'node:zlib';

const scrypt = promisify(rawScrypt);
export const WHOLE_STATE_V2_MAGIC = Buffer.from('T5WB002\n', 'ascii');
const MAX_HEADER_BYTES = 4_096;
const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const FRAME = Object.freeze({ manifest: 0x4d, fileStart: 0x53, data: 0x44, fileEnd: 0x45, archiveEnd: 0x5a });

function safeRelative(value) {
  const path = String(value ?? '').replaceAll('\\', '/');
  if (!path || isAbsolute(path) || path.startsWith('../') || path.includes('/../') || path.includes('\0')) {
    throw new Error('whole-state v2 path is unsafe');
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
function frame(type, data = Buffer.alloc(0)) {
  const bytes = Buffer.from(data); if (bytes.length > MAX_FRAME_BYTES) throw new Error('whole-state v2 frame is too large');
  const header = Buffer.alloc(5); header[0] = type; header.writeUInt32BE(bytes.length, 1); return Buffer.concat([header, bytes]);
}
function jsonFrame(type, value) { return frame(type, Buffer.from(JSON.stringify(value), 'utf8')); }

export async function writeWholeStateBundleV2({ stage, outputFile, password, onProgress = null,
  stallTimeoutMs = 5 * 60_000 } = {}) {
  const output = resolve(outputFile); const salt = randomBytes(16); const iv = randomBytes(12); let key;
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  try { await lstat(output); throw Object.assign(new Error('whole-state backup output already exists'), { code: 'EEXIST' }); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const temporary = `${output}.${process.pid}.${randomUUID()}.partial`; const handle = await open(temporary, 'wx', 0o600);
  let completed = false; let published = false; let lastProgress = Date.now(); let activeInput = null;
  const watchdog = setInterval(() => {
    if (Date.now() - lastProgress > stallTimeoutMs) activeInput?.destroy(Object.assign(
      new Error('whole-state backup made no progress'), { code: 'T5_BACKUP_STALLED' }));
  }, Math.min(5_000, Math.max(100, Math.floor(stallTimeoutMs / 4)))); watchdog.unref?.();
  try {
    key = await deriveKey(password, salt);
    const outerHeader = Buffer.from(JSON.stringify({ schema: 't5.whole-state-encrypted.v2',
      kdf: { name: 'scrypt', N: 16_384, r: 8, p: 1, salt: salt.toString('base64') },
      cipher: { name: 'aes-256-gcm', iv: iv.toString('base64'), tagBytes: 16 },
      framing: 't5-entry-stream.v1' }), 'utf8');
    const headerLength = Buffer.alloc(4); headerLength.writeUInt32BE(outerHeader.length);
    const prefix = Buffer.concat([WHOLE_STATE_V2_MAGIC, headerLength, outerHeader]);
    const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(outerHeader);
    let written = 0; const archiveHash = createHash('sha256');
    const write = async (bytes) => { if (!bytes.length) return; await handle.write(bytes); archiveHash.update(bytes); written += bytes.length;
      lastProgress = Date.now(); onProgress?.({ phase: 'write', bytes: written }); };
    const encryptedFrame = async (value) => write(cipher.update(value));
    await write(prefix); await encryptedFrame(jsonFrame(FRAME.manifest, stage.manifest));
    for (const component of stage.manifest.components) for (const file of component.files) {
      if (file.state === 'unavailable' || file.state === 'excluded_large') continue;
      const source = resolve(stage.payloadRoot, file.path); if (!inside(stage.payloadRoot, source)) throw new Error('whole-state v2 source escaped root');
      await encryptedFrame(jsonFrame(FRAME.fileStart, { path: file.path, bytes: file.bytes,
        sha256: file.sha256, compression: 'gzip' }));
      const input = createReadStream(source, { highWaterMark: 256 * 1024 }); activeInput = input;
      const gzip = createGzip({ level: 6 }); input.pipe(gzip); let compressedBytes = 0;
      for await (const chunk of gzip) {
        compressedBytes += chunk.length; lastProgress = Date.now();
        await encryptedFrame(frame(FRAME.data, chunk));
        onProgress?.({ phase: 'file', path: file.path, sourceBytes: file.bytes, compressedBytes });
      }
      activeInput = null; await encryptedFrame(jsonFrame(FRAME.fileEnd, { compressedBytes }));
    }
    await encryptedFrame(frame(FRAME.archiveEnd)); await write(cipher.final()); await write(cipher.getAuthTag());
    await handle.sync(); await handle.close(); await chmod(temporary, 0o600); await rename(temporary, output); published = true;
    const directory = await open(dirname(output), 'r'); try { await directory.sync(); } finally { await directory.close(); }
    completed = true;
    const info = await stat(output); return { schema: 't5.whole-state-backup-receipt.v2',
      generationId: stage.manifest.generationId, components: stage.manifest.components.length,
      files: stage.manifest.components.flatMap((component) => component.files)
        .filter((file) => !file.state).length, bytes: info.size, encrypted: true, streaming: true,
      sha256: archiveHash.digest('hex'),
      excludedFiles: stage.manifest.components.flatMap((component) => component.files)
        .filter((file) => file.state === 'excluded_large').length };
  } finally {
    clearInterval(watchdog); activeInput?.destroy(); key?.fill(0);
    if (!completed) { await handle.close().catch(() => {}); await rm(temporary, { force: true });
      if (published) await rm(output, { force: true }); }
  }
}

async function readOuterHeader(bundleFile) {
  const file = await open(bundleFile, 'r');
  try {
    const prefix = Buffer.alloc(WHOLE_STATE_V2_MAGIC.length + 4); await file.read(prefix, 0, prefix.length, 0);
    if (!prefix.subarray(0, WHOLE_STATE_V2_MAGIC.length).equals(WHOLE_STATE_V2_MAGIC)) throw new Error('not v2');
    const length = prefix.readUInt32BE(WHOLE_STATE_V2_MAGIC.length);
    if (length <= 0 || length > MAX_HEADER_BYTES) throw new Error('invalid v2 header');
    const bytes = Buffer.alloc(length); await file.read(bytes, 0, length, prefix.length);
    const header = JSON.parse(bytes.toString('utf8'));
    if (header?.schema !== 't5.whole-state-encrypted.v2' || header.framing !== 't5-entry-stream.v1'
      || header.kdf?.name !== 'scrypt' || header.kdf.N !== 16_384 || header.kdf.r !== 8 || header.kdf.p !== 1
      || header.cipher?.name !== 'aes-256-gcm' || header.cipher.tagBytes !== 16) throw new Error('unsupported v2 header');
    return { header, headerBytes: bytes, cipherStart: prefix.length + length };
  } finally { await file.close(); }
}

export async function isWholeStateBundleV2(bundleFile) {
  const file = await open(bundleFile, 'r'); const bytes = Buffer.alloc(WHOLE_STATE_V2_MAGIC.length);
  try { await file.read(bytes, 0, bytes.length, 0); return bytes.equals(WHOLE_STATE_V2_MAGIC); }
  finally { await file.close(); }
}

export async function materializeWholeStateBundleV2({ bundleFile, password, parent,
  validateManifest, onProgress = null, stallTimeoutMs = 5 * 60_000 } = {}) {
  const { header, headerBytes, cipherStart } = await readOuterHeader(bundleFile);
  const info = await stat(bundleFile); if (info.size <= cipherStart + 16) throw new Error('whole-state v2 bundle is truncated');
  const tagHandle = await open(bundleFile, 'r'); const tag = Buffer.alloc(16);
  try { await tagHandle.read(tag, 0, 16, info.size - 16); } finally { await tagHandle.close(); }
  const salt = Buffer.from(header.kdf.salt, 'base64'); const iv = Buffer.from(header.cipher.iv, 'base64');
  if (salt.length !== 16 || iv.length !== 12) throw new Error('whole-state v2 crypto header is invalid');
  let key; const root = await mkdtemp(join(parent, '.t5-restore-v2-')); let manifest = null; let lastProgress = Date.now();
  let expected = null; const seen = new Set(); let current = null; let pending = Buffer.alloc(0); let archiveEnded = false;
  let encrypted = null; const watchdog = setInterval(() => {
    if (Date.now() - lastProgress > stallTimeoutMs) encrypted?.destroy(Object.assign(
      new Error('whole-state restore made no progress'), { code: 'T5_RESTORE_STALLED' }));
  }, Math.min(5_000, Math.max(100, Math.floor(stallTimeoutMs / 4)))); watchdog.unref?.();
  try {
    key = await deriveKey(password, salt); const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(headerBytes); decipher.setAuthTag(tag);
    encrypted = createReadStream(bundleFile, { start: cipherStart, end: info.size - 17 }); encrypted.pipe(decipher);
    const finishCurrent = async (footer) => {
      if (!current) throw new Error('whole-state v2 file end is unexpected'); current.gunzip.end();
      await Promise.all([finished(current.gunzip), finished(current.output)]);
      const digest = current.hash.digest('hex');
      if (current.bytes !== current.expected.bytes || digest !== current.expected.sha256
        || footer.compressedBytes !== current.compressedBytes) throw new Error('whole-state v2 file digest mismatch');
      seen.add(current.expected.path); current = null;
    };
    const handleFrame = async (type, data) => {
      if (type === FRAME.manifest) {
        if (manifest || current) throw new Error('whole-state v2 manifest order is invalid');
        manifest = JSON.parse(data.toString('utf8')); expected = validateManifest(manifest);
        const required = [...expected.values()].reduce((sum, file) => sum + Number(file.bytes), 0) + (64 * 1024 * 1024);
        const disk = await statfs(parent);
        if (Number(disk.bavail) * Number(disk.bsize) < required) throw Object.assign(
          new Error('whole-state restore needs more free disk space'), { code: 'T5_RESTORE_DISK_SPACE_INSUFFICIENT' });
        return;
      }
      if (!manifest || !expected) throw new Error('whole-state v2 manifest is missing');
      if (type === FRAME.fileStart) {
        if (current) throw new Error('whole-state v2 nested file is invalid'); const metadata = JSON.parse(data.toString('utf8'));
        const path = safeRelative(metadata.path); const expectedFile = expected.get(path);
        if (!expectedFile || seen.has(path) || metadata.bytes !== expectedFile.bytes
          || metadata.sha256 !== expectedFile.sha256 || metadata.compression !== 'gzip') throw new Error('whole-state v2 file header is invalid');
        const target = resolve(root, path); if (!inside(root, target)) throw new Error('whole-state v2 target escaped root');
        await mkdir(dirname(target), { recursive: true, mode: 0o700 }); const output = createWriteStream(target, { flags: 'wx', mode: 0o600 });
        const gunzip = createGunzip(); const hash = createHash('sha256'); let bytes = 0;
        gunzip.on('data', (chunk) => { bytes += chunk.length; hash.update(chunk);
          if (bytes > expectedFile.bytes) gunzip.destroy(new Error('whole-state v2 expanded beyond manifest size')); }); gunzip.pipe(output);
        current = { expected: expectedFile, output, gunzip, hash, get bytes() { return bytes; }, compressedBytes: 0 }; return;
      }
      if (type === FRAME.data) {
        if (!current) throw new Error('whole-state v2 data frame is unexpected'); current.compressedBytes += data.length;
        if (!current.gunzip.write(data)) await once(current.gunzip, 'drain'); return;
      }
      if (type === FRAME.fileEnd) { await finishCurrent(JSON.parse(data.toString('utf8'))); return; }
      if (type === FRAME.archiveEnd) { if (current || archiveEnded) throw new Error('whole-state v2 archive end is invalid'); archiveEnded = true; return; }
      throw new Error('whole-state v2 frame type is invalid');
    };
    for await (const chunk of decipher) {
      lastProgress = Date.now();
      pending = pending.length ? Buffer.concat([pending, chunk]) : Buffer.from(chunk);
      while (pending.length >= 5) {
        const length = pending.readUInt32BE(1); if (length > MAX_FRAME_BYTES) throw new Error('whole-state v2 frame length is invalid');
        if (pending.length < 5 + length) break; const type = pending[0]; const data = pending.subarray(5, 5 + length);
        pending = pending.subarray(5 + length); await handleFrame(type, data); lastProgress = Date.now();
        onProgress?.({ phase: 'restore', files: seen.size });
      }
    }
    if (pending.length || current || !archiveEnded || !manifest || seen.size !== expected.size) throw new Error('whole-state v2 archive is incomplete');
    return { root, manifest };
  } catch {
    current?.gunzip.destroy(); current?.output.destroy();
    await rm(root, { recursive: true, force: true });
    throw Object.assign(new Error('whole-state backup password or integrity check failed'), {
      code: 'T5_BACKUP_AUTHENTICATION_FAILED',
    });
  } finally { clearInterval(watchdog); key?.fill(0); }
}
