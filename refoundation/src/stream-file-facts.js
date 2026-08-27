import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';

export async function streamFileFacts(path, { onProgress = null } = {}) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error('stream source must be one regular file');
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length; hash.update(chunk); onProgress?.(chunk.length);
  }
  const after = await lstat(path);
  if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1
    || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
    || before.mtimeMs !== after.mtimeMs || bytes !== after.size) {
    throw Object.assign(new Error('stream source changed while reading'), { code: 'T5_STREAM_SOURCE_CHANGED' });
  }
  return { bytes, sha256: hash.digest('hex'),
    identity: { dev: after.dev, ino: after.ino, size: after.size, mtimeMs: after.mtimeMs } };
}
