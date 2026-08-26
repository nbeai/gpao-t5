import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createUserNote, scanUserNotes } from '../src/user-note.js';
import { generateLivingLibrary } from '../src/living-library.js';

const emptyState = { events: [{ schema: 't5.memory-event.v1', sequence: 1, type: 'memory_started' }],
  claims: [], tombstones: [] };

test('UserNote는 plain Markdown 원본이고 외부 edit 뒤 같은 noteId와 새 digest로 관측된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-user-note-'));
  try {
    const root = join(room, 'notes');
    const created = await createUserNote({ root, noteId: 'note-1', title: '연구 메모', content: '첫 내용' });
    let scan = await scanUserNotes(root);
    assert.equal(scan.notes[0].noteId, 'note-1'); assert.equal(scan.notes[0].content, '첫 내용');
    const before = scan.notes[0].sha256;
    await writeFile(created.path, (await readFile(created.path, 'utf8')).replace('첫 내용', '사용자 수정'), 'utf8');
    scan = await scanUserNotes(root);
    assert.equal(scan.notes[0].noteId, 'note-1'); assert.equal(scan.notes[0].content, '사용자 수정');
    assert.notEqual(scan.notes[0].sha256, before);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('UserNote rename은 frontmatter noteId로 이어지고 파일명이 identity가 아니다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-user-note-rename-'));
  try {
    const root = join(room, 'notes'); const created = await createUserNote({
      root, noteId: 'note-rename', title: '이름 변경', content: '내용',
    });
    await rename(created.path, join(root, '사람이 바꾼 이름.md'));
    const scan = await scanUserNotes(root);
    assert.equal(scan.notes[0].noteId, 'note-rename');
    assert.equal(scan.notes[0].name, '사람이 바꾼 이름.md');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('invalid frontmatter·duplicate ID·symlink는 note로 승격하지 않고 issue로 분리한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-user-note-invalid-'));
  try {
    const root = join(room, 'notes'); await mkdir(root);
    await writeFile(join(root, 'invalid.md'), '# no frontmatter', 'utf8');
    await writeFile(join(root, 'a.md'), '---\nt5NoteId: duplicate\ntitle: A\n---\nA', 'utf8');
    await writeFile(join(root, 'b.md'), '---\nt5NoteId: duplicate\ntitle: B\n---\nB', 'utf8');
    await symlink(join(root, 'a.md'), join(root, 'link.md'));
    const scan = await scanUserNotes(root);
    assert.equal(scan.notes.length, 0);
    assert.ok(scan.issues.some((item) => item.reason === 'invalid_frontmatter'));
    assert.ok(scan.issues.some((item) => item.reason === 'duplicate_note_id'));
    assert.ok(scan.issues.some((item) => item.reason === 'symbolic_link'));
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('.obsidian metadata 유무는 UserNote와 Library 기능을 바꾸지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-user-note-obsidian-'));
  try {
    const root = join(room, 'notes'); await createUserNote({ root, noteId: 'note-obsidian', title: '독립', content: '본문' });
    const before = await scanUserNotes(root); await mkdir(join(root, '.obsidian'));
    await writeFile(join(root, '.obsidian', 'workspace.json'), '{"x":1}', 'utf8');
    const after = await scanUserNotes(root);
    assert.deepEqual(after.notes.map((item) => item.sha256), before.notes.map((item) => item.sha256));
    const library = await generateLivingLibrary({ state: emptyState, outputRoot: join(room, 'library'),
      userNotesRoot: root, generatedAt: '2026-08-27T02:00:00.000Z' });
    assert.equal(library.manifest.requiresObsidian, false);
    assert.equal(library.manifest.userNotes, 1);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('generation 중 UserNote가 바뀌면 candidate를 publish하지 않고 새 snapshot을 요구한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-user-note-race-'));
  try {
    const root = join(room, 'notes'); const note = await createUserNote({
      root, noteId: 'note-race', title: '경합', content: 'before',
    });
    await assert.rejects(generateLivingLibrary({ state: emptyState, outputRoot: join(room, 'library'),
      userNotesRoot: root, generatedAt: '2026-08-27T02:00:00.000Z',
      beforePublish: async () => writeFile(note.path,
        (await readFile(note.path, 'utf8')).replace('before', 'after'), 'utf8'),
    }), /UserNote changed during generation/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});
