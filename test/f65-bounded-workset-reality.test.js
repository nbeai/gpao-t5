import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { WorkEventStore } from '../src/surface/work-event-store.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';

async function observer() {
  return import('../src/runtime/local-file.js');
}

async function room() {
  const base = await mkdtemp(join(tmpdir(), 't5-f65-product-'));
  const root = join(base, 'work'); const state = join(base, 'state');
  await Promise.all([mkdir(root), mkdir(state)]);
  return { base, root, state };
}

function runner(root, state, override) {
  const local = override ?? makeLocalFileTool({ roots: [root], dataDir: state, homeDir: root });
  return new ToolRunner({ 'local.file': local });
}
const executableState = { connectedTools: [{ id: 'local.file', executable: true, status: 'usable' }] };

test('단일 허용 root의 실제 목록은 이름·종류만 bounded current reality가 된다', async () => {
  const x = await room();
  try {
    await writeFile(join(x.root, '자료.csv'), 'secret,value\n숨김,42\n');
    await mkdir(join(x.root, '하위'));
    let contentReads = 0;
    const local = makeLocalFileTool({ roots: [x.root], dataDir: x.state, homeDir: x.root,
      readFile: async () => { contentReads += 1; throw new Error('workset observation read content'); } });
    const { observeWorksetReality } = await observer();
    const out = await observeWorksetReality({ tools: runner(x.root, x.state, local), selfState: executableState, roots: [x.root], configuredRoots: [x.root], currentBasis: 'explicit_file_roots', limit: 1 });
    assert.equal(out.reality.status, 'observed');
    assert.equal(out.reality.currentRoot.path, out.receipt.result.path);
    assert.equal(out.reality.members.length, 1);
    assert.deepEqual(Object.keys(out.reality.members[0]).sort(), ['kind', 'memberRef', 'name', 'revisionRef']);
    assert.match(out.reality.members[0].memberRef, /^wsm1\./);
    assert.match(out.reality.members[0].revisionRef, /^fr1\./);
    assert.equal(out.reality.page.total, 2);
    assert.equal(out.reality.page.truncated, true);
    assert.equal(out.reality.page.nextOffset, 1);
    assert.equal('table' in out.reality.members[0], false);
    assert.equal('text' in out.reality.members[0], false);
    assert.equal(out.receipt.origin, 'runtime_observation');
    assert.equal(out.receipt.result.sourceSetRef, out.reality.sourceSetRef);
    assert.equal(contentReads, 0, 'runtime 목록 관측은 CSV 내용을 읽지 않는다');
  } finally { await rm(x.base, { recursive: true, force: true }); }
});

test('복수 허용 root는 current를 임의 선택하지 않고 후보만 남긴다', async () => {
  const x = await room(); const other = join(x.base, 'other'); await mkdir(other);
  try {
    const { observeWorksetReality } = await observer();
    const out = await observeWorksetReality({ tools: runner(x.root, x.state), selfState: {}, roots: [x.root, other], configuredRoots: [x.root, other], currentBasis: 'explicit_file_roots' });
    assert.equal(out.reality.status, 'unknown');
    assert.equal(out.reality.reason, 'multiple_allowed_roots');
    assert.equal(out.reality.currentRoot, null);
    assert.deepEqual(out.reality.candidates.map((v) => v.path), [await realpath(other), await realpath(x.root)].sort());
    assert.equal(out.receipt, null);
  } finally { await rm(x.base, { recursive: true, force: true }); }
});

test('관측된 빈 목록과 목록 실패 unknown은 서로 다른 현실이다', async () => {
  const x = await room();
  try {
    const { observeWorksetReality } = await observer();
    const empty = await observeWorksetReality({ tools: runner(x.root, x.state), selfState: executableState, roots: [x.root], configuredRoots: [x.root], currentBasis: 'explicit_file_roots' });
    assert.equal(empty.reality.status, 'observed_empty');
    assert.equal(empty.reality.page.total, 0);
    const failing = { scopeRoots: [x.root], async handler() { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } };
    const failed = await observeWorksetReality({ tools: runner(x.root, x.state, failing), selfState: executableState, roots: [x.root], configuredRoots: [x.root], currentBasis: 'explicit_file_roots' });
    assert.equal(failed.reality.status, 'unknown');
    assert.equal(failed.reality.reason, 'list_failed');
    assert.equal('members' in failed.reality, false);
    assert.equal(failed.receipt.failureState, 'failed');
  } finally { await rm(x.base, { recursive: true, force: true }); }
});

