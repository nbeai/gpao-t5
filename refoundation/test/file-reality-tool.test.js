import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runAgent } from '../src/agent-loop.js';
import { makeFileRealityTool } from '../src/file-reality-tool.js';
import { FileSourceManifestStore } from '../src/file-source-manifest-store.js';
import { deferTools, makeToolSearchTool } from '../src/tool-search.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 't5-file-reality-'));
  const workspace = join(root, 'workspace'); const elsewhere = join(root, 'elsewhere'); const protectedRoot = join(root, '.ssh');
  await Promise.all([mkdir(workspace), mkdir(elsewhere), mkdir(protectedRoot)]);
  const target = join(elsewhere, '무작위문서.txt');
  const a = join(workspace, '새봄_견적서_v1.txt'); const b = join(workspace, '새봄 견적서 복사.txt');
  const c = join(workspace, '새봄-견적서-수정.txt');
  await Promise.all([
    writeFile(target, '새봄상사 제안 금액 3000000원\n파란 표가 있는 자료\n'),
    writeFile(a, '새봄상사 견적 금액 3000000원\n배송비 미확인\n'),
    writeFile(b, '새봄상사 견적 금액 3000000원\n배송비 미확인\n'),
    writeFile(c, '새봄상사 견적 금액 3200000원\n배송비 포함\n'),
    writeFile(join(protectedRoot, '새봄상사-비밀.txt'), '새봄상사 3000000'),
  ]);
  return { root, workspace, elsewhere, protectedRoot, target, a, b, c };
}

test('파일을 찾아 보여 달라는 목적은 경로 출력이 아니라 exact deliver로 끝낸다', () => {
  const tool = makeFileRealityTool({ workspace: '/private/tmp', home: '/private/tmp', platform: 'test' });
  assert.match(tool.description, /find and show, give, open/u);
  assert.match(tool.description, /call deliver once for every exact selected non-image file/u);
  assert.match(tool.description, /do not finish with printed paths alone/u);
});

test('컴퓨터 scope는 위치·파일명을 몰라도 내용 단서로 workspace 밖 실제 파일을 찾는다', async () => {
  const room = await fixture();
  try {
    const tool = makeFileRealityTool({ workspace: room.workspace, home: room.root,
      platform: 'test', computerRoots: [room.root], protectedRoots: [room.protectedRoot],
      indexSearch: async ({ query }) => query.includes('파란')
        ? [room.target, join(room.protectedRoot, '새봄상사-비밀.txt'), '/outside/injected.txt'] : [],
    });
    const workspaceOnly = await tool.execute({ action: 'search', query: '파란 표 3000000',
      scope: 'workspace', path: null, handles: null, maxCandidates: 10 });
    assert.equal(workspaceOnly.candidates.some((item) => item.displayName === '무작위문서.txt'), false);
    const whole = await tool.execute({ action: 'search', query: '새봄상사 파란 표 3000000',
      scope: 'computer', path: null, handles: null, maxCandidates: 10 });
    const found = whole.candidates.find((item) => item.displayName === '무작위문서.txt');
    assert.ok(found); assert.equal(whole.contentIncluded, false);
    assert.equal(whole.candidates.some((item) => /비밀/u.test(item.displayName)), false);
    assert.equal(whole.candidates.some((item) => /injected/u.test(item.displayName)), false);
    const inspected = await tool.execute({ action: 'inspect', query: null, scope: null, path: null,
      handles: [found.handle], maxCandidates: null });
    assert.match(inspected.content, /새봄상사 제안 금액 3000000원/u);
    assert.doesNotMatch(JSON.stringify(whole), /새봄상사 제안 금액/u);
  } finally { await rm(room.root, { recursive: true, force: true }); }
});

