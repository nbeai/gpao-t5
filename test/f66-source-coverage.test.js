import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';
import {
  identifyWorksetMembers, projectSourceCoverage,
} from '../src/kernel/l1-intent/source-coverage.js';

async function room() {
  const base = await mkdtemp(join(tmpdir(), 't5-f66-product-'));
  const root = join(base, 'work'); const state = join(base, 'state');
  await Promise.all([mkdir(root), mkdir(state)]);
  return { base, root, state };
}

async function start(x, model, localOverride) {
  const local = localOverride ?? makeLocalFileTool({ roots: [x.root], dataDir: x.state, homeDir: x.root });
  const store = new SessionStore(x.state);
  const server = makeServer({
    store,
    tools: new ToolRunner({ 'local.file': local }),
    model,
    modelTimeoutMs: 0,
    processEnv: {
      HOME: x.root,
      GPAO_T5_HOME: x.root,
      GPAO_T5_DATA_DIR: x.state,
      GPAO_T5_FILE_ROOTS: x.root,
    },
  });
  await server.runtimeReconcile();
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let response = await fetch(`${base}/`);
  const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0];
  response = await fetch(`${base}/sessions`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}',
  });
  return { server, store, base, cookie, session: await response.json() };
}

function reality(root, names, { complete = true, total = names.length, sourceSetRef = 'ws1.fixture' } = {}) {
  return identifyWorksetMembers({
    status: 'observed', currentRoot: { path: root, rootRef: 'wr1.fixture' }, sourceSetRef,
    members: names.map(([name, kind = 'file']) => ({ name, kind, revisionRef: `fr1.${name}` })), membersComplete: complete,
    page: { offset: 0, observed: names.length, total, truncated: !complete,
      ...(!complete ? { nextOffset: names.length } : {}) },
  });
}

function readReceipt({ root, name, workRef = 'work-1', sourceSetRef = 'ws1.fixture',
  offset = 0, text = 'x', totalChars = offset + text.length, nextOffset, failureState = 'none',
  callRef = `${name}:${offset}`, actualPath, sourceRevisionRef = `fr1.${name}` } = {}) {
  return {
    intended: 'local.file 실행', lifecycle: failureState === 'none' ? 'delivered' : 'failed', failureState,
    sourceWorkRef: workRef, sourceSetRef,
    actualCall: { tool: 'local.file', args: { action: 'read', path: join(root, name), offset }, callRef },
    ...(failureState === 'none' ? { result: { path: actualPath ?? join(root, name), text, totalChars, offset, sourceRevisionRef,
      ...(Number.isInteger(nextOffset) ? { nextOffset } : {}) } } : {}),
  };
}

test('실제 /turn은 3 source 중 2 read를 read/read/unresolved 현실로 다음 판단과 원장에 남긴다', async () => {
  const x = await room();
  await Promise.all([
    writeFile(join(x.root, 'a.txt'), 'A'),
    writeFile(join(x.root, 'b.txt'), 'B'),
    writeFile(join(x.root, 'c.txt'), 'C'),
  ]);
  const contexts = [];
  let call = 0;
  const model = { async respond(tc) {
    contexts.push(tc); call += 1;
    if (call === 1) return {
      text: '',
      toolCalls: [
        { name: 'local.file', args: { action: 'read', path: join(x.root, 'a.txt') } },
        { name: 'local.file', args: { action: 'read', path: join(x.root, 'b.txt') } },
      ],
    };
    return { text: '두 자료를 확인했어요.', toolCalls: [] };
  } };
  const app = await start(x, model);
  try {
    const response = await fetch(`${app.base}/turn`, {
      method: 'POST', headers: { cookie: app.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: app.session.id, text: '이 자료들을 확인해줘.' }),
    });
    assert.equal(response.status, 200);
    await response.json();
    const coverage = contexts.map((tc) => tc?.worksetReality?.sourceCoverage).filter(Boolean).at(-1);
    const saved = await app.store.load(app.session.id);
    assert.ok(coverage, '실행 뒤 모델 현실에 source coverage가 없다');
    assert.deepEqual(Object.fromEntries(coverage.members.map((member) => [member.name, member.status])), {
      'a.txt': 'read', 'b.txt': 'read', 'c.txt': 'unresolved',
    });
    assert.equal(coverage.complete, false);
    const rendered = buildModelMessages(contexts.at(-1));
    assert.match(rendered.system, /source 결산: read 2 · excluded 0 · unresolved 1/);
    assert.match(rendered.system, /c\.txt: unresolved/);
    const ledgerCoverage = saved.ledgerEntries.find((entry) => entry?.result?.sourceCoverage);
    assert.ok(ledgerCoverage, 'source coverage의 durable 원장 사실이 없다');
    assert.equal(ledgerCoverage.result.sourceCoverage.sourceSetRef, coverage.sourceSetRef);
  } finally {
    await new Promise((ok) => app.server.close(ok));
    await rm(x.base, { recursive: true, force: true });
  }
});

