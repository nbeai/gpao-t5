import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { scanUserNotes } from './user-note.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const escapeHtml = (value) => String(value ?? '').replace(/&/gu, '&amp;').replace(/</gu, '&lt;')
  .replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&#39;');
const escapeMarkdown = (value) => String(value ?? '').replace(/[\\`*_{}\[\]()#+.!|>-]/gu, '\\$&');

async function existingType(path) {
  try { return await lstat(path); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

function canonicalTime(value) {
  const parsed = new Date(value);
  if (typeof value !== 'string' || !Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError('generatedAt must be canonical UTC time');
  }
  return value;
}

function claimValue(claim) {
  return claim.sensitivity === 'never_store' ? '[never stored]' : String(claim.value ?? '');
}

function sourceList(claim) {
  return (claim.sources ?? []).map((source) => source.recordId).filter(Boolean);
}

function renderHtml(claims, notes = []) {
  const section = (title, items) => `<section><h2>${escapeHtml(title)}</h2>${items.length ? items.map((claim) => [
    '<article>',
    `<h3>${escapeHtml(claim.subjectKey)}</h3>`,
    `<p>${escapeHtml(claimValue(claim))}</p>`,
    `<p>상태: ${escapeHtml(claim.status)} · 유효: ${escapeHtml(claim.validFrom ?? 'unknown')} → ${escapeHtml(claim.validTo ?? 'unknown')}</p>`,
    `<p>출처: ${sourceList(claim).map(escapeHtml).join(', ') || 'unknown'}</p>`,
    '</article>',
  ].join('')).join('') : '<p>없음</p>'}</section>`;
  const current = claims.filter((claim) => claim.status === 'active');
  const history = claims.filter((claim) => claim.status !== 'active');
  const noteSection = `<section><h2>사용자 노트</h2>${notes.length ? notes.map((note) => [
    '<article>', `<h3>${escapeHtml(note.title)}</h3>`, `<p>${escapeHtml(note.content)}</p>`,
    `<p>noteId: ${escapeHtml(note.noteId)}</p>`, '</article>',
  ].join('')).join('') : '<p>없음</p>'}</section>`;
  return ['<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>T5 기록</title></head><body>',
    '<main><h1>T5 기록</h1>', section('현재 기억', current), section('과거·철회 기록', history),
    noteSection, '</main></body></html>'].join('');
}

function renderMarkdown(claims, notes = []) {
  const lines = ['# T5 기록', ''];
  for (const [title, items] of [['현재 기억', claims.filter((claim) => claim.status === 'active')],
    ['과거·철회 기록', claims.filter((claim) => claim.status !== 'active')]]) {
    lines.push(`## ${title}`, '');
    if (!items.length) lines.push('없음', '');
    for (const claim of items) lines.push(`### ${escapeMarkdown(claim.subjectKey)}`, '',
      escapeMarkdown(claimValue(claim)), '', `- 상태: ${claim.status}`,
      `- 유효: ${claim.validFrom ?? 'unknown'} → ${claim.validTo ?? 'unknown'}`,
      `- 출처: ${sourceList(claim).join(', ') || 'unknown'}`, '');
  }
  lines.push('## 사용자 노트', '');
  if (!notes.length) lines.push('없음', '');
  for (const note of notes) lines.push(`### ${escapeMarkdown(note.title)}`, '',
    escapeMarkdown(note.content), '', `- noteId: ${note.noteId}`, '');
  return `${lines.join('\n')}\n`;
}

export async function generateLivingLibrary({
  state, outputRoot, generatedAt, userNotesRoot = null, beforePublish = null,
} = {}) {
  if (!state || !Array.isArray(state.events) || !Array.isArray(state.claims)) {
    throw new TypeError('Living Library requires MemoryLedger state');
  }
  const root = resolve(String(outputRoot ?? ''));
  const rootStat = await existingType(root);
  if (rootStat?.isSymbolicLink()) throw new Error('Living Library output root must not be a symbolic link');
  if (rootStat && !rootStat.isDirectory()) throw new Error('Living Library output root must be a directory');
  await mkdir(root, { recursive: true, mode: 0o700 }); await chmod(root, 0o700);
  const at = canonicalTime(generatedAt);
  const sourceEventDigest = sha256(JSON.stringify(state.events));
  const noteSnapshot = userNotesRoot ? await scanUserNotes(userNotesRoot)
    : { notes: [], issues: [], snapshotDigest: sha256('[]') };
  const generationId = sha256(JSON.stringify({ sourceEventDigest, generatedAt: at,
    userNoteSnapshotDigest: noteSnapshot.snapshotDigest })).slice(0, 24);
  const claims = structuredClone(state.claims).sort((left, right) => Number(left.sourceOrder) - Number(right.sourceOrder));
  const content = { 'index.html': renderHtml(claims, noteSnapshot.notes),
    'memory.md': renderMarkdown(claims, noteSnapshot.notes) };
  const files = Object.fromEntries(Object.entries(content).map(([name, value]) => [name, {
    sha256: sha256(value), bytes: Buffer.byteLength(value, 'utf8'),
  }]));
  const manifestPayload = { schema: 't5.living-library-manifest.v1', canonical: false,
    requiresObsidian: false, generatedAt: at, generationId, sourceEventDigest,
    claims: claims.length, activeClaims: claims.filter((claim) => claim.status === 'active').length,
    userNotes: noteSnapshot.notes.length, userNoteIssues: noteSnapshot.issues.length,
    userNoteSnapshotDigest: noteSnapshot.snapshotDigest, files };
  const manifest = { ...manifestPayload,
    manifestPayloadSha256: sha256(JSON.stringify(manifestPayload)) };
  const directory = join(root, `generation-${generationId}`);
  const existing = await existingType(directory);
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('Living Library generation path is unsafe');
    const prior = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    if (JSON.stringify(prior) !== JSON.stringify(manifest)) throw new Error('Living Library generation conflict');
    return { directory, manifest };
  }
  const candidate = join(root, `.candidate-${randomUUID()}`);
  await mkdir(candidate, { mode: 0o700 }); await chmod(candidate, 0o700);
  try {
    for (const [name, value] of Object.entries(content)) {
      await writeFile(join(candidate, name), value, { encoding: 'utf8', mode: 0o600 });
      await chmod(join(candidate, name), 0o600);
    }
    await writeFile(join(candidate, 'manifest.json'), JSON.stringify(manifest, null, 2), {
      encoding: 'utf8', mode: 0o600,
    });
    await chmod(join(candidate, 'manifest.json'), 0o600);
    if (beforePublish) await beforePublish();
    if (userNotesRoot) {
      const currentNotes = await scanUserNotes(userNotesRoot);
      if (currentNotes.snapshotDigest !== noteSnapshot.snapshotDigest) {
        throw new Error('UserNote changed during generation');
      }
    }
    await rename(candidate, directory);
  } catch (error) {
    await rm(candidate, { recursive: true, force: true }); throw error;
  }
  return { directory, manifest };
}
