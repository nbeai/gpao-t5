import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { generateLivingLibrary } from '../src/living-library.js';
import { LivingLibraryRegistry, livingLibraryMemoryHandle } from '../src/living-library-registry.js';
import { createUserNote } from '../src/user-note.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

test('memory handle은 원문 ID를 노출하지 않는 domain-separated digest다', () => {
  assert.equal(livingLibraryMemoryHandle('memory-a'), sha256('t5-memory-handle:memory-a'));
  assert.notEqual(livingLibraryMemoryHandle('memory-a'), sha256('memory-a'));
});

test('실제 generator의 10개 view manifest를 registry가 그대로 검증·serve한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-library-registry-integration-'));
  const state = { events: [{ schema: 't5.memory-event.v1', sequence: 1, type: 'memory_started' }],
    claims: [], tombstones: [], knowledgeClaims: [] };
  try {
    const root = join(room, 'library');
    const generated = await generateLivingLibrary({ state, outputRoot: root,
      generatedAt: '2026-08-27T00:00:00.000Z' });
    const registry = new LivingLibraryRegistry({ outputRoot: root, memoryLedger: { read: async () => state } });
    assert.equal((await registry.inspect({ generationId: generated.manifest.generationId })).state, 'ready');
    for (const file of Object.keys(generated.manifest.files)) {
      assert.equal((await registry.serve({ generationId: generated.manifest.generationId, file })).state, 'ready');
    }
    assert.equal(Object.keys(generated.manifest.files).length, 10);
  } finally { await rm(room, { recursive: true, force: true }); }
});

async function makeGeneration(root, { memoryIds = ['memory-a'], events = [{ sequence: 1 }],
  generationId = '0123456789abcdef01234567' } = {}) {
  const directory = join(root, `generation-${generationId}`); await mkdir(directory, { recursive: true });
  const content = { 'index.html': Buffer.from('<h1>기록</h1>'), 'memory.md': Buffer.from('# 기록\n') };
  for (const name of ['timeline', 'projects', 'decisions', 'research']) {
    content[`${name}.html`] = Buffer.from(`<h1>${name}</h1>`);
    content[`${name}.md`] = Buffer.from(`# ${name}\n`);
  }
  for (const [name, bytes] of Object.entries(content)) await writeFile(join(directory, name), bytes);
  const payload = {
    schema: 't5.living-library-manifest.v1', canonical: false, requiresObsidian: false,
    generatedAt: '2026-08-27T00:00:00.000Z', generationId,
    sourceEventDigest: sha256(JSON.stringify(events)), memoryHandles: memoryIds.map(livingLibraryMemoryHandle),
    claims: memoryIds.length, activeClaims: memoryIds.length, userNotes: 0, userNoteIssues: 0,
    userNoteSnapshotDigest: sha256('[]'), files: Object.fromEntries(Object.entries(content)
      .map(([name, bytes]) => [name, { sha256: sha256(bytes), bytes: bytes.byteLength }])),
  };
  const manifest = { ...payload, manifestPayloadSha256: sha256(JSON.stringify(payload)) };
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { directory, generationId, manifest, content };
}