test('큰 목록은 잘린 범위와 continuation을 말하고 안 본 항목을 부재로 만들지 않는다', async () => {
  const x = await room();
  try {
    await Promise.all(Array.from({ length: 5 }, (_, i) => writeFile(join(x.root, `f${i}.txt`), `${i}`)));
    const { observeWorksetReality } = await observer();
    const out = await observeWorksetReality({ tools: runner(x.root, x.state), selfState: executableState, roots: [x.root], configuredRoots: [x.root], currentBasis: 'explicit_file_roots', limit: 2 });
    assert.equal(out.reality.members.length, 2);
    assert.deepEqual(out.reality.page, { offset: 0, observed: 2, total: 5, truncated: true, nextOffset: 2 });
    assert.equal(out.reality.membersComplete, false);
  } finally { await rm(x.base, { recursive: true, force: true }); }
});

test('관측 목록은 생성 순서와 무관한 결정적 순서·전체 sourceSet 신분을 쓴다', async () => {
  const x = await room();
  try {
    for (const name of ['z.txt', 'a.txt', 'm.txt']) await writeFile(join(x.root, name), name);
    const { observeWorksetReality } = await observer();
    const tools = runner(x.root, x.state);
    const first = await observeWorksetReality({ tools, selfState: executableState, roots: [x.root], configuredRoots: [x.root],
      currentBasis: 'explicit_file_roots', limit: 2 });
    const full = await observeWorksetReality({ tools, selfState: executableState, roots: [x.root], configuredRoots: [x.root],
      currentBasis: 'explicit_file_roots', limit: 64 });
    assert.deepEqual(first.reality.members.map((v) => v.name), ['a.txt', 'm.txt']);
    assert.equal(first.reality.sourceSetRef, full.reality.sourceSetRef);
    assert.equal(first.reality.page.nextOffset, 2);
  } finally { await rm(x.base, { recursive: true, force: true }); }
});

test('기본 HOME 허용 범위는 단일이어도 자동 current 작업셋이 아니다', async () => {
  const x = await room();
  try {
    await writeFile(join(x.root, '홈이름.txt'), 'x');
    const { observeWorksetReality } = await observer();
    const out = await observeWorksetReality({ tools: runner(x.root, x.state), selfState: {}, roots: [x.root] });
    assert.equal(out.reality.status, 'unknown');
    assert.equal(out.reality.reason, 'allowed_scope_not_current');
    assert.equal(out.receipt, null);
    assert.doesNotMatch(JSON.stringify(out.reality), /홈이름/);
  } finally { await rm(x.base, { recursive: true, force: true }); }
});

test('root 별칭은 list 실물이 확인한 canonical path와 source 신분을 함께 쓴다', async () => {
  const x = await room(); const alias = join(x.base, 'alias');
  try {
    await writeFile(join(x.root, 'a.txt'), 'x'); await symlink(x.root, alias);
    const { observeWorksetReality } = await observer();
    const out = await observeWorksetReality({ tools: runner(alias, x.state), selfState: executableState,
      roots: [alias], configuredRoots: [x.root], currentBasis: 'explicit_file_roots' });
    assert.equal(out.reality.currentRoot.path, out.receipt.result.path);
    assert.notEqual(out.reality.currentRoot.path, alias);
    assert.equal(out.receipt.result.sourceSetRef, out.reality.sourceSetRef);
  } finally { await rm(x.base, { recursive: true, force: true }); }
});

