import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { generateLivingLibrary } from '../src/living-library.js';

const state = {
  events: [{ schema: 't5.memory-event.v1', sequence: 1, type: 'memory_started' }],
  claims: [
    { memoryId: 'current', kind: 'preference', subjectKey: 'coffee', value: 'light <script>alert(1)</script>',
      scope: { global: true, workId: null, projectId: null, personId: 'owner', organizationId: null },
      sources: [{ recordId: 'rr-current', sourceKind: 'conversation_message', coverage: 'full', availability: 'available' }],
      recordedAt: '2026-08-27T00:00:00.000Z', validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2027-01-01T00:00:00.000Z', subjectRevision: 2, sourceOrder: 3,
      status: 'active', supersedes: ['old'], conflictsWith: [], sensitivity: 'personal', alwaysRelevant: false },
    { memoryId: 'old', kind: 'preference', subjectKey: 'coffee', value: 'dark roast',
      scope: { global: true, workId: null, projectId: null, personId: 'owner', organizationId: null },
      sources: [{ recordId: 'rr-old', sourceKind: 'conversation_message', coverage: 'full', availability: 'available' }],
      recordedAt: '2025-01-01T00:00:00.000Z', validFrom: '2025-01-01T00:00:00.000Z',
      validTo: '2026-01-01T00:00:00.000Z', subjectRevision: 1, sourceOrder: 2,
      status: 'superseded', supersedes: [], conflictsWith: [], sensitivity: 'personal', alwaysRelevant: false },
  ],
  tombstones: [],
};

test('Living Library는 canonical state에서 static HTML·Markdown·manifest를 0600으로 생성한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-living-library-'));
  try {
    const before = structuredClone(state);
    const result = await generateLivingLibrary({ state, outputRoot: join(room, 'library'),
      generatedAt: '2026-08-27T01:00:00.000Z' });
    assert.equal(result.manifest.schema, 't5.living-library-manifest.v1');
    assert.equal(result.manifest.canonical, false);
    assert.equal(result.manifest.claims, 2);
    assert.deepEqual(state, before);
    for (const file of ['index.html', 'memory.md', 'manifest.json']) {
      assert.equal((await lstat(join(result.directory, file))).mode & 0o777, 0o600);
    }
    assert.match(result.manifest.files['index.html'].sha256, /^[a-f0-9]{64}$/u);
    assert.match(result.manifest.files['memory.md'].sha256, /^[a-f0-9]{64}$/u);
    assert.match(result.manifest.manifestPayloadSha256, /^[a-f0-9]{64}$/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('HTML은 memory content를 실행하지 않고 current·historical·source pointer를 사람이 읽게 한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-living-library-html-'));
  try {
    const result = await generateLivingLibrary({ state, outputRoot: join(room, 'library'),
      generatedAt: '2026-08-27T01:00:00.000Z' });
    const html = await readFile(join(result.directory, 'index.html'), 'utf8');
    assert.match(html, /현재 기억/u); assert.match(html, /과거·철회 기록/u);
    assert.match(html, /rr-current/u); assert.match(html, /rr-old/u);
    assert.doesNotMatch(html, /<script>alert/u);
    assert.match(html, /&lt;script&gt;alert/u);
    assert.doesNotMatch(html, /<script|https?:\/\/|onerror=/iu);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('생성 view 삭제 후 같은 canonical·clock에서 exact rebuild되고 Obsidian은 필요 없다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-living-library-rebuild-'));
  const outputRoot = join(room, 'library');
  try {
    const first = await generateLivingLibrary({ state, outputRoot,
      generatedAt: '2026-08-27T01:00:00.000Z' });
    const firstManifest = structuredClone(first.manifest);
    await rm(first.directory, { recursive: true, force: true });
    const second = await generateLivingLibrary({ state, outputRoot,
      generatedAt: '2026-08-27T01:00:00.000Z' });
    assert.deepEqual(second.manifest, firstManifest);
    assert.equal(second.manifest.requiresObsidian, false);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('output root 경로에 symlink가 끼면 관리 범위 밖 view를 쓰지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-living-library-link-'));
  try {
    const outside = await mkdtemp(join(tmpdir(), 't5-living-library-outside-'));
    const linked = join(room, 'linked'); await symlink(outside, linked);
    await assert.rejects(generateLivingLibrary({ state, outputRoot: linked,
      generatedAt: '2026-08-27T01:00:00.000Z' }), /symbolic link/u);
    await rm(outside, { recursive: true, force: true });
  } finally { await rm(room, { recursive: true, force: true }); }
});