test('검증된 exact generation만 serve하고 current MemoryLedger digest 변화 뒤 stale content를 거부한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-library-registry-')); const events = [{ sequence: 1 }];
  try {
    const root = join(room, 'library'); await mkdir(root); const generated = await makeGeneration(root, { events });
    const memoryLedger = { read: async () => ({ events }) };
    const registry = new LivingLibraryRegistry({ outputRoot: root, memoryLedger });
    const ready = await registry.serve({ generationId: generated.generationId, file: 'index.html' });
    assert.equal(ready.state, 'ready'); assert.deepEqual(ready.content, generated.content['index.html']);
    events.push({ sequence: 2 });
    const stale = await registry.serve({ generationId: generated.generationId, file: 'index.html' });
    assert.equal(stale.state, 'stale'); assert.equal(stale.content, null);
    assert.equal((await registry.serve({ generationId: '../outside' })).state, 'unsafe');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('root·generation·manifest·content symlink/hardlink/sha 변조와 unmanaged entry를 거부한다', async (t) => {
  await t.test('root symlink', async () => {
    const room = await mkdtemp(join(tmpdir(), 't5-library-root-link-'));
    try {
      const outside = join(room, 'outside'); await mkdir(outside); const linked = join(room, 'linked');
      await symlink(outside, linked);
      const registry = new LivingLibraryRegistry({ outputRoot: linked, memoryLedger: { read: async () => ({ events: [] }) } });
      assert.equal((await registry.inspect({ generationId: '0123456789abcdef01234567' })).state, 'unsafe');
    } finally { await rm(room, { recursive: true, force: true }); }
  });
  for (const fault of ['content_symlink', 'content_hardlink', 'content_digest', 'manifest_hardlink',
    'manifest_digest', 'generation_symlink', 'extra']) {
    await t.test(fault, async () => {
      const room = await mkdtemp(join(tmpdir(), 't5-library-file-fault-')); const events = [{ sequence: 1 }];
      try {
        const root = join(room, 'library'); await mkdir(root); const generated = await makeGeneration(root, { events });
        if (fault === 'content_symlink') {
          await rm(join(generated.directory, 'index.html')); await symlink(join(room, 'outside'), join(generated.directory, 'index.html'));
        } else if (fault === 'content_hardlink') {
          await link(join(generated.directory, 'index.html'), join(room, 'second-link'));
        } else if (fault === 'content_digest') await writeFile(join(generated.directory, 'index.html'), 'changed');
        else if (fault === 'manifest_hardlink') await link(join(generated.directory, 'manifest.json'), join(room, 'manifest-link'));
        else if (fault === 'manifest_digest') {
          const manifest = JSON.parse(await readFile(join(generated.directory, 'manifest.json'), 'utf8'));
          manifest.activeClaims = 99; await writeFile(join(generated.directory, 'manifest.json'), JSON.stringify(manifest));
        } else if (fault === 'generation_symlink') {
          await rm(generated.directory, { recursive: true }); await symlink(room, generated.directory);
        }
        else await writeFile(join(generated.directory, 'private-note.md'), 'must survive');
        const registry = new LivingLibraryRegistry({ outputRoot: root, memoryLedger: { read: async () => ({ events }) } });
        assert.notEqual((await registry.inspect({ generationId: generated.generationId })).state, 'ready');
      } finally { await rm(room, { recursive: true, force: true }); }
    });
  }
});

test('memory handle에 exact 일치하는 파생 generation만 purge하고 root의 UserNotes와 비관리 경로는 보존한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-library-purge-')); const events = [{ sequence: 1 }];
  try {
    const root = join(room, 'library'); await mkdir(root);
    const match = await makeGeneration(root, { memoryIds: ['memory-a'], events,
      generationId: 'aaaaaaaaaaaaaaaaaaaaaaaa' });
    const keep = await makeGeneration(root, { memoryIds: ['memory-b'], events,
      generationId: 'bbbbbbbbbbbbbbbbbbbbbbbb' });
    const notes = join(root, 'UserNotes'); await mkdir(notes); await writeFile(join(notes, 'mine.md'), 'keep');
    const outside = join(room, 'outside.md'); await writeFile(outside, 'keep');
    const registry = new LivingLibraryRegistry({ outputRoot: root, memoryLedger: { read: async () => ({ events }) } });
    const result = await registry.purgeHandle(livingLibraryMemoryHandle('memory-a'));
    assert.deepEqual(result, { state: 'executed', deletedGenerationIds: [match.generationId] });
    await assert.rejects(lstat(match.directory), { code: 'ENOENT' });
    assert.equal((await lstat(keep.directory)).isDirectory(), true);
    assert.equal(await readFile(join(notes, 'mine.md'), 'utf8'), 'keep');
    assert.equal(await readFile(outside, 'utf8'), 'keep');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('purgeStale은 current ledger와 다른 generation만 지우고 current·UserNotes를 보존한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-library-stale-')); const currentEvents = [{ sequence: 1 }, { sequence: 2 }];
  try {
    const root = join(room, 'library'); await mkdir(root);
    const stale = await makeGeneration(root, { events: [{ sequence: 1 }],
      generationId: 'aaaaaaaaaaaaaaaaaaaaaaaa' });
    const current = await makeGeneration(root, { events: currentEvents,
      generationId: 'bbbbbbbbbbbbbbbbbbbbbbbb' });
    const notes = join(root, 'UserNotes'); await mkdir(notes); await writeFile(join(notes, 'mine.md'), 'keep');
    const registry = new LivingLibraryRegistry({ outputRoot: root,
      memoryLedger: { read: async () => ({ events: currentEvents }) } });
    const result = await registry.purgeStale();
    assert.equal(result.state, 'executed'); assert.deepEqual(result.deletedGenerationIds, [stale.generationId]);
    assert.equal(result.ledgerChangedDuringPurge, false);
    await assert.rejects(lstat(stale.directory), { code: 'ENOENT' });
    assert.equal((await lstat(current.directory)).isDirectory(), true);
    assert.equal(await readFile(join(notes, 'mine.md'), 'utf8'), 'keep');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('생성 뒤 valid UserNote의 편집·이름 변경은 old serve를 stale로 만들고 purgeStale이 view만 제거한다', async (t) => {
  for (const mutation of ['edit', 'rename']) await t.test(mutation, async () => {
    const room = await mkdtemp(join(tmpdir(), 't5-library-note-stale-'));
    const state = { events: [{ schema: 't5.memory-event.v1', sequence: 1, type: 'memory_started' }],
      claims: [], tombstones: [], knowledgeClaims: [] };
    try {
      const root = join(room, 'library'); const notes = join(room, 'UserNotes');
      const note = await createUserNote({ root: notes, noteId: 'note-1', title: '연구 기록', content: '첫 내용' });
      const generated = await generateLivingLibrary({ state, outputRoot: root, userNotesRoot: notes,
        generatedAt: '2026-08-27T00:00:00.000Z' });
      const registry = new LivingLibraryRegistry({ outputRoot: root, userNotesRoot: notes,
        memoryLedger: { read: async () => state } });
      assert.equal((await registry.serve({ generationId: generated.manifest.generationId })).state, 'ready');
      if (mutation === 'rename') await rename(note.path, join(notes, '사람이 바꾼 이름.md'));
      else await writeFile(note.path, '---\nt5NoteId: note-1\ntitle: 연구 기록\n---\n바뀐 내용\n');
      const stale = await registry.serve({ generationId: generated.manifest.generationId });
      assert.equal(stale.state, 'stale'); assert.equal(stale.content, null);
      const purged = await registry.purgeStale();
      assert.equal(purged.state, 'executed');
      assert.deepEqual(purged.deletedGenerationIds, [generated.manifest.generationId]);
      assert.equal(await readFile(mutation === 'rename' ? join(notes, '사람이 바꾼 이름.md') : note.path, 'utf8')
        .then((text) => text.includes(mutation === 'rename' ? '첫 내용' : '바뀐 내용')), true);
    } finally { await rm(room, { recursive: true, force: true }); }
  });
});

test('purgeStale은 invalid generation을 삭제하지 않고 delete-after-effect crash는 unknown으로 보존한다', async (t) => {
  await t.test('invalid retained', async () => {
    const room = await mkdtemp(join(tmpdir(), 't5-library-stale-invalid-')); const currentEvents = [{ sequence: 2 }];
    try {
      const root = join(room, 'library'); await mkdir(root);
      const invalid = await makeGeneration(root, { events: [{ sequence: 1 }] });
      await writeFile(join(invalid.directory, 'index.html'), 'tampered');
      const registry = new LivingLibraryRegistry({ outputRoot: root,
        memoryLedger: { read: async () => ({ events: currentEvents }) } });
      const result = await registry.purgeStale();
      assert.equal(result.state, 'retained');
      assert.deepEqual(result.retainedGenerations,
        [{ generationId: invalid.generationId, reason: 'library_generation_invalid' }]);
      assert.equal((await lstat(invalid.directory)).isDirectory(), true);
    } finally { await rm(room, { recursive: true, force: true }); }
  });
  await t.test('delete settlement unknown', async () => {
    const room = await mkdtemp(join(tmpdir(), 't5-library-stale-crash-')); const currentEvents = [{ sequence: 2 }];
    try {
      const root = join(room, 'library'); await mkdir(root);
      const stale = await makeGeneration(root, { events: [{ sequence: 1 }] });
      const registry = new LivingLibraryRegistry({ outputRoot: root,
        memoryLedger: { read: async () => ({ events: currentEvents }) },
        removeGeneration: async (path) => { await rm(path, { recursive: true }); throw new Error('crash'); } });
      const result = await registry.purgeStale();
      assert.equal(result.state, 'unknown'); assert.deepEqual(result.unknownGenerationIds, [stale.generationId]);
    } finally { await rm(room, { recursive: true, force: true }); }
  });
});

test('forget adapter는 preview·settle·probe를 제공하고 삭제 오류와 crash-after-effect를 정직하게 구분한다', async (t) => {
  await t.test('success', async () => {
    const room = await mkdtemp(join(tmpdir(), 't5-library-adapter-')); const events = [{ sequence: 1 }];
    try {
      const root = join(room, 'library'); await mkdir(root); await makeGeneration(root, { events });
      const registry = new LivingLibraryRegistry({ outputRoot: root, memoryLedger: { read: async () => ({ events }) } });
      const adapter = registry.forgetAdapter(); const target = await adapter.preview({ memoryId: 'memory-a' });
      assert.match(target.id, /^[a-f0-9]{64}$/u); assert.equal(await adapter.probe({ target }), 1);
      assert.deepEqual(await adapter.settle({ target }), { state: 'executed' });
      assert.equal(await adapter.probe({ target }), 0);
    } finally { await rm(room, { recursive: true, force: true }); }
  });
  await t.test('delete retained', async () => {
    const room = await mkdtemp(join(tmpdir(), 't5-library-retained-')); const events = [{ sequence: 1 }];
    try {
      const root = join(room, 'library'); await mkdir(root); await makeGeneration(root, { events });
      const registry = new LivingLibraryRegistry({ outputRoot: root, memoryLedger: { read: async () => ({ events }) },
        removeGeneration: async () => { throw new Error('denied'); } });
      const adapter = registry.forgetAdapter(); const target = await adapter.preview({ memoryId: 'memory-a' });
      assert.deepEqual(await adapter.settle({ target }),
        { state: 'retained', reason: 'library_generation_delete_failed' });
    } finally { await rm(room, { recursive: true, force: true }); }
  });
  await t.test('crash after delete unknown', async () => {
    const room = await mkdtemp(join(tmpdir(), 't5-library-unknown-')); const events = [{ sequence: 1 }];
    try {
      const root = join(room, 'library'); await mkdir(root); await makeGeneration(root, { events });
      const registry = new LivingLibraryRegistry({ outputRoot: root, memoryLedger: { read: async () => ({ events }) },
        removeGeneration: async (path) => { await rm(path, { recursive: true }); throw new Error('crash'); } });
      const adapter = registry.forgetAdapter(); const target = await adapter.preview({ memoryId: 'memory-a' });
      assert.deepEqual(await adapter.settle({ target }),
        { state: 'unknown', reason: 'library_delete_settlement_unknown' });
    } finally { await rm(room, { recursive: true, force: true }); }
  });
  await t.test('unsafe registry stays accounted as unknown without deleting outside', async () => {
    const room = await mkdtemp(join(tmpdir(), 't5-library-unsafe-adapter-'));
    try {
      const outside = join(room, 'outside'); await mkdir(outside); await writeFile(join(outside, 'keep.md'), 'keep');
      const linked = join(room, 'linked'); await symlink(outside, linked);
      const registry = new LivingLibraryRegistry({ outputRoot: linked,
        memoryLedger: { read: async () => ({ events: [] }) } });
      const adapter = registry.forgetAdapter(); const target = await adapter.preview({ memoryId: 'memory-a' });
      assert.deepEqual(await adapter.settle({ target }),
        { state: 'unknown', reason: 'library_registry_read_failed' });
      assert.equal(await adapter.probe({ target }), null);
      assert.equal(await readFile(join(outside, 'keep.md'), 'utf8'), 'keep');
    } finally { await rm(room, { recursive: true, force: true }); }
  });
});
