import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generateLivingLibrary } from '../src/living-library.js';
import { createUserNote } from '../src/user-note.js';

const state = { events: [{ sequence: 1, type: 'memory_started' }], claims: [{
  memoryId: 'memory-obsidian', kind: 'decision', subjectKey: 'project.decision',
  value: '표준 Markdown을 정본으로 유지한다.', status: 'active',
  validFrom: null, validTo: null, sourceOrder: 1, sensitivity: 'normal',
  sources: [{ recordId: 'rr_fixture' }],
}] };

test('Obsidian 없음·metadata 있음 A/B는 generated HTML·Markdown·manifest를 바꾸지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-obsidian-ab-'));
  try {
    const notes = join(room, 'notes'); await createUserNote({ root: notes, noteId: 'owner-note',
      title: '사용자 노트', content: '이 글은 사용자가 직접 관리한다.' });
    const absent = await generateLivingLibrary({ state, outputRoot: join(room, 'absent'), userNotesRoot: notes,
      generatedAt: '2026-08-27T03:00:00.000Z' });
    await mkdir(join(notes, '.obsidian')); await writeFile(join(notes, '.obsidian', 'app.json'),
      '{"showInlineTitle":false}', 'utf8');
    const present = await generateLivingLibrary({ state, outputRoot: join(room, 'present'), userNotesRoot: notes,
      generatedAt: '2026-08-27T03:00:00.000Z' });
    for (const name of ['index.html', 'memory.md', 'manifest.json']) {
      assert.equal(await readFile(join(absent.directory, name), 'utf8'),
        await readFile(join(present.directory, name), 'utf8'), name);
    }
    assert.equal(absent.manifest.requiresObsidian, false);
    assert.equal(present.manifest.requiresObsidian, false);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('generated Markdown는 plugin query·wiki-link 없이 일반 파일로 읽힌다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-standard-markdown-'));
  try {
    const result = await generateLivingLibrary({ state, outputRoot: room,
      generatedAt: '2026-08-27T03:00:00.000Z' });
    const markdown = await readFile(join(result.directory, 'memory.md'), 'utf8');
    assert.match(markdown, /^# T5 기록/mu);
    assert.match(markdown, /표준 Markdown을 정본으로 유지한다/u);
    assert.doesNotMatch(markdown, /\[\[|!\[\[|```dataview|\.obsidian/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('live qualification은 secretRef 격리와 두 모델의 같은 no-plugin A/B를 요구한다', async () => {
  const runner = await readFile(new URL('../scripts/run-s3m5-live-model-qualification.mjs', import.meta.url), 'utf8');
  assert.match(runner, /secret-reference-only connection is required/u);
  assert.match(runner, /externalWrites: 0/u);
  assert.match(runner, /without-obsidian/u);
  assert.match(runner, /with-obsidian/u);
  assert.match(runner, /noPluginSameFiles/u);
});
