import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const MAX_READ_CHARS = 16_000;
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
    const streams = { stdout: String(stdout), stderr: String(stderr) };
    for (const [name, text] of Object.entries(streams)) {
      await writeFile(join(temporary, name), text, { mode: 0o600 });
    }
    const manifest = { schema: 't5.terminal-output.v1', handle, sessionId, runId,
      streams: Object.fromEntries(Object.entries(streams).map(([name, text]) => [name, {
        chars: text.length, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex'),
      }])) };
    await writeFile(join(temporary, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
    await rename(temporary, target);
    return structuredClone(manifest);
  }
  async read({ handle: raw, sessionId, stream, offset = 0, limit = 4_000 } = {}) {
    const handle = id(raw); if (!['stdout', 'stderr'].includes(stream)) throw new TypeError('invalid terminal stream');
    const root = join(this.objects, handle); let manifest;
    try { manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')); }
    catch { throw Object.assign(new Error('terminal output not found'), { status: 404 }); }
    if (manifest.sessionId !== sessionId) throw Object.assign(new Error('terminal output not found'), { status: 404 });
    const text = await readFile(join(root, stream), 'utf8');
    const start = Number.isInteger(offset) ? Math.min(Math.max(0, offset), text.length) : 0;
    const count = Number.isInteger(limit) ? Math.min(Math.max(1, limit), MAX_READ_CHARS) : 4_000;
    const end = Math.min(text.length, start + count);
    return { state: 'read', handle, stream, offset: start, text: text.slice(start, end),
      nextOffset: end < text.length ? end : null, totalChars: text.length,
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
