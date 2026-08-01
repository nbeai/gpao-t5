import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { makeAgentDelegateTool } from '../src/runtime/agent-delegate-tool.js';
import { scopedAgentTools } from '../src/runtime/canonical-automation-runtime.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { makeLocalLocateTool } from '../src/runtime/local-locate.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { demoEnv } from '../src/surface/demo-context.js';

const USER = 'Developer 폴더의 두 프로젝트를 나눠 읽고 차이를 정리해줘';

function stateFor(...ids) {
  return buildSelfState(demoEnv({ include: ids, hands: ids }));
}

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 't5-h10-located-scope-'));
  const staticRoot = join(home, 'GPAO-T5');
  const developer = join(home, 'Developer');
  const left = join(developer, 'alpha');
  const right = join(developer, 'beta');
  await Promise.all([
    mkdir(staticRoot, { recursive: true }),
    mkdir(left, { recursive: true }),
    mkdir(right, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(left, 'package.json'), '{"name":"alpha"}'),
    writeFile(join(right, 'package.json'), '{"name":"beta"}'),
  ]);
  const localFile = makeLocalFileTool({ roots: [staticRoot], homeDir: home, dataDir: staticRoot });
  const localLocate = makeLocalLocateTool({ home });
  return { home, staticRoot, developer, left, right, localFile, localLocate };
}

test('같은 턴의 성공한 locate 영수증만 읽기·위임 범위를 넓히고 쓰기는 넓히지 않는다', async () => {
  const f = await fixture();
  const calls = [];
  const runtime = {
    async delegateUserRequest(request) {
      calls.push(request);
      return { parent: { id: 'p', childRunIds: ['a', 'b'] }, children: [] };
    },
    async executeDelegation() {
      return { status: 'succeeded', results: [
        { status: 'succeeded', result: { reply: 'alpha' }, receipts: [{}] },
        { status: 'succeeded', result: { reply: 'beta' }, receipts: [{}] },
      ] };
    },
  };
  const delegate = makeAgentDelegateTool({ runtime: () => runtime, localFile: f.localFile });
  const runner = new ToolRunner({
    'local.locate': f.localLocate,
    'local.file': f.localFile,
    'agent.delegate': delegate,
  });
  const selfState = stateFor('local.locate', 'local.file', 'agent.delegate');

  const before = await runner.run(
    'local.file', { action: 'read', path: join(f.left, 'package.json') }, selfState,
    { currentRequest: USER },
  );
  assert.equal(before.failureState, 'blocked', 'locate 전 범위 밖 읽기가 열렸다');

  const located = await runner.run(
    'local.locate', { what: '프로젝트', from: 'Developer' }, selfState,
    { currentRequest: USER },
  );
  assert.equal(located.failureState, 'none');
  assert.deepEqual(
    new Set(located.readScopeRoots),
    new Set([await realpath(f.developer)]),
  );
  const context = { currentRequest: USER, readScopeRoots: located.readScopeRoots };

  const read = await runner.run(
    'local.file', { action: 'read', path: join(f.left, 'package.json') }, selfState, context,
  );
  assert.equal(read.failureState, 'none');
  assert.match(read.result.text, /alpha/);

  const delegated = await runner.run('agent.delegate', {
    goal: USER,
    partitions: [{ label: '알파', folder: f.left }, { label: '베타', folder: f.right }],
  }, selfState, context);
  assert.equal(delegated.failureState, 'none');
  assert.equal(calls.length, 1);
  assert.deepEqual(
    new Set(calls[0].authorityEnvelope.workspaceRoots),
    new Set([await realpath(f.left), await realpath(f.right)]),
  );

  const write = await runner.run(
    'local.file', { action: 'write', path: join(f.left, 'changed.txt'), text: 'no' }, selfState, context,
  );
  assert.equal(write.failureState, 'blocked', 'locate 읽기 범위가 쓰기 범위까지 넓혔다');
  await assert.rejects(readFile(join(f.left, 'changed.txt')));
});