test('실제 /turn의 실패 read는 unresolved이고 runtime 결산은 사용자 실행 완료를 만들지 않는다', async () => {
  const x = await room(); await writeFile(join(x.root, 'fail.txt'), 'data');
  const baseLocal = makeLocalFileTool({ roots: [x.root], dataDir: x.state, homeDir: x.root });
  const failingLocal = { ...baseLocal, async handler(args, context) {
    if (args?.action === 'read') return { failed: true, userSafeSummary: '읽지 못했어요.' };
    return baseLocal.handler(args, context);
  } };
  let calls = 0;
  const model = { async respond() {
    calls += 1;
    if (calls === 1) return { text: '', toolCalls: [
      { name: 'local.file', args: { action: 'read', path: join(x.root, 'fail.txt') } },
    ] };
    return { text: '읽지 못했어요.', toolCalls: [] };
  } };
  const app = await start(x, model, failingLocal);
  try {
    const response = await fetch(`${app.base}/turn`, { method: 'POST', headers: { cookie: app.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: app.session.id, text: '이 자료를 확인해줘.' }) });
    await response.json();
    const saved = await app.store.load(app.session.id);
    const coverage = [...saved.ledgerEntries].reverse().find((entry) => entry?.observationKind === 'source_coverage')
      .result.sourceCoverage;
    assert.equal(coverage.members[0].status, 'unresolved');
    assert.equal(coverage.counts.read, 0);
    assert.notEqual(saved.workingState?.recentOutcome?.status, 'completed');
  } finally {
    await new Promise((ok) => app.server.close(ok)); await rm(x.base, { recursive: true, force: true });
  }
});

test('실제 /turn에서 관측 뒤 read 전에 바뀐 파일은 성공 read여도 initial member read가 아니다', async () => {
  const x = await room(); await writeFile(join(x.root, 'changing.txt'), 'before');
  let calls = 0;
  const model = { async respond() {
    calls += 1;
    if (calls === 1) {
      await writeFile(join(x.root, 'changing.txt'), 'after and different');
      await utimes(join(x.root, 'changing.txt'), new Date('2031-01-01T00:00:00Z'), new Date('2031-01-01T00:00:00Z'));
      return { text: '', toolCalls: [
        { name: 'local.file', args: { action: 'read', path: join(x.root, 'changing.txt') } },
      ] };
    }
    return { text: '현재 파일을 읽었어요.', toolCalls: [] };
  } };
  const app = await start(x, model);
  try {
    await fetch(`${app.base}/turn`, { method: 'POST', headers: { cookie: app.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: app.session.id, text: '처음 준 자료를 확인해줘.' }) });
    const saved = await app.store.load(app.session.id);
    const coverage = [...saved.ledgerEntries].reverse().find((entry) => entry?.observationKind === 'source_coverage')
      .result.sourceCoverage;
    assert.equal(coverage.members[0].status, 'unresolved');
    const read = saved.ledgerEntries.find((entry) => entry?.actualCall?.args?.action === 'read');
    assert.notEqual(read.result.sourceRevisionRef, coverage.members[0].revisionRef);
  } finally {
    await new Promise((ok) => app.server.close(ok)); await rm(x.base, { recursive: true, force: true });
  }
});

