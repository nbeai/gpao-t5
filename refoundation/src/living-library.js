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
  return claim.sensitivity === 'never_store' ? '[저장하지 않은 내용]' : String(claim.value ?? '');
}

function sourceSummary(sources = []) {
  const total = sources.length;
  if (!total) return '연결된 출처가 없습니다.';
  const available = sources.filter((source) => source.availability === 'available').length;
  if (available === total) return `출처 ${total}개를 모두 확인할 수 있습니다.`;
  if (available === 0) return `출처 ${total}개가 현재 확인되지 않습니다.`;
  return `출처 ${total}개 중 ${available}개를 확인할 수 있습니다.`;
}

function isForgotten(claim, tombstoneIds) {
  return claim.status === 'retracted' && tombstoneIds.has(claim.memoryId);
}

function claimItem(claim, index, tombstoneIds) {
  if (isForgotten(claim, tombstoneIds)) return { title: `잊은 기억 ${index + 1}`, forgotten: true };
  return { title: `기억 ${index + 1}`, value: claimValue(claim), status: claim.status,
    validFrom: claim.validFrom ?? '알 수 없음', validTo: claim.validTo ?? '알 수 없음',
    sourceSummary: sourceSummary(claim.sources) };
}

function knowledgeText(claim) {
  for (const field of ['value', 'statement', 'content', 'proposition']) {
    if (typeof claim?.[field] === 'string') return claim[field];
  }
  return '';
}

function knowledgeItem(claim, index) {
  return { title: `연구 기록 ${index + 1}`, value: knowledgeText(claim),
    status: claim?.status ?? 'recorded', sourceSummary: sourceSummary(claim?.sources) };
}

function timelineClaims(claims) {
  return [...claims].sort((left, right) => {
    const a = left.validFrom ?? left.recordedAt ?? '';
    const b = right.validFrom ?? right.recordedAt ?? '';
    return a.localeCompare(b) || Number(left.sourceOrder ?? 0) - Number(right.sourceOrder ?? 0);
  });
}

function viewModel(claims, tombstones, knowledgeClaims) {
  const tombstoneIds = new Set(tombstones.map((item) => item.memoryId));
  const select = (items) => items.map((claim, index) => claimItem(claim, index, tombstoneIds));
  return {
    current: select(claims.filter((claim) => claim.status === 'active')),
    history: select(claims.filter((claim) => claim.status !== 'active')),
    timeline: select(timelineClaims(claims)),
    projects: select(claims.filter((claim) => claim.scope?.workId || claim.scope?.projectId)),
    decisions: select(claims.filter((claim) => claim.kind === 'decision')),
    research: knowledgeClaims.map(knowledgeItem),
  };
}

function htmlItems(items) {
  if (!items.length) return '<p>없음</p>';
  return items.map((item) => item.forgotten
    ? `<article><h3>${escapeHtml(item.title)}</h3><p>이 기억은 사용자의 요청으로 잊었습니다.</p></article>`
    : ['<article>', `<h3>${escapeHtml(item.title)}</h3>`, `<p>${escapeHtml(item.value)}</p>`,
      `<p>상태: ${escapeHtml(item.status)}${item.validFrom ? ` · 유효: ${escapeHtml(item.validFrom)} → ${escapeHtml(item.validTo)}` : ''}</p>`,
      `<p>${escapeHtml(item.sourceSummary)}</p>`, '</article>'].join('')).join('');
}

function htmlSection(title, items) {
  return `<section><h2>${escapeHtml(title)}</h2>${htmlItems(items)}</section>`;
}

function htmlDocument(title, sections, notes = []) {
  const navigation = '<nav aria-label="기록 보기"><p>다른 기록 보기: '
    + '<a href="timeline.html">시간의 흐름</a> · <a href="projects.html">프로젝트</a> · '
    + '<a href="decisions.html">결정</a> · <a href="research.html">연구</a></p></nav>';
  const noteSection = notes === null ? '' : `<section><h2>사용자 노트</h2>${notes.length ? notes.map((note, index) => [
    '<article>', `<h3>${escapeHtml(note.title || `사용자 노트 ${index + 1}`)}</h3>`,
    `<p>${escapeHtml(note.content)}</p>`, '</article>',
  ].join('')).join('') : '<p>없음</p>'}</section>`;
  return ['<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>', escapeHtml(title),
    '</title></head><body><main><h1>', escapeHtml(title), '</h1>', navigation,
    ...sections.map(([heading, items]) => htmlSection(heading, items)), noteSection,
    '</main></body></html>'].join('');
}

