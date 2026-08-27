import { randomUUID } from 'node:crypto';
import { chmod, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MAX_CONTENT = 64 * 1024;
function identity(value = {}) {
  const output = { dev: Number(value.dev), ino: Number(value.ino), size: Number(value.size), mtimeMs: Number(value.mtimeMs) };
  if (Object.values(output).some((item) => !Number.isFinite(item))) throw new TypeError('file identity is invalid'); return output;
}
function queryTerms(value) { return [...new Set(String(value ?? '').normalize('NFKC').toLocaleLowerCase()
  .match(/[\p{L}\p{N}]+/gu)?.filter((item) => item.length >= 2) ?? [])].slice(0, 24); }
function ftsQuery(value) { return queryTerms(value).map((item) => `"${item.replaceAll('"', '""')}"`).join(' OR '); }

export class FileIntelligenceIndex {
  constructor(file) { if (!file) throw new TypeError('file intelligence index path is required'); this.file = resolve(file); this.ready = null; }
  async ensure() {
    if (this.ready) return this.ready;
    this.ready = (async () => { await mkdir(dirname(this.file), { recursive: true, mode: 0o700 }); await chmod(dirname(this.file), 0o700);
      const db = new DatabaseSync(this.file); try { db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, dev REAL NOT NULL, ino REAL NOT NULL, size REAL NOT NULL,
          mtime_ms REAL NOT NULL, display_name TEXT NOT NULL, location_text TEXT NOT NULL, extension TEXT NOT NULL,
          observation_kind TEXT NOT NULL, engine TEXT NOT NULL, content_text TEXT NOT NULL, observations_json TEXT,
          observed_at TEXT NOT NULL);
        CREATE VIRTUAL TABLE IF NOT EXISTS file_search USING fts5(path UNINDEXED, display_name, location_text, content_text,
          tokenize='unicode61 remove_diacritics 2');`); } finally { db.close(); }
      await chmod(this.file, 0o600); })();
    return this.ready;
  }
  async database(work) { await this.ensure(); const db = new DatabaseSync(this.file); try { db.exec('PRAGMA busy_timeout=5000'); return work(db); } finally { db.close(); } }
  async lookup({ path, fileIdentity, observationKind, engine } = {}) {
    const exact = resolve(path); const generation = identity(fileIdentity);
    return this.database((db) => { const row = db.prepare('SELECT * FROM files WHERE path=?').get(exact); if (!row
        || row.dev !== generation.dev || row.ino !== generation.ino || row.size !== generation.size
        || row.mtime_ms !== generation.mtimeMs || row.observation_kind !== observationKind || row.engine !== engine) return null;
      let observations = []; try { observations = row.observations_json ? JSON.parse(row.observations_json) : []; } catch { return null; }
      return { state: 'cached', text: row.content_text, observations, engine: row.engine, observedAt: row.observed_at };
    });
  }
  async record({ path, fileIdentity, displayName, locationText, extension, observationKind, engine, text, observations = [] } = {}) {
    const exact = resolve(path); const generation = identity(fileIdentity); const content = String(text ?? '').slice(0, MAX_CONTENT);
    const boundedObservations = observations.slice(0, 200).map((item) => ({ text: String(item?.text ?? '').slice(0, 1_000),
      confidence: Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : null, box: item?.box ?? null }));
    const row = { path: exact, ...generation, displayName: String(displayName ?? '').slice(0, 500),
      locationText: String(locationText ?? '').slice(0, 1_000), extension: String(extension ?? '').slice(0, 32),
      observationKind: String(observationKind), engine: String(engine), content, observations: JSON.stringify(boundedObservations),
      observedAt: new Date().toISOString() };
    await this.database((db) => { db.exec('BEGIN IMMEDIATE'); try {
      db.prepare('DELETE FROM file_search WHERE path=?').run(exact);
      db.prepare(`INSERT INTO files(path,dev,ino,size,mtime_ms,display_name,location_text,extension,observation_kind,engine,content_text,observations_json,observed_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET dev=excluded.dev,ino=excluded.ino,size=excluded.size,
        mtime_ms=excluded.mtime_ms,display_name=excluded.display_name,location_text=excluded.location_text,extension=excluded.extension,
        observation_kind=excluded.observation_kind,engine=excluded.engine,content_text=excluded.content_text,
        observations_json=excluded.observations_json,observed_at=excluded.observed_at`).run(exact, row.dev, row.ino, row.size, row.mtimeMs,
        row.displayName, row.locationText, row.extension, row.observationKind, row.engine, row.content, row.observations, row.observedAt);
      db.prepare('INSERT INTO file_search(path,display_name,location_text,content_text) VALUES(?,?,?,?)')
        .run(exact, row.displayName, row.locationText, row.content); db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; } });
    return { state: 'recorded', recordId: `file-cache-${randomUUID()}` };
  }
  async search({ query, limit = 100 } = {}) {
    const match = ftsQuery(query); if (!match) return [];
    return this.database((db) => db.prepare(`SELECT f.path,f.dev,f.ino,f.size,f.mtime_ms AS mtimeMs,f.display_name AS displayName,
      f.location_text AS locationText,f.extension,f.observation_kind AS observationKind,f.engine,f.content_text AS text,
      f.observations_json AS observationsJson,bm25(file_search) AS rank FROM file_search JOIN files f ON f.path=file_search.path
      WHERE file_search MATCH ? ORDER BY rank LIMIT ?`).all(match, Math.max(1, Math.min(500, Number(limit) || 100))).map((row) => ({
        ...row, observations: row.observationsJson ? JSON.parse(row.observationsJson) : [], observationsJson: undefined }))); 
  }
  async deletePath(path) { return this.database((db) => { const exact = resolve(path); db.exec('BEGIN IMMEDIATE'); try {
    db.prepare('DELETE FROM file_search WHERE path=?').run(exact); const result = db.prepare('DELETE FROM files WHERE path=?').run(exact);
    db.exec('COMMIT'); return { deleted: Number(result.changes) }; } catch (error) { db.exec('ROLLBACK'); throw error; } }); }
}
