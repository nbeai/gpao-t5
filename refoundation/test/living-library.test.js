import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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

test('HTML은 content를 실행하지 않고 내부 ID 대신 출처 availability만 사람이 읽게 한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-living-library-html-'));
  try {
    const result = await generateLivingLibrary({ state, outputRoot: join(room, 'library'),
      generatedAt: '2026-08-27T01:00:00.000Z' });
    const html = await readFile(join(result.directory, 'index.html'), 'utf8');
    assert.match(html, /현재 기억/u); assert.match(html, /과거·철회 기록/u);
    assert.match(html, /출처 1개를 모두 확인할 수 있습니다/u);
    assert.match(html, /href="timeline\.html">시간의 흐름/u);
    assert.match(html, /href="projects\.html">프로젝트/u);
    assert.match(html, /href="decisions\.html">결정/u);
    assert.match(html, /href="research\.html">연구/u);
    assert.doesNotMatch(html, /coffee|rr-current|rr-old|current|old/u);
    assert.doesNotMatch(html, /<script>alert/u);
    assert.match(html, /&lt;script&gt;alert/u);
    assert.doesNotMatch(html, /<script|https?:\/\/|onerror=/iu);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('기본 Markdown은 내부 ID나 스크립트 없이 네 가지 기록 보기의 상대 링크를 제공한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-living-library-navigation-'));
  try {
    const result = await generateLivingLibrary({ state, outputRoot: join(room, 'library'),
      generatedAt: '2026-08-27T01:00:00.000Z' });
    const markdown = await readFile(join(result.directory, 'memory.md'), 'utf8');
    for (const [label, path] of [['시간의 흐름', 'timeline.md'], ['프로젝트', 'projects.md'],
      ['결정', 'decisions.md'], ['연구', 'research.md']]) {
      assert.ok(markdown.includes(`[${label}](${path})`));
    }
    assert.doesNotMatch(markdown, /coffee|rr-current|rr-old|javascript:/iu);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('Timeline·Projects·Decisions·Research를 HTML과 Markdown으로 명시적으로 투영한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-living-library-views-'));
  try {
    const viewState = structuredClone(state);
    viewState.claims[0].scope = { ...viewState.claims[0].scope, workId: 'work-internal-17' };
    viewState.claims[0].kind = 'decision';
    viewState.knowledgeClaims = [{ knowledgeId: 'knowledge-internal-4', statement: '검증된 연구 결론',
      sources: [{ recordId: 'research-record-internal', availability: 'available' }] }];
    const result = await generateLivingLibrary({ state: viewState, outputRoot: join(room, 'library'),
      generatedAt: '2026-08-27T01:00:00.000Z' });
    const expectations = { timeline: 'light', projects: 'light', decisions: 'light', research: '검증된 연구 결론' };
    for (const [view, visible] of Object.entries(expectations)) {
      for (const extension of ['html', 'md']) {
        const text = await readFile(join(result.directory, `${view}.${extension}`), 'utf8');
        assert.match(text, new RegExp(visible, 'u'));
        assert.doesNotMatch(text, /coffee|rr-current|rr-old|work-internal-17|knowledge-internal-4|research-record-internal/u);
      }
    }
    assert.deepEqual(result.manifest.viewCounts, { timeline: 2, projects: 1, decisions: 1, research: 1 });
    assert.equal(result.manifest.knowledgeClaimsProjected, 1);
    assert.equal(result.manifest.memoryHandles.length, 2);
    assert.ok(result.manifest.memoryHandles.every((handle) => /^[a-f0-9]{64}$/u.test(handle)));
    assert.doesNotMatch(JSON.stringify(result.manifest), /"memoryId"|"current"|"old"/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('Research는 knowledgeClaims 배열만 사용하고 일반 기억 문자열을 추론 분류하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-living-library-research-boundary-'));
  try {
    const viewState = structuredClone(state);
    viewState.claims[0].value = 'research 연구 조사 논문이라는 문자열';
    const result = await generateLivingLibrary({ state: viewState, outputRoot: join(room, 'library'),
      generatedAt: '2026-08-27T01:00:00.000Z' });
    const html = await readFile(join(result.directory, 'research.html'), 'utf8');
    const markdown = await readFile(join(result.directory, 'research.md'), 'utf8');
    assert.match(html, /없음/u); assert.match(markdown, /없음/u);
    assert.doesNotMatch(html, /research 연구 조사 논문이라는 문자열/u);
    assert.equal(result.manifest.knowledgeClaimsProjected, 0);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('active tombstone의 retracted claim은 값·출처 없이 forget marker만 투영한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-living-library-forgotten-'));
  try {
    const forgotten = structuredClone(state);
    forgotten.claims[1].status = 'retracted';
    forgotten.tombstones = [{ requestId: 'forget-internal', memoryId: 'old', subjectKey: 'coffee' }];
    const result = await generateLivingLibrary({ state: forgotten, outputRoot: join(room, 'library'),
      generatedAt: '2026-08-27T01:00:00.000Z' });
    for (const name of ['index.html', 'memory.md', 'timeline.html', 'timeline.md']) {
      const text = await readFile(join(result.directory, name), 'utf8');
      assert.match(text, /사용자의 요청으로 잊었습니다/u);
      assert.doesNotMatch(text, /dark roast|rr-old|forget-internal|coffee/u);
    }
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('같은 generation의 어떤 view라도 외부 수정되면 재사용하지 않고 충돌한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-living-library-integrity-'));
  const outputRoot = join(room, 'library');
  try {
    const first = await generateLivingLibrary({ state, outputRoot,
      generatedAt: '2026-08-27T01:00:00.000Z' });
    await writeFile(join(first.directory, 'projects.md'), '# 외부 수정\n', 'utf8');
    await assert.rejects(generateLivingLibrary({ state, outputRoot,
      generatedAt: '2026-08-27T01:00:00.000Z' }), /generation conflict/u);
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