test('실제 /turn의 65-member 목록은 64개만 관측하고 나머지를 부재나 complete로 만들지 않는다', async () => {
  const x = await room();
  await Promise.all(Array.from({ length: 65 }, (_, index) => writeFile(join(x.root, `f${String(index).padStart(2, '0')}.txt`), `${index}`)));
  const model = { async respond() { return { text: '현재 자료를 확인했어요.', toolCalls: [] }; } };
  const app = await start(x, model);
  try {
    const response = await fetch(`${app.base}/turn`, { method: 'POST', headers: { cookie: app.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: app.session.id, text: '이 자료들을 살펴봐.' }) });
    await response.json();
    const saved = await app.store.load(app.session.id);
    const coverage = [...saved.ledgerEntries].reverse().find((entry) => entry?.observationKind === 'source_coverage')
      .result.sourceCoverage;
    assert.equal(coverage.members.length, 64);
    assert.equal(coverage.membersComplete, false);
    assert.equal(coverage.unobserved, 1);
    assert.equal(coverage.complete, false);
    assert.notEqual(saved.workingState?.recentOutcome?.status, 'completed');
  } finally {
    await new Promise((ok) => app.server.close(ok)); await rm(x.base, { recursive: true, force: true });
  }
});

test('부분 pagination·실패·중복 read는 terminal까지 이어진 canonical member만 read로 세운다', () => {
  const root = '/bounded/work'; const workset = reality(root, [['a.txt'], ['b.txt'], ['folder', 'folder']]);
  const partial = readReceipt({ root, name: 'a.txt', text: 'ab', totalChars: 4, nextOffset: 2 });
  const failed = readReceipt({ root, name: 'b.txt', failureState: 'failed' });
  let coverage = projectSourceCoverage({ worksetReality: workset, receipts: [partial, partial, failed], workRef: 'work-1' });
  assert.deepEqual(coverage.counts, { read: 0, excluded: 0, unresolved: 3 });
  const wrongRevisionTail = readReceipt({ root, name: 'a.txt', offset: 2, text: 'cd', totalChars: 4,
    sourceRevisionRef: 'fr1.changed' });
  coverage = projectSourceCoverage({ worksetReality: workset, receipts: [partial, wrongRevisionTail], workRef: 'work-1' });
  assert.equal(coverage.members.find((m) => m.name === 'a.txt').status, 'unresolved');
  const tail = readReceipt({ root, name: 'a.txt', offset: 2, text: 'cd', totalChars: 4 });
  coverage = projectSourceCoverage({ worksetReality: workset, receipts: [partial, partial, tail, failed], workRef: 'work-1' });
  assert.equal(coverage.members.find((m) => m.name === 'a.txt').status, 'read');
  assert.deepEqual(coverage.members.find((m) => m.name === 'a.txt').evidenceCallRefs, ['a.txt:0', 'a.txt:2']);
  assert.equal(coverage.members.find((m) => m.name === 'b.txt').status, 'unresolved');
  assert.equal(coverage.members.find((m) => m.name === 'folder').status, 'unresolved');
});

test('WorkRef·sourceSetRef가 다른 read와 후속 output은 initial source 결산을 오염시키지 않는다', () => {
  const root = '/bounded/work'; const workset = reality(root, [['source.txt']]);
  const receipts = [
    readReceipt({ root, name: 'source.txt', workRef: 'other-work' }),
    readReceipt({ root, name: 'source.txt', sourceSetRef: 'ws1.other' }),
    readReceipt({ root, name: 'output.txt' }),
  ];
  const coverage = projectSourceCoverage({ worksetReality: workset, receipts, workRef: 'work-1' });
  assert.deepEqual(coverage.members.map(({ name, status }) => ({ name, status })), [
    { name: 'source.txt', status: 'unresolved' },
  ]);
  assert.equal(coverage.members.some((member) => member.name === 'output.txt'), false);
});

test('절단 목록은 관측 member를 다 읽어도 complete가 아니며 관측 안 됨을 부재로 만들지 않는다', () => {
  const root = '/bounded/work';
  const workset = reality(root, [['a.txt'], ['b.txt']], { complete: false, total: 3 });
  const coverage = projectSourceCoverage({ worksetReality: workset, receipts: [
    readReceipt({ root, name: 'a.txt' }), readReceipt({ root, name: 'b.txt' }),
  ], workRef: 'work-1' });
  assert.equal(coverage.counts.read, 2);
  assert.equal(coverage.unobserved, 1);
  assert.equal(coverage.complete, false);
});

