import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runAgent } from '../src/agent-loop.js';
import { makeFileRealityTool } from '../src/file-reality-tool.js';
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
        { handle: first.handle, destinationDirectory: collision },
        { handle: revised.handle, destinationDirectory: ready },
      ] });
    assert.equal(plan.readyToApply, false); assert.equal(plan.filesChanged, 0);
    assert.deepEqual(plan.changes.map((item) => item.state), ['collision', 'ready']);
    assert.match(plan.note, /no file was moved/u);
    assert.match(await readFile(room.a, 'utf8'), /3000000/u);
    assert.match(await readFile(room.c, 'utf8'), /3200000/u);
    await assert.rejects(stat(join(ready, '새봄-견적서-수정.txt')), { code: 'ENOENT' });
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
    const model = { async respond({ tools: visible, messages }) {
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