function markdownItems(items) {
  const lines = [];
  if (!items.length) lines.push('없음', '');
  for (const item of items) {
    lines.push(`### ${escapeMarkdown(item.title)}`, '');
    if (item.forgotten) { lines.push('이 기억은 사용자의 요청으로 잊었습니다.', ''); continue; }
    lines.push(escapeMarkdown(item.value), '', `- 상태: ${escapeMarkdown(item.status)}`);
    if (item.validFrom) lines.push(`- 유효: ${escapeMarkdown(item.validFrom)} → ${escapeMarkdown(item.validTo)}`);
    lines.push(`- ${escapeMarkdown(item.sourceSummary)}`, '');
  }
  return lines;
}

function markdownDocument(title, sections, notes = []) {
  const lines = [`# ${title}`, '', '다른 기록 보기: [시간의 흐름](timeline.md) · [프로젝트](projects.md) · '
    + '[결정](decisions.md) · [연구](research.md)', ''];
  for (const [heading, items] of sections) lines.push(`## ${heading}`, '', ...markdownItems(items));
  if (notes !== null) {
    lines.push('## 사용자 노트', '');
    if (!notes.length) lines.push('없음', '');
    for (const [index, note] of notes.entries()) lines.push(`### ${escapeMarkdown(note.title || `사용자 노트 ${index + 1}`)}`,
      '', escapeMarkdown(note.content), '');
  }
  return `${lines.join('\n')}\n`;
}

function renderFiles(views, notes) {
  const definitions = {
    timeline: ['시간의 흐름', [['시간의 흐름', views.timeline]]],
    projects: ['프로젝트', [['프로젝트와 연결된 기억', views.projects]]],
    decisions: ['결정', [['결정 기록', views.decisions]]],
    research: ['연구', [['연구 기록', views.research]]],
  };
  const files = {
    'index.html': htmlDocument('T5 기록', [['현재 기억', views.current], ['과거·철회 기록', views.history]], notes),
    'memory.md': markdownDocument('T5 기록', [['현재 기억', views.current], ['과거·철회 기록', views.history]], notes),
  };
  for (const [name, [title, sections]] of Object.entries(definitions)) {
    files[`${name}.html`] = htmlDocument(title, sections, null);
    files[`${name}.md`] = markdownDocument(title, sections, null);
  }
  return files;
}

async function verifyExistingGeneration(directory, manifest) {
  const prior = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (JSON.stringify(prior) !== JSON.stringify(manifest)) throw new Error('Living Library generation conflict');
  for (const [name, expected] of Object.entries(prior.files ?? {})) {
    const stat = await existingType(join(directory, name));
    if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error('Living Library generation conflict');
    const content = await readFile(join(directory, name));
    if (sha256(content) !== expected.sha256 || content.byteLength !== expected.bytes) {
      throw new Error('Living Library generation conflict');
    }
  }
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
  const knowledgeClaims = Array.isArray(state.knowledgeClaims) ? structuredClone(state.knowledgeClaims) : [];
  const knowledgeClaimsDigest = sha256(JSON.stringify(knowledgeClaims));
  const noteSnapshot = userNotesRoot ? await scanUserNotes(userNotesRoot)
    : { notes: [], issues: [], snapshotDigest: sha256('[]') };
  const generationId = sha256(JSON.stringify({ sourceEventDigest, generatedAt: at,
    knowledgeClaimsDigest, userNoteSnapshotDigest: noteSnapshot.snapshotDigest })).slice(0, 24);
  const claims = structuredClone(state.claims).sort((left, right) => Number(left.sourceOrder) - Number(right.sourceOrder));
  const views = viewModel(claims, state.tombstones ?? [], knowledgeClaims);
  const content = renderFiles(views, noteSnapshot.notes);
  const files = Object.fromEntries(Object.entries(content).map(([name, value]) => [name, {
    sha256: sha256(value), bytes: Buffer.byteLength(value, 'utf8'),
  }]));
  const memoryHandles = [...new Set(claims.map((claim) => sha256(`t5-memory-handle:${claim.memoryId}`)))].sort();
  const viewCounts = { timeline: views.timeline.length, projects: views.projects.length,
    decisions: views.decisions.length, research: views.research.length };
  const manifestPayload = { schema: 't5.living-library-manifest.v1', canonical: false,
    requiresObsidian: false, generatedAt: at, generationId, sourceEventDigest, knowledgeClaimsDigest,
    claims: claims.length, activeClaims: claims.filter((claim) => claim.status === 'active').length,
    memoryHandles, viewCounts, knowledgeClaimsProjected: knowledgeClaims.length,
    userNotes: noteSnapshot.notes.length, userNoteIssues: noteSnapshot.issues.length,
    userNoteSnapshotDigest: noteSnapshot.snapshotDigest, files };
  const manifest = { ...manifestPayload,
    manifestPayloadSha256: sha256(JSON.stringify(manifestPayload)) };
  const directory = join(root, `generation-${generationId}`);
  const existing = await existingType(directory);
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('Living Library generation path is unsafe');
    await verifyExistingGeneration(directory, manifest);
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
