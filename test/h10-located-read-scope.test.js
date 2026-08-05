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
  // **읽기는 홈까지 열려 있다**(2026-08-05 오너 지적 뒤 바뀜).
  // 예전엔 정적 루트 밖은 locate 가 열어 줘야 읽혔다. 그래서 `내 컴퓨터에서 … 읽어줘` 가
  // 도큐먼트 밖으로 못 나갔고, **같은 파일이 `local.terminal` 로는 읽혔다** —
  // 우회되는 울타리는 위험을 못 막고 사용자가 시킨 일만 막는다.
  // 이 검사의 본래 목적(탐색이 권한을 만드는 경로가 정확한가)은 아래 위임 봉투가 그대로 잰다.
  assert.equal(before.failureState, 'none', '홈 안 읽기가 막혔다 — "내 컴퓨터"가 말 그대로 동작해야 한다');

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
  // **쓰기를 막는 것은 울타리가 아니라 승인이다**(오너 지시 2026-08-05):
  //   *"쓰기/이동/삭제는 사용자 지시에 그렇게 하라는 내용이 있으면 하면 되는 거고,
  //     다른 지시를 수행하다 필수적으로 필요해지면 승인을 요청하면 되는 거고,
  //     반복되면 학습으로 올리면 되는 거다."*
  // 그 기계는 이미 다 있다 — 안 시킨 파괴는 `발화밖파괴` 가 카드로 올리고(S6-c 6번),
  // 반복은 `허락한손`·자동화 제안이 받는다. 손 안에서 한 번 더 막으면 **사용자가 시킨 일까지 막힌다.**
  assert.equal(write.failureState, 'none', '홈 안 쓰기가 손 단계에서 막혔다 — 그 판단은 승인 경계의 것이다');
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
  // **홈 밖에서 잰다.** 읽기가 홈까지 열린 뒤(2026-08-05) 홈 안 경로로는 전달을 끊어도
  // 홈이 덮어 아무 일이 안 난다 — 돌연변이 스윕이 그 사실을 먼저 말해 줬다.
  // 이 계약(봉인된 자리가 자식의 읽기 문을 연다)이 값을 하는 자리는 외장 같은 홈 밖이다.
  const 밖작업방 = await realpath(await mkdtemp(join(tmpdir(), 't5-자식외장-')));
  await writeFile(join(밖작업방, 'package.json'), '{"name":"alpha"}');
  const base = new ToolRunner({ 'local.file': f.localFile });
  const budget = { consumeStep() {} };
  const wrapped = scopedAgentTools(base, {
    toolAllowlist: ['local.file'],
    workspaceRoots: [밖작업방],
    authorityEnvelope: {
      allowedKinds: ['read'], allowedTools: ['local.file'], allowedTargets: [], workspaceRoots: [밖작업방],
    },
  }, budget, new AbortController().signal, async () => {}, stateFor('local.file'));

  const rec = await wrapped.run(
    'local.file', { action: 'read', path: join(밖작업방, 'package.json') }, stateFor('local.file'),
  );
  assert.equal(rec.failureState, 'none',
    '봉인된 자리를 자식의 읽기 범위로 안 넘겼다 — 자식은 홈 밖 작업방을 영영 못 연다');
  assert.match(rec.result.text, /alpha/);
});

// ── **locate 가 연 자리는 홈 밖에서 값을 한다** ────────────────────────────────
//
// 읽기가 홈까지 열린 뒤(2026-08-05), 홈 안 경로로는 `readScopeRoots` 를 빼도 아무 일이
// 일어나지 않는다 — 홈이 이미 덮기 때문이다. 돌연변이 스윕이 그 사실을 먼저 말해 줬다
// (두 겨냥이 빠져나갔다). **계약이 죽은 게 아니라 재는 자리가 옮겨간 것이다.**
// 외장 디스크처럼 **홈 밖** 자리에서는 여전히 이것만이 문을 연다.
test('locate 가 연 홈 밖 자리만 읽기가 열린다 — 안 열어 준 홈 밖은 그대로 막힌다', async () => {
  const 밖 = await realpath(await mkdtemp(join(tmpdir(), 't5-외장-')));
  const 다른밖 = await realpath(await mkdtemp(join(tmpdir(), 't5-남의외장-')));
  await writeFile(join(밖, '자료.md'), '외장 내용');
  await writeFile(join(다른밖, '자료.md'), '남의 것');
  const f = await fixture();
  const runner = new ToolRunner({ 'local.file': f.localFile });
  const selfState = stateFor('local.file');

  const 열린것 = await runner.run('local.file', { action: 'read', path: join(밖, '자료.md') },
    selfState, { currentRequest: USER, readScopeRoots: [밖] });
  assert.equal(열린것.failureState, 'none',
    'locate 가 연 홈 밖 자리를 못 읽었다 — 그 자리를 여는 유일한 문이다');

  const 안열린것 = await runner.run('local.file', { action: 'read', path: join(다른밖, '자료.md') },
    selfState, { currentRequest: USER, readScopeRoots: [밖] });
  assert.equal(안열린것.failureState, 'blocked',
    '**안 열어 준 홈 밖 자리가 열렸다** — 탐색이 권한을 만드는 경로가 정확해야 한다');
});
