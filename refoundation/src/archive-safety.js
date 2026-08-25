import { createHash } from 'node:crypto';
import { chmod, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { unzipSync } from 'fflate';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

function decodeName(bytes, utf8) {
  return bytes.toString(utf8 ? 'utf8' : 'latin1').normalize('NFC');
}

function pathProblem(name) {
  if (!name || name.includes('\0')) return 'invalid_path';
  if (name.includes('\\')) return 'backslash_path';
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return 'absolute_path';
  const parts = name.replace(/\/$/, '').split('/');
  if (parts.some((part) => part === '..')) return 'path_traversal';
  if (parts.some((part) => !part || part === '.')) return 'invalid_path';
  return null;
}

function findEocd(bytes) {
  const floor = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= floor; offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD) return offset;
  }
  throw new Error('invalid ZIP: end record not found');
}

export function inspectZipArchive(input, {
  maxEntries = 1_000,
  maxEntryBytes = 32 * 1024 * 1024,
  maxTotalBytes = 64 * 1024 * 1024,
  maxCompressionRatio = 100,
} = {}) {
  const bytes = Buffer.from(input);
  const eocd = findEocd(bytes);
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    return { state: 'unsafe_archive', reason: 'zip64_unsupported', entries: [], unsafeEntries: [] };
  }
  if (centralOffset + centralSize > eocd || entryCount > maxEntries) {
    return {
      state: 'unsafe_archive', reason: entryCount > maxEntries ? 'entry_count_exceeded' : 'invalid_central_directory',
      entries: [], unsafeEntries: [], entryCount,
    };
  }

  const entries = [];
  const unsafeEntries = [];
  let offset = centralOffset;
  let totalUncompressedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocd || bytes.readUInt32LE(offset) !== CENTRAL) {
      throw new Error('invalid ZIP central directory entry');
    }
    const madeBy = bytes.readUInt16LE(offset + 4);
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const compressedBytes = bytes.readUInt32LE(offset + 20);
    const uncompressedBytes = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const externalAttributes = bytes.readUInt32LE(offset + 38);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > eocd) throw new Error('invalid ZIP entry bounds');
    const path = decodeName(bytes.subarray(offset + 46, offset + 46 + nameLength), Boolean(flags & 0x800));
    const directory = path.endsWith('/');
    const unixMode = madeBy >> 8 === 3 ? (externalAttributes >>> 16) & 0xffff : 0;
    const symlink = (unixMode & 0o170000) === 0o120000;
    const ratio = compressedBytes === 0
      ? (uncompressedBytes === 0 ? 1 : Number.POSITIVE_INFINITY)
      : uncompressedBytes / compressedBytes;
    let reason = pathProblem(path);
    if (!reason && (flags & 1)) reason = 'encrypted_entry';
    if (!reason && symlink) reason = 'symbolic_link';
    if (!reason && ![0, 8].includes(method)) reason = 'unsupported_compression';
    if (!reason && uncompressedBytes > maxEntryBytes) reason = 'entry_size_exceeded';
    if (!reason && ratio > maxCompressionRatio) reason = 'compression_ratio_exceeded';
    const entry = {
      path, directory, compressedBytes, uncompressedBytes,
      compressionMethod: method, compressionRatio: Number.isFinite(ratio) ? Number(ratio.toFixed(2)) : null,
      unixMode: unixMode || null,
      ...(reason ? { reason } : {}),
    };
    entries.push(entry);
    if (reason) unsafeEntries.push(entry);
    totalUncompressedBytes += uncompressedBytes;
    offset = end;
  }
  let reason = unsafeEntries.length ? 'unsafe_entry' : null;
  if (totalUncompressedBytes > maxTotalBytes) reason = 'total_size_exceeded';
  return {
    state: reason ? 'unsafe_archive' : 'safe_manifest',
    ...(reason ? { reason } : {}),
    entryCount,
    entries: entries.sort((left, right) => left.path.localeCompare(right.path)),
    unsafeEntries,
    totalCompressedBytes: entries.reduce((sum, entry) => sum + entry.compressedBytes, 0),
    totalUncompressedBytes,
    limits: { maxEntries, maxEntryBytes, maxTotalBytes, maxCompressionRatio },
  };
}

export async function extractSafeZip({ bytes: input, directory, limits } = {}) {
  const bytes = Buffer.from(input ?? []);
  const manifest = inspectZipArchive(bytes, limits);
  if (manifest.state !== 'safe_manifest') throw new Error(`unsafe archive: ${manifest.reason}`);
  const requestedRoot = resolve(directory);
  await mkdir(requestedRoot, { recursive: false, mode: 0o700 });
  await chmod(requestedRoot, 0o700);
  const root = await realpath(requestedRoot);
  const expanded = unzipSync(bytes);
  const files = [];
  try {
    for (const entry of manifest.entries) {
      const path = resolve(root, entry.path);
      const rel = relative(root, path);
      if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(root, rel) !== path) {
        throw new Error('unsafe archive path after resolution');
      }
      if (entry.directory) {
        await mkdir(path, { recursive: true, mode: 0o700 });
        await chmod(path, 0o700);
        continue;
      }
      const content = expanded[entry.path];
      if (!content || content.length !== entry.uncompressedBytes) throw new Error('archive extraction size mismatch');
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, content, { mode: 0o600, flag: 'wx' });
      await chmod(path, 0o600);
      files.push({
        path: await realpath(path), bytes: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
      });
    }
  } catch (error) {
    await rm(root, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return { state: 'extracted', root, manifest, files };
}