test('locate 질의가 한 대상으로 좁아도 같은 요청에서 직접 부른 실제 형제 폴더를 범위로 보존한다', async () => {
  const f = await fixture();
  for (let i = 0; i < 8; i += 1) {
    await writeFile(join(f.left, `beta-${i}.md`), `noise-${i}`);
  }
  const runner = new ToolRunner({ 'local.locate': f.localLocate });
  const request = 'Developer 폴더의 alpha와 beta를 각각 조사해줘';
  const located = await runner.run(
    'local.locate', { what: 'beta', from: 'Developer', depth: 3 }, stateFor('local.locate'),
    { currentRequest: request },
  );

  assert.deepEqual(
    new Set(located.readScopeRoots),
    new Set([await realpath(f.developer), await realpath(f.left), await realpath(f.right)]),
    '직접 부른 시작 루트와 하위 폴더를 잃으면 안 된다',
  );
  assert.deepEqual(
    new Set(located.result.candidates.slice(0, 2).map((entry) => entry.path)),
    new Set([f.left, f.right]),
  );
});

test('모델이 사용자 원문에 없는 시작 폴더를 임의로 골라도 읽기 범위는 열리지 않는다', async () => {
  const f = await fixture();
  const runner = new ToolRunner({ 'local.locate': f.localLocate });
  const located = await runner.run(
    'local.locate', { what: '프로젝트', from: 'Developer' }, stateFor('local.locate'),
    { currentRequest: '두 프로젝트를 찾아서 비교해줘' },
  );

  assert.equal(located.failureState, 'none', '찾기는 실행될 수 있다');
  assert.deepEqual(located.readScopeRoots ?? [], [],
    '모델이 고른 시작점만으로 사용자 파일 읽기 범위를 넓히면 안 된다');
});

test('임의 경로·보호 경로·심볼릭 링크 탈출은 locate 읽기 범위로도 위임되지 않는다', async () => {
  const f = await fixture();
  const outside = await mkdtemp(join(tmpdir(), 't5-h10-outside-'));
  await symlink(outside, join(f.left, 'escape'));
  let delegated = 0;
  const tool = makeAgentDelegateTool({
    localFile: f.localFile,
    runtime: () => ({
      async delegateUserRequest() { delegated += 1; return { parent: {}, children: [] }; },
      async executeDelegation() { return { status: 'succeeded', results: [] }; },
    }),
  });

  for (const [roots, folders] of [
    [[], [f.left, '/etc']],
    [[homedir()], [join(homedir(), '.ssh'), join(homedir(), '.ssh')]],
    [[f.left], [join(f.left, 'escape'), join(f.left, 'escape')]],
  ]) {
    const out = await tool.handler({
      goal: USER,
      partitions: folders.map((folder) => ({ folder })),
    }, { currentRequest: USER, readScopeRoots: roots });
    assert.equal(out.blocked, true);
  }
  assert.equal(delegated, 0);
});

test('자식 실행기는 봉인된 workspaceRoots를 local.file 읽기 범위로 실제 전달한다', async () => {
  const f = await fixture();
  const base = new ToolRunner({ 'local.file': f.localFile });
  const budget = { consumeStep() {} };
  const wrapped = scopedAgentTools(base, {
    toolAllowlist: ['local.file'],
    workspaceRoots: [f.left],
    authorityEnvelope: {
      allowedKinds: ['read'], allowedTools: ['local.file'], allowedTargets: [], workspaceRoots: [f.left],
    },
  }, budget, new AbortController().signal, async () => {}, stateFor('local.file'));

  const rec = await wrapped.run(
    'local.file', { action: 'read', path: join(f.left, 'package.json') }, stateFor('local.file'),
  );
  assert.equal(rec.failureState, 'none');
  assert.match(rec.result.text, /alpha/);
});