test('환경 explicit root와 실제 tool scope가 다르면 어느 쪽도 current로 올리거나 list하지 않는다', async () => {
  const x = await room(); const other = join(x.base, 'other'); await mkdir(other);
  let listCalls = 0;
  const local = makeLocalFileTool({ roots: [other], dataDir: x.state, homeDir: other });
  const tools = new ToolRunner({ 'local.file': { ...local, async handler(...args) { listCalls += 1; return local.handler(...args); } } });
  try {
    const { observeWorksetReality } = await observer();
    const out = await observeWorksetReality({ tools, selfState: executableState, roots: [other],
      configuredRoots: [x.root], currentBasis: 'explicit_file_roots' });
    assert.equal(out.reality.status, 'unknown');
    assert.equal(out.reality.reason, 'scope_configuration_mismatch');
    assert.equal(out.reality.currentRoot, null);
    assert.equal(out.receipt, null);
    assert.equal(listCalls, 0);
  } finally { await rm(x.base, { recursive: true, force: true }); }
});

test('실제 /turn 첫 모델 입력과 같은 턴 ledger가 같은 sourceSetRef를 공유한다', async () => {
  const x = await room(); await writeFile(join(x.root, '원천.txt'), '내용은 모델 현실에 들어가면 안 됨');
  let captured; let throwNext = false;
  const tools = runner(x.root, x.state);
  const model = { async respond(tc) { if (throwNext) throw new Error('provider down');
    captured ??= { tc, messages: buildModelMessages(tc) }; return { text: '확인할게요.', toolCalls: [] }; } };
  const store = new SessionStore(x.state);
  const workEventStore = new WorkEventStore(x.state);
  const server = makeServer({ store, workEventStore, tools, model, modelTimeoutMs: 0,
    processEnv: { HOME: x.root, GPAO_T5_HOME: x.root, GPAO_T5_DATA_DIR: x.state, GPAO_T5_FILE_ROOTS: x.root } });
  try {
    await server.runtimeReconcile();
    await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
    const base = `http://127.0.0.1:${server.address().port}`;
    let res = await fetch(`${base}/`); const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
    res = await fetch(`${base}/sessions`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
    const session = await res.json();
    res = await fetch(`${base}/turn`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '이미 준 자료를 정리해줘.' }) });
    assert.equal(res.status, 200); await res.json();
    assert.equal(captured.tc.worksetReality.status, 'observed', JSON.stringify(captured.tc.worksetReality));
    assert.equal(captured.tc.worksetReality.members[0].name, '원천.txt');
    assert.doesNotMatch(JSON.stringify(captured.tc.worksetReality), /내용은 모델/);
    assert.match(captured.messages.system, /\[현재 작업셋의 기계 현실\]/);
    assert.match(captured.messages.system, /원천\.txt \(file\)/);
    assert.doesNotMatch(captured.messages.user, /현재 작업셋의 기계 현실/);
    const saved = await store.load(session.id);
    const observation = saved.ledgerEntries.find((v) => v.origin === 'runtime_observation');
    assert.ok(observation);
    assert.equal(observation.result.sourceSetRef, captured.tc.worksetReality.sourceSetRef);
    assert.equal(observation.actualCall.tool, 'local.file');
    assert.equal(observation.actualCall.args.action, 'list');
    assert.notEqual(saved.workingState?.recentOutcome?.status, 'completed');
    const workEvents = await workEventStore.load();
    assert.equal(workEvents.some((event) => event.type === 'execution_completed'), false);
    throwNext = true;
    res = await fetch(`${base}/turn`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '다시 봐줘.' }) });
    const failedTurn = await res.json();
    assert.match(failedTurn.reply, /아직 실행하지 않았어요/);
    assert.deepEqual(failedTurn.ledger?.confirmed ?? [], []);
    const afterFailure = await store.load(session.id);
    assert.equal(afterFailure.ledgerEntries.filter((v) => v.origin === 'runtime_observation'
      && v.observationKind === 'workset').length, 2);
    assert.notEqual(afterFailure.workingState?.recentOutcome?.status, 'completed');
  } finally {
    await new Promise((ok) => server.close(ok)); await rm(x.base, { recursive: true, force: true });
  }
});
