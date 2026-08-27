import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { decodeTextDocument, detectTextDocument, inspectDelimitedText } from './text-document-observer.js';

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
  async create({ sessionId, purpose, unknowns = [], sources, standardization = null } = {}) {
    const owner = safeId(sessionId, 'session'); const goal = String(purpose ?? '').trim();
    if (!goal || goal.length > 500 || !Array.isArray(sources) || sources.length < 1 || sources.length > 12) throw new TypeError('source manifest input is invalid');
    const records = [];
    for (const source of sources) {
      const stat = await lstat(source.path); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('source file is unavailable');
      if (stat.dev !== source.identity?.dev || stat.ino !== source.identity?.ino || stat.size !== source.identity?.size
        || stat.mtimeMs !== source.identity?.mtimeMs) throw new Error('source file changed before manifest creation');
      records.push({ path: source.path, displayName: source.displayName, usage: String(source.usage ?? '').slice(0, 500),
        columnMappings: source.columnMappings ?? null, identity: source.identity, bytes: stat.size, sha256: await sha256(source.path) });
    }
    if (standardization) {
      if (standardization.mode !== 'append_rows' || !Array.isArray(standardization.outputColumns)
        || standardization.outputColumns.length < 1 || standardization.outputColumns.length > 100
        || standardization.outputColumns.some((item) => !String(item ?? '').trim() || String(item).length > 200)
        || new Set(standardization.outputColumns).size !== standardization.outputColumns.length
        || records.some((item) => !Array.isArray(item.columnMappings)
          || item.columnMappings.length !== standardization.outputColumns.length
          || new Set(item.columnMappings.map((mapping) => mapping.outputColumn)).size !== standardization.outputColumns.length
          || item.columnMappings.some((mapping) => !standardization.outputColumns.includes(mapping.outputColumn)
            || !String(mapping.sourceColumn ?? '').trim()))) {
        throw new TypeError('tabular standardization contract is invalid');
      }
    }
    const manifest = { schema: 't5.file-source-manifest.v1', manifestId: `sources-${randomUUID()}`, sessionId: owner,
      purpose: goal, unknowns: [...new Set(unknowns.map(String).map((item) => item.trim()).filter(Boolean))].slice(0, 20),
      sources: records, standardization, createdAt: new Date().toISOString() };
    await this.save(manifest); return this.public(manifest);
  }
  async read(manifestId) { const path = this.file(manifestId); const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 256 * 1024) throw new Error('source manifest is unavailable');
    return JSON.parse(await readFile(path, 'utf8')); }
  public(manifest) { return { manifestId: manifest.manifestId, purpose: manifest.purpose, unknowns: manifest.unknowns,
    sources: manifest.sources.map((item) => ({ displayName: item.displayName, usage: item.usage, bytes: item.bytes })),
    standardization: manifest.standardization ? { mode: manifest.standardization.mode,
      outputColumns: manifest.standardization.outputColumns } : null }; }
  async verify({ sessionId, manifestId } = {}) {
    const manifest = await this.read(manifestId); if (manifest.sessionId !== safeId(sessionId, 'session')) throw new Error('source manifest owner mismatch');
    for (const source of manifest.sources) {
      const stat = await lstat(source.path); if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== source.identity.dev
        || stat.ino !== source.identity.ino || stat.size !== source.identity.size || stat.mtimeMs !== source.identity.mtimeMs
        || await sha256(source.path) !== source.sha256) throw new Error('source file changed after manifest creation');
    }
    return { state: 'verified', ...this.public(manifest) };
  }
  async verifyOutput({ sessionId, manifestId, outputPath } = {}) {
    const manifest = await this.read(manifestId); if (manifest.sessionId !== safeId(sessionId, 'session')) throw new Error('source manifest owner mismatch');
    if (!manifest.standardization) return { state: 'not_applicable' };
    const parse = async (path) => {
      const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error('tabular reconciliation input is too large');
      const bytes = await readFile(path); const detected = detectTextDocument(bytes, path); if (!detected) throw new Error('tabular reconciliation encoding is unsupported');
      const text = decodeTextDocument(bytes, detected.encoding); const delimiter = extname(path).toLowerCase() === '.tsv' ? '\t' : ',';
      const table = inspectDelimitedText(text, { delimiter, maxRows: 100_001, maxColumns: 100 });
      if (table.projection.truncated || table.malformedQuotedField || table.irregularRows) throw new Error('tabular reconciliation structure is incomplete');
      return table;
    };
    const expected = [];
    for (const source of manifest.sources) {
      const table = await parse(source.path); const header = new Map(table.header.map((name, index) => [name, index]));
      const mapping = new Map(source.columnMappings.map((item) => [item.outputColumn, item.sourceColumn]));
      for (const outputColumn of manifest.standardization.outputColumns) if (!header.has(mapping.get(outputColumn))) throw new Error('tabular source column is missing');
      for (const row of table.rows) expected.push(manifest.standardization.outputColumns.map((column) => row[header.get(mapping.get(column))]));
    }
    const output = await parse(outputPath);
    if (JSON.stringify(output.header) !== JSON.stringify(manifest.standardization.outputColumns)
      || JSON.stringify(output.rows) !== JSON.stringify(expected)) throw new Error('tabular reconciliation output does not match bound sources');
    return { state: 'verified', mode: 'append_rows', rowCount: expected.length,
      outputColumns: manifest.standardization.outputColumns };
  }
}
