import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

async function sha256(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }
function safeId(value, label) { const text = String(value ?? ''); if (!/^[0-9a-z-]{8,80}$/iu.test(text)) throw new TypeError(`${label} is invalid`); return text; }

export class FileSourceManifestStore {
  constructor(directory) { if (!directory) throw new TypeError('source manifest directory is required'); this.directory = directory; }
  file(id) { return join(this.directory, `${safeId(id, 'source manifest')}.json`); }
  async save(value) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 }); await chmod(this.directory, 0o700);
    const target = this.file(value.manifestId); const temporary = `${target}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, target); }
    finally { await rm(temporary, { force: true }); }
  }
  async create({ sessionId, purpose, unknowns = [], sources } = {}) {
    const owner = safeId(sessionId, 'session'); const goal = String(purpose ?? '').trim();
    if (!goal || goal.length > 500 || !Array.isArray(sources) || sources.length < 1 || sources.length > 12) throw new TypeError('source manifest input is invalid');
    const records = [];
    for (const source of sources) {
      const stat = await lstat(source.path); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('source file is unavailable');
      if (stat.dev !== source.identity?.dev || stat.ino !== source.identity?.ino || stat.size !== source.identity?.size
        || stat.mtimeMs !== source.identity?.mtimeMs) throw new Error('source file changed before manifest creation');
      records.push({ path: source.path, displayName: source.displayName, usage: String(source.usage ?? '').slice(0, 500),
        identity: source.identity, bytes: stat.size, sha256: await sha256(source.path) });
    }
    const manifest = { schema: 't5.file-source-manifest.v1', manifestId: `sources-${randomUUID()}`, sessionId: owner,
      purpose: goal, unknowns: [...new Set(unknowns.map(String).map((item) => item.trim()).filter(Boolean))].slice(0, 20),
      sources: records, createdAt: new Date().toISOString() };
    await this.save(manifest); return this.public(manifest);
  }
  async read(manifestId) { const path = this.file(manifestId); const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 256 * 1024) throw new Error('source manifest is unavailable');
    return JSON.parse(await readFile(path, 'utf8')); }
  public(manifest) { return { manifestId: manifest.manifestId, purpose: manifest.purpose, unknowns: manifest.unknowns,
    sources: manifest.sources.map((item) => ({ displayName: item.displayName, usage: item.usage, bytes: item.bytes })) }; }
  async verify({ sessionId, manifestId } = {}) {
    const manifest = await this.read(manifestId); if (manifest.sessionId !== safeId(sessionId, 'session')) throw new Error('source manifest owner mismatch');
    for (const source of manifest.sources) {
      const stat = await lstat(source.path); if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== source.identity.dev
        || stat.ino !== source.identity.ino || stat.size !== source.identity.size || stat.mtimeMs !== source.identity.mtimeMs
        || await sha256(source.path) !== source.sha256) throw new Error('source file changed after manifest creation');
    }
    return { state: 'verified', ...this.public(manifest) };
  }
}
