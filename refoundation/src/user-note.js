import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const hash = (value) => createHash('sha256').update(value).digest('hex');

function bounded(value, label, max) {
  const text = String(value ?? '').normalize('NFC').trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new TypeError(`${label} is invalid`);
  }
  return text;
}

function parseNote(text, name) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(text);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split('\n')) {
    const pair = /^([A-Za-z][A-Za-z0-9]*):\s*(.+)$/u.exec(line);
    if (!pair || fields[pair[1]] !== undefined) return null;
    fields[pair[1]] = pair[2].trim();
  }
  if (!fields.t5NoteId || !fields.title || !/^[A-Za-z0-9._:-]{1,128}$/u.test(fields.t5NoteId)) return null;
  return { noteId: fields.t5NoteId, title: fields.title, content: match[2].replace(/\n$/u, ''), name,
    sha256: hash(text), bytes: Buffer.byteLength(text, 'utf8') };
}

export async function createUserNote({ root: inputRoot, noteId, title, content } = {}) {
  const root = resolve(String(inputRoot ?? ''));
  const current = await lstat(root).catch((error) => { if (error?.code === 'ENOENT') return null; throw error; });
  if (current?.isSymbolicLink()) throw new Error('UserNote root must not be a symbolic link');
  await mkdir(root, { recursive: true, mode: 0o700 }); await chmod(root, 0o700);
  const id = bounded(noteId, 'noteId', 128);
  if (!/^[A-Za-z0-9._:-]+$/u.test(id)) throw new TypeError('noteId is invalid');
  const heading = bounded(title, 'title', 200); const body = String(content ?? '');
  if (Buffer.byteLength(body, 'utf8') > 1024 * 1024) throw new Error('UserNote content is too large');
  const path = join(root, `${id.replace(/[:]/gu, '-')}.md`);
  const existing = await lstat(path).catch((error) => { if (error?.code === 'ENOENT') return null; throw error; });
  if (existing) throw new Error('UserNote already exists');
  const text = `---\nt5NoteId: ${id}\ntitle: ${heading}\n---\n${body}\n`;
  await writeFile(path, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); await chmod(path, 0o600);
  return { path: await realpath(path), ...parseNote(text, `${id.replace(/[:]/gu, '-')}.md`) };
}

export async function scanUserNotes(inputRoot) {
  const root = resolve(String(inputRoot ?? ''));
  const rootStat = await lstat(root).catch((error) => { if (error?.code === 'ENOENT') return null; throw error; });
  if (!rootStat) return { notes: [], issues: [], snapshotDigest: hash('[]') };
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('UserNote root is unsafe');
  const notes = []; const issues = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.obsidian' || (!entry.name.endsWith('.md') && !entry.isSymbolicLink())) continue;
    const path = join(root, entry.name); const stat = await lstat(path);
    if (stat.isSymbolicLink()) { issues.push({ name: entry.name, reason: 'symbolic_link' }); continue; }
    if (!stat.isFile() || !entry.name.endsWith('.md')) continue;
    const text = await readFile(path, 'utf8'); const note = parseNote(text, entry.name);
    if (!note) issues.push({ name: entry.name, reason: 'invalid_frontmatter' }); else notes.push(note);
  }
  const counts = new Map(); for (const note of notes) counts.set(note.noteId, (counts.get(note.noteId) ?? 0) + 1);
  const unique = notes.filter((note) => {
    if (counts.get(note.noteId) === 1) return true;
    issues.push({ name: note.name, reason: 'duplicate_note_id', noteId: note.noteId }); return false;
  });
  return { notes: unique, issues, snapshotDigest: hash(JSON.stringify(unique.map((note) => ({
    noteId: note.noteId, sha256: note.sha256, name: note.name,
  })))) };
}