test('사용자 가시 동기화 root의 Unicode 파일명 일치는 content mention보다 먼저 보인다', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 't5-file-sync-title-')));
  const workspace = join(root, 'workspace'); const sync = join(root, 'iCloud Drive');
  const standard = join(root, 'Documents'); await Promise.all([mkdir(workspace), mkdir(sync), mkdir(standard)]);
  await writeFile(join(sync, '250403_권혁수님_코칭.txt'), '코칭 기록');
  await writeFile(join(standard, '설문모음.txt'), '34번 권혁수 사장님 응답');
  try {
    const tool = makeFileRealityTool({ workspace, home: root, platform: 'test',
      computerRoots: [sync, standard], indexSearch: async () => [] });
    assert.equal(tool.completionProposalOptional({ action: 'search' }), true);
    assert.equal(tool.completionProposalOptional({ action: 'apply' }), false);
    const result = await tool.execute({ action: 'search', query: '권혁수', scope: 'computer', path: null,
      handles: null, maxCandidates: 10 });
    assert.match(result.candidates[0].displayName.normalize('NFC'), /권혁수/u);
    assert.deepEqual(result.candidates[0].evidence.matchedNameTerms, ['권혁수']);
    assert.deepEqual(result.candidates[1].evidence.matchedContentTerms, ['권혁수']);
    assert.equal(result.coverage.filenameScope, 'complete');
    assert.equal(result.coverage.contentScope, 'complete');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('모호한 검색의 exact handle은 사용자가 파일 전달을 요청했을 때만 기존 Artifact로 등록된다', async () => {
  const room = await fixture(); const registered = [];
  try {
    const tool = makeFileRealityTool({ workspace: room.workspace, home: room.root,
      sessionId: 'session-organize',
      platform: 'test', computerRoots: [room.root], protectedRoots: [room.protectedRoot],
      indexSearch: async () => [room.target],
      registerSelectedFile: async (facts) => { registered.push(facts); return {
        attachmentId: 'selected-file-1', originalName: '무작위문서.txt', bytes: 67,
      }; },
    });
    const found = await tool.execute({ action: 'search', query: '새봄상사 파란 표 3000000',
      scope: 'computer', path: null, handles: null, maxCandidates: 10 });
    assert.equal(registered.length, 0, 'search and inspect do not imply delivery');
    const delivered = await tool.execute({ action: 'deliver', query: null, scope: null, path: null,
      handles: [found.candidates[0].handle], maxCandidates: null });
    assert.equal(delivered.state, 'delivered');
    assert.equal(delivered.artifact.attachmentId, 'selected-file-1');
    assert.equal(delivered.delivery.state, 'registered_selected_file');
    assert.equal(registered.length, 1); assert.equal(registered[0].path, await realpath(room.target));
    assert.match(registered[0].sha256, /^[0-9a-f]{64}$/u);
  } finally { await rm(room.root, { recursive: true, force: true }); }
});

test('한국어·영어 최신 문서 요청은 내용 없이 표준 폴더의 같은 종류 후보를 최신순으로 제공한다', async () => {
  const room = await fixture(); const downloads = join(room.root, 'Downloads');
  const newestReport = join(downloads, '현장지원팀_주간보고.pdf');
  const olderReport = join(downloads, 'delivery_strategy_report.pdf');
  const unrelated = join(downloads, '오늘메모.txt');
  try {
    await mkdir(downloads);
    await Promise.all([writeFile(newestReport, 'private report body'), writeFile(olderReport, 'older report body'),
      writeFile(unrelated, 'newest but unrelated body')]);
    // Future mtimes make the ordering deterministic even on filesystems whose birthtime cannot be set in a fixture.
    await utimes(olderReport, new Date('2030-08-20T00:00:00Z'), new Date('2030-08-20T00:00:00Z'));
    await utimes(newestReport, new Date('2030-08-21T00:00:00Z'), new Date('2030-08-21T00:00:00Z'));
    await utimes(unrelated, new Date('2030-08-22T00:00:00Z'), new Date('2030-08-22T00:00:00Z'));
    const tool = makeFileRealityTool({ workspace: room.workspace, home: room.root,
      platform: 'test', computerRoots: [room.root], indexSearch: async () => [] });
    for (const query of ['latest report', '가장 최근 외부 보고서']) {
      const result = await tool.execute({ action: 'search', query, scope: 'computer', path: null,
        handles: null, maxCandidates: 5, placements: null, planId: null, effect: null,
        sourceUses: null, purpose: null, unknowns: null, standardization: null });
      assert.equal(result.recentDocumentCandidates[0].displayName, '현장지원팀_주간보고.pdf');
      assert.deepEqual(result.recentDocumentCandidates[0].kindMatches, ['report']);
      assert.equal(result.recentDocumentCandidates[0].locationClass, 'downloads');
      assert.equal(result.contentIncluded, false);
      assert.ok(result.recentDocumentCandidates.length <= 20);
      assert.doesNotMatch(JSON.stringify(result.recentDocumentCandidates), /private report body|older report body/u);
    }
  } finally { await rm(room.root, { recursive: true, force: true }); }
});

test('일반 사진 검색은 사진 보관함 패키지 내부를 직접 순회하거나 Spotlight 후보로 받지 않는다', async () => {
  const room = await fixture();
  const pictures = join(room.root, 'Pictures');
  const library = join(pictures, 'Photos Library.photoslibrary');
  const privatePhoto = join(library, 'originals', 'private.jpg');
  const visiblePhoto = join(pictures, '견적사진.jpg');
  await mkdir(join(library, 'originals'), { recursive: true });
  await Promise.all([writeFile(privatePhoto, 'private photo'), writeFile(visiblePhoto, 'visible photo')]);
  try {
    const tool = makeFileRealityTool({ workspace: room.workspace, home: room.root, platform: 'darwin',
      computerRoots: [pictures], indexSearch: async () => [privatePhoto, visiblePhoto] });
    const found = await tool.execute({ action: 'search', query: '견적사진', scope: 'computer', path: null,
      handles: null, maxCandidates: 10 });
    assert.equal(found.candidates.some((item) => item.displayName === 'private.jpg'), false);
    assert.equal(found.candidates.some((item) => item.displayName === '견적사진.jpg'), true);
  } finally { await rm(room.root, { recursive: true, force: true }); }
});

test('중복·버전 비교는 exact bytes와 유사도 근거만 주고 최종본을 파일명으로 결정하지 않는다', async () => {
  const room = await fixture();
  try {
    const tool = makeFileRealityTool({ workspace: room.workspace, home: room.root,
      platform: 'test', computerRoots: [room.root], indexSearch: async () => [room.a, room.b, room.c] });
    const found = await tool.execute({ action: 'search', query: '새봄 견적 3000000',
      scope: 'workspace', path: null, handles: null, maxCandidates: 10 });
    const selected = ['새봄_견적서_v1.txt', '새봄 견적서 복사.txt', '새봄-견적서-수정.txt']
      .map((name) => found.candidates.find((item) => item.displayName === name)?.handle);
    assert.equal(selected.every(Boolean), true);
    const compared = await tool.execute({ action: 'compare', query: null, scope: null, path: null,
      handles: selected, maxCandidates: null });
    assert.equal(compared.comparisons.some((item) => item.exactDuplicate), true);
    assert.equal(compared.comparisons.some((item) => item.contentSimilarity != null && !item.exactDuplicate), true);
    assert.equal(compared.finalVersionSelected, false);
  } finally { await rm(room.root, { recursive: true, force: true }); }
});

test('검색 뒤 파일이 바뀌면 opaque handle은 오래된 내용을 다시 열지 않는다', async () => {
  const room = await fixture();
  try {
    const tool = makeFileRealityTool({ workspace: room.workspace, home: room.root,
      platform: 'test', computerRoots: [room.root], indexSearch: async () => [room.target] });
    const found = await tool.execute({ action: 'search', query: '파란 표', scope: 'computer', path: null,
      handles: null, maxCandidates: 5 });
    await new Promise((resolve) => setTimeout(resolve, 5)); await writeFile(room.target, 'changed');
    await assert.rejects(() => tool.execute({ action: 'inspect', query: null, scope: null, path: null,
      handles: [found.candidates[0].handle], maxCandidates: null }), { code: 'T5_FILE_CHANGED' });
  } finally { await rm(room.root, { recursive: true, force: true }); }
});

test('격리 자격에서는 path scope도 qualified computer root 밖으로 나가지 않는다', async () => {
  const room = await fixture();
  try {
    const tool = makeFileRealityTool({ workspace: room.workspace, home: room.root, platform: 'test',
      computerRoots: [room.elsewhere], enforceComputerRoots: true, indexSearch: async () => [] });
    await assert.rejects(tool.execute({ action: 'search', query: '새봄', scope: 'path', path: room.workspace,
      handles: null, maxCandidates: 5, placements: null, planId: null, effect: null, sourceUses: null,
      purpose: null, unknowns: null, standardization: null }), /outside the qualified computer scope/u);
    const allowed = await tool.execute({ action: 'search', query: '파란 표', scope: 'path', path: room.elsewhere,
      handles: null, maxCandidates: 5, placements: null, planId: null, effect: null, sourceUses: null,
      purpose: null, unknowns: null, standardization: null });
    assert.equal(allowed.candidates[0].displayName, '무작위문서.txt');
  } finally { await rm(room.root, { recursive: true, force: true }); }
});

test('정리 plan은 목적지 충돌을 먼저 보여주고 어떤 파일도 바꾸지 않는다', async () => {
  const room = await fixture();
  try {
    const ready = join(room.root, '분류완료'); const collision = join(room.root, '충돌폴더');
    await Promise.all([mkdir(ready), mkdir(collision)]);
    await writeFile(join(collision, '새봄_견적서_v1.txt'), '이미 존재하는 다른 파일');
    const tool = makeFileRealityTool({ workspace: room.workspace, home: room.root,
      platform: 'test', computerRoots: [room.root], protectedRoots: [room.protectedRoot],
      indexSearch: async () => [room.a, room.c] });
    const found = await tool.execute({ action: 'search', query: '새봄 견적', scope: 'workspace', path: null,
      handles: null, maxCandidates: 10, placements: null });
    const first = found.candidates.find((item) => item.displayName === '새봄_견적서_v1.txt');
    const revised = found.candidates.find((item) => item.displayName === '새봄-견적서-수정.txt');
    const plan = await tool.execute({ action: 'plan', query: null, scope: null, path: null, handles: null,
      maxCandidates: null, placements: [
        { handle: revised.handle, destinationDirectory: ready },
        { handle: first.handle, destinationDirectory: collision },
      ] });
    assert.equal(plan.readyToApply, false); assert.equal(plan.filesChanged, 0);
    assert.deepEqual(plan.changes.map((item) => item.state), ['ready', 'collision']);
    assert.match(plan.note, /no file was moved/u);
    const effect = { kind: 'local_change', reversible: true, backupAvailable: true };
    await assert.rejects(tool.execute({ action: 'apply', query: null, scope: null, path: null, handles: null,
      maxCandidates: null, placements: null, planId: plan.planId, effect }), /destination collision/u);
    assert.match(await readFile(room.a, 'utf8'), /3000000/u);
    assert.match(await readFile(room.c, 'utf8'), /3200000/u);
    await assert.rejects(stat(join(ready, '새봄-견적서-수정.txt')), { code: 'ENOENT' });
  } finally { await rm(room.root, { recursive: true, force: true }); }
});

test('ready plan만 원자 이동하고 exact plan rollback이 원래 위치를 복원한다', async () => {
  const room = await fixture();
  try {
    const destination = join(room.root, '정리함'); const plans = join(room.root, 't5-state', 'plans');
    await mkdir(destination);
    const tool = makeFileRealityTool({ workspace: room.workspace, home: room.root,
      platform: 'test', computerRoots: [room.root], protectedRoots: [join(room.root, 't5-state')],
      organizationRoot: plans, indexSearch: async () => [room.c] });
    const found = await tool.execute({ action: 'search', query: '새봄 수정 3200000', scope: 'workspace', path: null,
      handles: null, maxCandidates: 5, placements: null, planId: null, effect: null });
    const selected = found.candidates.find((item) => item.displayName === '새봄-견적서-수정.txt');
    const plan = await tool.execute({ action: 'plan', query: null, scope: null, path: null, handles: null,
      maxCandidates: null, placements: [{ handle: selected.handle, destinationDirectory: destination }],
      planId: null, effect: null });
    const effect = { kind: 'local_change', reversible: true, backupAvailable: true };
    await rename(room.c, join(destination, '새봄-견적서-수정.txt'));
    const applied = await tool.execute({ action: 'apply', query: null, scope: null, path: null, handles: null,
      maxCandidates: null, placements: null, planId: plan.planId, effect });
    assert.equal(applied.filesMoved, 1); await assert.rejects(stat(room.c), { code: 'ENOENT' });
    assert.match(await readFile(join(destination, '새봄-견적서-수정.txt'), 'utf8'), /3200000/u);
    const restored = await tool.execute({ action: 'rollback', query: null, scope: null, path: null, handles: null,
      maxCandidates: null, placements: null, planId: plan.planId, effect });
    assert.equal(restored.filesRestored, 1); assert.match(await readFile(room.c, 'utf8'), /3200000/u);
    await assert.rejects(stat(join(destination, '새봄-견적서-수정.txt')), { code: 'ENOENT' });
  } finally { await rm(room.root, { recursive: true, force: true }); }
});

test('정리 apply는 요청한 새 목적지 폴더를 만들고 rollback에서 빈 폴더까지 제거한다', async () => {
  const room = await fixture();
  try {
    const plans = join(room.root, 'plans'); const destination = join(room.workspace, '정리 후보');
    const original = await readFile(room.b, 'utf8');
    const tool = makeFileRealityTool({ workspace: room.workspace, home: room.root,
      sessionId: 'session-organize', platform: 'test', computerRoots: [room.elsewhere], protectedRoots: [room.protectedRoot],
      organizationRoot: plans, indexSearch: async () => [room.b] });
    const found = await tool.execute({ action: 'search', query: '새봄 견적 복사', scope: 'workspace',
      path: null, handles: null, maxCandidates: 10, placements: null });
    const selected = found.candidates.find((item) => item.displayName === '새봄 견적서 복사.txt');
    const plan = await tool.execute({ action: 'plan', query: null, scope: null, path: null,
      handles: null, maxCandidates: null,
      placements: [{ handle: selected.handle, destinationDirectory: destination }] });
    assert.equal(plan.readyToApply, true); await assert.rejects(() => stat(destination));
    const effect = { kind: 'local_change', reversible: true, backupAvailable: true };
    const applied = await tool.execute({ action: 'apply', planId: plan.planId, effect });
    assert.equal(applied.filesMoved, 1);
    assert.equal(await readFile(join(destination, '새봄 견적서 복사.txt'), 'utf8'), original);
    await assert.rejects(() => stat(room.b));
    const restarted = makeFileRealityTool({ workspace: room.workspace, home: room.root,
      sessionId: 'session-organize', platform: 'test', computerRoots: [room.elsewhere],
      protectedRoots: [room.protectedRoot], organizationRoot: plans, indexSearch: async () => [] });
    const rolledBack = await restarted.execute({ action: 'rollback', planId: null, effect });
    assert.equal(rolledBack.filesRestored, 1);
    assert.equal((await stat(room.b)).isFile(), true);
    await assert.rejects(() => stat(destination));
  } finally { await rm(room.root, { recursive: true, force: true }); }
});

test('선택한 exact handle만 runtime-owned 취합 원본 manifest로 결속한다', async () => {
  const room = await fixture();
  try {
    const manifests = new FileSourceManifestStore(join(room.root, 't5-state', 'source-manifests'));
    let preparedManifest = null;
    const tool = makeFileRealityTool({ workspace: room.workspace, home: room.root, platform: 'test',
      computerRoots: [room.root], protectedRoots: [join(room.root, 't5-state')], sourceManifestStore: manifests,
      sessionId: '11111111-1111-4111-8111-111111111111', indexSearch: async () => [room.a, room.c],
      onSourcesBound: async (manifest) => { preparedManifest = manifest.manifestId; return {
        state: 'ready', activatedTools: ['integral_method'], integralMethod: {
          sourceManifestId: manifest.manifestId, sourceCount: manifest.sources.length,
          sourcePacket: 'bounded synthetic packet',
        } } } });
    const found = await tool.execute({ action: 'search', query: '새봄 견적', scope: 'workspace', path: null,
      handles: null, maxCandidates: 10, placements: null, planId: null, effect: null, sourceUses: null,
      purpose: null, unknowns: null });
    const first = found.candidates.find((item) => item.displayName === '새봄_견적서_v1.txt');
    const bound = await tool.execute({ action: 'bind_sources', query: null, scope: null, path: null,
      handles: null, maxCandidates: null, placements: null, planId: null, effect: null,
      sourceUses: [{ handle: first.handle, usage: '기존 견적 금액 원문' }],
      purpose: '수정 견적서 작성', unknowns: ['배송비 확정 전'] });
    assert.equal(bound.state, 'bound'); assert.equal(bound.sources.length, 1);
    assert.equal(preparedManifest, bound.manifestId);
    assert.deepEqual(bound.activatedTools, ['integral_method']);
    assert.equal(bound.integralMethod.sourcePacket, 'bounded synthetic packet');
    assert.deepEqual(bound.unknowns, ['배송비 확정 전']);
    assert.doesNotMatch(JSON.stringify(bound), new RegExp(room.a.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  } finally { await rm(room.root, { recursive: true, force: true }); }
});

test('inspect는 서로 다른 exact handle을 한 bounded 호출에서 관측하고 단일 반환은 보존한다', async () => {
  const room = await fixture();
  try {
    const tool = makeFileRealityTool({ workspace: room.workspace, home: room.root,
      platform: 'test', computerRoots: [room.root], indexSearch: async () => [room.a, room.c] });
    const found = await tool.execute({ action: 'search', query: '새봄 견적', scope: 'workspace', path: null,
      handles: null, maxCandidates: 10, placements: null, planId: null, effect: null,
      sourceUses: null, purpose: null, unknowns: null, standardization: null });
    const selected = found.candidates.filter((item) => ['새봄_견적서_v1.txt', '새봄-견적서-수정.txt']
      .includes(item.displayName));
    const many = await tool.execute({ action: 'inspect', query: null, scope: null, path: null,
      handles: selected.map((item) => item.handle), maxCandidates: null, placements: null,
      planId: null, effect: null, sourceUses: null, purpose: null, unknowns: null, standardization: null });
    assert.equal(many.state, 'observed'); assert.equal(many.files.length, 2);
    assert.equal(many.requiredNextTool, 'file_reality');
    assert.deepEqual(many.coverage, { requested: 2, observed: 2, complete: true });
    assert.ok(many.files.every((item) => typeof item.content === 'string'));
    const one = await tool.execute({ action: 'inspect', query: null, scope: null, path: null,
      handles: [selected[0].handle], maxCandidates: null, placements: null, planId: null,
      effect: null, sourceUses: null, purpose: null, unknowns: null, standardization: null });
    assert.ok(one.file); assert.equal('files' in one, false);
  } finally { await rm(room.root, { recursive: true, force: true }); }
});

test('무의미한 이미지 파일명도 bounded local OCR 단서로 후보가 된다', async () => {
  const room = await fixture(); const image = join(room.elsewhere, 'KakaoTalk_20260827_142233.png'); await writeFile(image, 'image-fixture');
  try {
    let probes = 0; const tool = makeFileRealityTool({ workspace: room.workspace, home: room.root,
      platform: 'darwin', computerRoots: [room.root], indexSearch: async () => [],
      ocrProbe: async (path) => { probes += 1; return path.endsWith('KakaoTalk_20260827_142233.png') ? { state: 'observed', width: 600, height: 800,
        observations: [{ text: '한빛상사 견적 4,780,000', confidence: 0.95 }], text: '한빛상사 견적 4,780,000',
        truncated: false, engine: 'macos-vision-local' } : { state: 'observed', observations: [], text: '' }; } });
    const found = await tool.execute({ action: 'search', query: '한빛상사 478만원', scope: 'computer', path: null,
      handles: null, maxCandidates: 5, placements: null, planId: null, effect: null, sourceUses: null,
      purpose: null, unknowns: null, standardization: null });
    assert.equal(found.candidates[0].displayName, 'KakaoTalk_20260827_142233.png');
    assert.deepEqual(found.candidates[0].evidence.matchedOcrTerms.sort(), ['4780000', '한빛상사'].sort());
    assert.equal(found.candidates[0].evidence.ocrExcerpt, '한빛상사 견적 4,780,000');
    assert.equal(found.candidates[0].evidence.ocrMinimumConfidence, 0.95);
    assert.equal(found.contentIncluded, false); assert.ok(probes <= 12); assert.equal(found.coverage.ocrProbes, probes);
  } finally { await rm(room.root, { recursive: true, force: true }); }
});

test('선택한 이미지 후보만 contact sheet로 모델에 한 번 공급하고 receipt에는 base64를 남기지 않는다', async () => {
  const room = await fixture(); const one = join(room.elsewhere, 'a.png'); const two = join(room.elsewhere, 'b.jpg');
  await Promise.all([writeFile(one, 'a'), writeFile(two, 'b')]);
  try {
    const registered = []; const visualized = [];
    const tool = makeFileRealityTool({ workspace: room.workspace, home: room.root, platform: 'test', computerRoots: [room.root],
      indexSearch: async () => [one, two], contactSheetBuilder: async (items) => ({ png: Buffer.from('sheet'), width: 720,
        height: 272, labels: items.map((_, index) => `C${index + 1}`) }),
      registerSelectedImage: async (facts) => { registered.push(facts); return {
        attachmentId: 'artifact-selected-image', originalName: facts.displayName,
        bytes: 1, sha256: facts.sha256, mimeType: 'image/jpeg', direction: 'output',
      }; }, onVisualCandidatesObserved: async (items) => visualized.push(...items) });
    const found = await tool.execute({ action: 'image_candidates', query: null, scope: 'path', path: room.elsewhere, handles: null,
      maxCandidates: 10, placements: null, planId: null, effect: null, sourceUses: null, purpose: null,
      unknowns: null, standardization: null });
    const images = found.candidates.filter((item) => ['a.png', 'b.jpg'].includes(item.displayName));
    const result = await tool.execute({ action: 'visual_candidates', query: null, scope: null, path: null,
      handles: images.map((item) => item.handle), maxCandidates: null, placements: null, planId: null,
      effect: null, sourceUses: null, purpose: null, unknowns: null, standardization: null });
    assert.deepEqual(result.candidates.map((item) => item.visualRef), ['C1', 'C2']);
    assert.equal(result.verificationMissing, true);
    assert.equal(result.requiredEvidence, 'selected_visual_exact_reopen');
    assert.deepEqual(visualized.map((item) => item.displayName), ['a.png', 'b.jpg']);
    assert.equal(result._modelAttachments.length, 1); assert.match(result._modelAttachments[0].image_url, /^data:image\/png;base64,/u);
    const inspected = await tool.execute({ action: 'inspect', query: null, scope: null, path: null,
      handles: [images[1].handle], maxCandidates: null, placements: null, planId: null,
      effect: null, sourceUses: null, purpose: null, unknowns: null, standardization: null });
    assert.equal(registered.length, 1); assert.equal(inspected.artifact.attachmentId, 'artifact-selected-image');
    assert.equal(inspected.delivery.state, 'registered_selected_visual');
    const tools = [tool]; let calls = 0;
    const run = await runAgent({ request: '사진 후보 보여줘', tools, model: { async respond(input) { calls += 1;
      if (calls === 1) return { text: '', toolCalls: [{ id: 'visual', name: 'file_reality', args: { action: 'visual_candidates',
        query: null, scope: null, path: null, handles: images.map((item) => item.handle), maxCandidates: null,
        placements: null, planId: null, effect: null, sourceUses: null, purpose: null, unknowns: null, standardization: null } }] };
      assert.equal(input.messages.at(-1).modelAttachments.length, 1); return { text: 'C1을 선택했습니다.', toolCalls: [] }; } } });
    assert.equal(run.answer, 'C1을 선택했습니다.'); assert.doesNotMatch(JSON.stringify(run.receipts), /base64|c2hlZXQ=/u);
  } finally { await rm(room.root, { recursive: true, force: true }); }
});

test('on-demand tool search 뒤 파일 후보→exact reopen을 한 Run에서 사용한다', async () => {
  const room = await fixture();
  try {
    const reality = makeFileRealityTool({ workspace: room.workspace, home: room.root,
      platform: 'test', computerRoots: [room.root], indexSearch: async () => [room.target] });
    const tools = deferTools([reality], { coreNames: [] });
    tools.unshift(makeToolSearchTool({ tools: [reality] }));
    let turn = 0;
    const model = { async respond({ tools: visible, messages, toolChoice }) {
      turn += 1;
      if (turn === 1) {
        assert.deepEqual(visible.map((item) => item.name), ['tool_search']);
        return { text: '', toolCalls: [{ id: 'discover', name: 'tool_search',
          args: { query: '컴퓨터 전체 파일 찾기 이름 위치 모름 내용 단서 중복 최종본 버전' } }] };
      }
      if (turn === 2) {
        assert.deepEqual(visible.map((item) => item.name), ['tool_search', 'file_reality']);
        return { text: '', toolCalls: [{ id: 'search', name: 'file_reality', args: {
          action: 'search', query: '새봄상사 파란 표 3000000', scope: 'computer', path: null,
          handles: null, maxCandidates: 5,
        } }] };
      }
      if (turn === 3) {
        assert.deepEqual(toolChoice, { requiredToolName: 'file_reality' });
        const result = JSON.parse(messages.at(-1).content).result;
        return { text: '', toolCalls: [{ id: 'inspect', name: 'file_reality', args: {
          action: 'inspect', query: null, scope: null, path: null,
          handles: [result.candidates[0].handle], maxCandidates: null,
        } }] };
      }
      assert.match(JSON.parse(messages.at(-1).content).result.content, /3000000/u);
      return { text: '새봄상사 300만원 제안 자료를 찾았습니다.', toolCalls: [] };
    } };
    const result = await runAgent({ request: '그 파일 찾아줘', model, tools, focusToolSurface: true });
    assert.equal(result.answer, '새봄상사 300만원 제안 자료를 찾았습니다.');
    assert.equal(result.receipts.filter((item) => item.actualCall?.name === 'file_reality').length, 2);
  } finally { await rm(room.root, { recursive: true, force: true }); }
});
