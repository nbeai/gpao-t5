import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';

const MAX_READ_CHARS = 16_000;
const CHUNK_CHARS = 64_000;
const compress = promisify(gzip);
const decompress = promisify(gunzip);
const id = (value) => {
  const text = String(value ?? '');
  if (!/^[0-9a-f-]{36}$/iu.test(text)) throw Object.assign(new Error('terminal output not found'), { status: 404 });
  return text;
};

export class TerminalOutputStore {
  constructor(directory, { makeId = randomUUID } = {}) {
    if (!directory) throw new TypeError('terminal output directory is required');
    this.directory = resolve(directory); this.objects = join(this.directory, 'objects'); this.makeId = makeId;
  }
  async ensure() {
    for (const path of [this.directory, this.objects]) {
      await mkdir(path, { recursive: true, mode: 0o700 }); await chmod(path, 0o700);
    }
  }
  async save({ sessionId, runId, stdout = '', stderr = '' } = {}) {
    if (!sessionId || !runId) throw new TypeError('terminal output owner is required');
    await this.ensure(); const handle = this.makeId(); const temporary = join(this.objects, `.${handle}.tmp`);
    const target = join(this.objects, handle); await mkdir(temporary, { mode: 0o700 });
    try {
      const streams = { stdout: String(stdout), stderr: String(stderr) };
      const streamFacts = {};
      for (const [name, text] of Object.entries(streams)) {
        const chunks = [];
        for (let start = 0, index = 0; start < text.length; index += 1) {
          let end = Math.min(text.length, start + CHUNK_CHARS);
          if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1])
            && /[\uDC00-\uDFFF]/u.test(text[end])) end -= 1;
          const encoded = await compress(Buffer.from(text.slice(start, end), 'utf8'));
          const file = `${name}-${String(index).padStart(6, '0')}.gz`;
          await writeFile(join(temporary, file), encoded, { mode: 0o600 });
          chunks.push({ file, start, end, storedBytes: encoded.length });
          start = end;
        }
        streamFacts[name] = {
          chars: text.length, bytes: Buffer.byteLength(text),
          storedBytes: chunks.reduce((sum, chunk) => sum + chunk.storedBytes, 0),
          sha256: createHash('sha256').update(text).digest('hex'), chunks,
        };
      }
      const manifest = {
        schema: 't5.terminal-output.v2', handle, sessionId, runId,
        createdAt: new Date().toISOString(), chunkChars: CHUNK_CHARS, streams: streamFacts,
      };
      await writeFile(join(temporary, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
      await rename(temporary, target);
      return structuredClone(manifest);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }
  async read({ handle: raw, sessionId, stream, offset = 0, limit = 4_000 } = {}) {
    const handle = id(raw); if (!['stdout', 'stderr'].includes(stream)) throw new TypeError('invalid terminal stream');
    const root = join(this.objects, handle); let manifest;
    try { manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')); }
    catch { throw Object.assign(new Error('terminal output not found'), { status: 404 }); }
    if (manifest.sessionId !== sessionId) throw Object.assign(new Error('terminal output not found'), { status: 404 });
    const total = manifest.streams?.[stream]?.chars ?? 0;
    const start = Number.isInteger(offset) ? Math.min(Math.max(0, offset), total) : 0;
    const count = Number.isInteger(limit) ? Math.min(Math.max(1, limit), MAX_READ_CHARS) : 4_000;
    const end = Math.min(total, start + count);
    let text;
    if (manifest.schema === 't5.terminal-output.v2') {
      const selected = (manifest.streams[stream].chunks ?? []).filter((chunk) => (
        chunk.end > start && chunk.start < end
      ));
      const ranges = [];
      for (const chunk of selected) {
        const decoded = (await decompress(await readFile(join(root, chunk.file)))).toString('utf8');
        ranges.push(decoded.slice(Math.max(0, start - chunk.start), Math.min(decoded.length, end - chunk.start)));
      }
      text = ranges.join('');
    } else {
      const legacy = await readFile(join(root, stream), 'utf8');
      text = legacy.slice(start, end);
    }
    return { state: 'read', handle, stream, offset: start, text,
      nextOffset: end < total ? end : null, totalChars: total,
      sha256: manifest.streams[stream].sha256 };
  }
}

export function makeTerminalOutputTool({ store, sessionId } = {}) {
  return { name: 'terminal_output',
    description: 'Read an exact bounded range from a truncated foreground Terminal output using only the output handle returned by exec. This never reruns the command.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      handle: { type: 'string' }, stream: { type: 'string', enum: ['stdout', 'stderr'] },
      offset: { type: ['integer', 'null'], minimum: 0 }, limit: { type: ['integer', 'null'], minimum: 1, maximum: MAX_READ_CHARS },
    }, required: ['handle', 'stream', 'offset', 'limit'] },
    execute: (args) => store.read({ ...args, sessionId }) };
}