test('symlink member는 요청한 entry 신분으로 귀속되고 actual target 이웃을 대신 read로 만들지 않는다', async () => {
  const x = await room();
  try {
    await writeFile(join(x.root, 'target.txt'), 'target');
    await symlink(join(x.root, 'target.txt'), join(x.root, 'alias.txt'));
    const canonical = await realpath(x.root);
    const workset = reality(canonical, [['alias.txt'], ['target.txt']]);
    const receipt = readReceipt({ root: canonical, name: 'alias.txt', actualPath: await realpath(join(x.root, 'alias.txt')) });
    const coverage = projectSourceCoverage({ worksetReality: workset, receipts: [receipt], workRef: 'work-1' });
    assert.deepEqual(Object.fromEntries(coverage.members.map((m) => [m.name, m.status])), {
      'alias.txt': 'read', 'target.txt': 'unresolved',
    });
  } finally { await rm(x.base, { recursive: true, force: true }); }
});

test('재시작 뒤 같은 세션의 새 임무·변경된 source는 옛 read를 자동 상속하지 않고 역사는 보존한다', async () => {
  const x = await room();
  await Promise.all([writeFile(join(x.root, 'a.txt'), 'A'), writeFile(join(x.root, 'b.txt'), 'B')]);
  const model1 = { calls: 0, async respond() {
    this.calls += 1;
    if (this.calls === 1) return { text: '', toolCalls: [
      { name: 'local.file', args: { action: 'read', path: join(x.root, 'a.txt') } },
    ] };
    return { text: '첫 자료를 봤어요.', toolCalls: [] };
  } };
  const first = await start(x, model1);
  let sessionId = first.session.id;
  try {
    await fetch(`${first.base}/turn`, { method: 'POST', headers: { cookie: first.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, text: '자료를 확인해줘.' }) });
  } finally { await new Promise((ok) => first.server.close(ok)); }
  await writeFile(join(x.root, 'a.txt'), 'A changed');
  await utimes(join(x.root, 'a.txt'), new Date('2030-01-01T00:00:00Z'), new Date('2030-01-01T00:00:00Z'));

  const seen = [];
  const model2 = { calls: 0, async respond(tc) {
    seen.push(tc?.worksetReality?.sourceCoverage); this.calls += 1;
    if (this.calls === 1) return { text: '', toolCalls: [
      { name: 'local.file', args: { action: 'read', path: join(x.root, 'b.txt') } },
    ] };
    return { text: '나머지도 봤어요.', toolCalls: [] };
  } };
  const second = await start(x, model2);
  try {
    const before = await second.store.load(sessionId);
    const firstCoverage = [...before.ledgerEntries].reverse()
      .find((entry) => entry?.observationKind === 'source_coverage');
    const response = await fetch(`${second.base}/turn`, { method: 'POST', headers: { cookie: second.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, text: '별개 임무로 b 자료만 확인해줘.' }) });
    assert.equal(response.status, 200);
    await response.json();
    assert.deepEqual(seen[0].counts, { read: 0, excluded: 0, unresolved: 2 });
    const saved = await second.store.load(sessionId);
    const finalCoverage = [...saved.ledgerEntries].reverse().find((entry) => entry?.observationKind === 'source_coverage')
      .result.sourceCoverage;
    assert.deepEqual(finalCoverage.counts, { read: 1, excluded: 0, unresolved: 1 });
    assert.notEqual(finalCoverage.workRef, firstCoverage.result.sourceCoverage.workRef);
    assert.notEqual(finalCoverage.sourceSetRef, firstCoverage.result.sourceCoverage.sourceSetRef);
    assert.equal(saved.ledgerEntries.some((entry) => entry?.observationKind === 'source_coverage'
      && entry.sourceWorkRef === firstCoverage.sourceWorkRef), true, '첫 턴 durable 역사를 지우면 안 된다');
  } finally {
    await new Promise((ok) => second.server.close(ok));
    await rm(x.base, { recursive: true, force: true });
  }
});
