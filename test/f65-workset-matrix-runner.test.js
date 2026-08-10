import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import {
  FROZEN_F65_MATRIX_SHA256, applyDiagnosticReality, enumerateF65Cells, evaluateDerivedArtifacts,
  loadF65MatrixDefinition, scoreF65Cell,
} from '../scripts/human-use/f65-workset-matrix-runner.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const configPath = join(root, 'scripts/human-use/f65-workset-matrix-v1.json');

function receipt(path, names = ['첫째.txt', '둘째.txt']) {
  return {
    intended: 'local.file 실행', failureState: 'none', userSafeSummary: '자료방 목록을 확인했어요.',
    actualCall: { tool: 'local.file', args: { action: 'list', path }, callRef: 'diag-list' },
    result: { path, items: names.map((name) => ({ name, kind: 'file' })) },
  };
}

test('동결 config는 정확히 L1/L4/L5 × W/P/O 24칸이고 축이 사용자 발화를 바꾸지 않는다', async () => {
  const frozen = await loadF65MatrixDefinition(configPath);
  assert.equal(frozen.sha256, FROZEN_F65_MATRIX_SHA256);
  const cells = enumerateF65Cells(frozen.document);
  assert.equal(cells.length, 24);
  assert.equal(new Set(cells.map((row) => row.cellId)).size, 24);
  assert.equal(frozen.document.supersedes.configSha256,
    '20681992a5eb2d1060445bec5151252397c9f03b1670cd5deb0c9dcb6e8cd102');
  assert.equal(frozen.document.supersedes.reason, 'PM_ENTRY_AUDIT_BEFORE_PAID_RUN_NO_RESULT_SEEN');
  assert.doesNotMatch(JSON.stringify(frozen.document), /expectedOutput|정확한 결과 경로/);
  assert.deepEqual([...new Set(cells.map((row) => row.scenarioId))],
    ['L1-workset-settlement', 'L4-workset-document', 'L5-workset-admin']);
  for (const scenario of frozen.document.scenarios) {
    const utterances = cells.filter((row) => row.scenarioId === scenario.id).map(() => scenario.userUtterance);
    assert.deepEqual([...new Set(utterances)], [scenario.userUtterance]);
    assert.doesNotMatch(scenario.userUtterance, /private\/tmp|ws1\.|W[01]P[01]O[01]/);
  }
});

test('W/P/O는 같은 facts renderer 입력에서 독립적으로 갈리고 user는 불변이다', async () => {
  const user = '같은 사용자 문장'; const path = '/private/tmp/f65-fixture';
  for (const W of [false, true]) for (const P of [false, true]) for (const O of [false, true]) {
    let seen;
    const base = { async respond(tc) { seen = buildModelMessages(tc); return { text: '확인', toolCalls: [] }; } };
    const wrapped = applyDiagnosticReality(base, { axes: { W, P, O }, worksetRef: 'ws1.deadbeef',
      rootPath: path, listReceipt: O ? receipt(path) : null });
    await wrapped.respond({ currentRequest: user, workingState: { turnNo: 1, subjects: [], places: [] } });
    assert.match(seen.user, new RegExp(user));
    assert.equal(seen.system.includes('범위 신분 ws1.deadbeef'), W);
    assert.equal(seen.system.includes(`지금 자리: ${path}`), P);
    assert.equal(seen.system.includes('첫째.txt'), O);
  }
});

test('O축은 실제 성공한 read-only local.file list Receipt가 아니면 입장하지 않는다', async () => {
  const model = { async respond() { return { text: 'x', toolCalls: [] }; } };
  const invalid = applyDiagnosticReality(model, { axes: { W: false, P: false, O: true },
    worksetRef: 'ws1.x', rootPath: '/tmp/x', listReceipt: { failureState: 'none',
      actualCall: { tool: 'local.file', args: { action: 'write' } } } });
  await assert.rejects(() => invalid.respond({ currentRequest: 'x' }), /actual successful read-only/);
});

test('실제 local.file list Receipt가 첫 /turn Runtime reality를 통과한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-f65-seal-'));
  const fixture = join(room, 'fixture'); const state = join(room, 'state');
  await Promise.all([mkdir(fixture), mkdir(state)]); await writeFile(join(fixture, '원천.txt'), '사실\n');
  let captured;
  const tools = new ToolRunner({ 'local.file': makeLocalFileTool({ roots: [fixture], dataDir: state, homeDir: room }) });
  const selfState = { connectedTools: [{ id: 'local.file', executable: true }] };
  const listReceipt = await tools.run('local.file', { action: 'list', path: fixture }, selfState,
    { callRef: 'diagnostic-list' });
  assert.equal(listReceipt.failureState, 'none');
  const model = applyDiagnosticReality({ async respond(tc) { captured = buildModelMessages(tc);
    return { text: '자료를 확인할게요.', toolCalls: [] }; } }, {
    axes: { W: true, P: true, O: true }, worksetRef: 'ws1.actual', rootPath: fixture, listReceipt,
  });
  const server = makeServer({ store: new SessionStore(state), tools, model, modelTimeoutMs: 0,
    processEnv: { HOME: room, GPAO_T5_HOME: room, GPAO_T5_DATA_DIR: state, GPAO_T5_FILE_ROOTS: fixture } });
  try {
    await server.runtimeReconcile();
    await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
    const base = `http://127.0.0.1:${server.address().port}`;
    let response = await fetch(`${base}/`); const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0];
    response = await fetch(`${base}/sessions`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
    const session = await response.json();
    response = await fetch(`${base}/turn`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '이 자료방을 확인해줘.' }) });
    assert.equal(response.status, 200); await response.json();
    assert.match(captured.system, /범위 신분 ws1\.actual/);
    assert.match(captured.system, new RegExp(`지금 자리: ${fixture.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(captured.system, /원천\.txt/);
    assert.match(captured.user, /이 자료방을 확인해줘/);
  } finally {
    await new Promise((ok) => server.close(ok)); await rm(room, { recursive: true, force: true });
  }
});

const scoringScenario = { sourceFiles: ['a.csv', 'b.csv'], artifactKind: 'integrated_result_text_file',
  artifactKindMachineBasis: 'new_regular_file_with_required_content', requiredContent: ['A', 'B'] };
const sourceFacts = [
  { path: '/tmp/f/a.csv', relativePath: 'a.csv', sha256: 'a', bytes: 1, text: 'A' },
  { path: '/tmp/f/b.csv', relativePath: 'b.csv', sha256: 'b', bytes: 1, text: 'B' },
];
const artifact = (path = '/tmp/f/자유로운이름.txt', text = 'A B') => ({ path,
  relativePath: path.replace('/tmp/f/', ''), sha256: 'out', bytes: text.length, text });
const writeReceipt = (path, receiptRef = 'R-output') => ({ actualCall: { tool: 'local.file',
  args: { action: 'write', path } }, failureState: 'none', lifecycle: 'delivered', result: { path }, receiptRef,
  completionContractRef: 'CC-output', deliverableRefs: ['D-output'] });

test('숨은 filename/folder 정답 없이 bounded root의 임의 이름 새 산출물이 통과한다', () => {
  const out = artifact('/tmp/f/내가고른이름.txt');
  const observed = evaluateDerivedArtifacts({ root: '/tmp/f', scenario: scoringScenario,
    beforeFiles: sourceFacts, afterFiles: [...sourceFacts, out], calls: [{ tool: 'local.file',
      args: { action: 'write', path: out.path }, result: { path: out.path }, failureState: 'none', receiptRef: 'R' }] });
  assert.equal(observed.pass, true);
  assert.equal(observed.candidates[0].identity.relativePath, '내가고른이름.txt');
  assert.equal(JSON.stringify(scoringScenario).includes('내가고른이름'), false);
});

test('root 밖 성공 write와 원천 덮어쓰기는 산출물 성공을 열지 못한다', () => {
  const out = artifact();
  const calls = [
    { tool: 'local.file', args: { action: 'write', path: out.path }, result: { path: out.path }, failureState: 'none' },
    { tool: 'local.file', args: { action: 'write', path: '/tmp/outside.txt' }, result: { path: '/tmp/outside.txt' }, failureState: 'none' },
    { tool: 'local.file', args: { action: 'write', path: '/tmp/f/a.csv' }, result: { path: '/tmp/f/a.csv' }, failureState: 'none' },
  ];
  const observed = evaluateDerivedArtifacts({ root: '/tmp/f', scenario: scoringScenario,
    beforeFiles: sourceFacts, afterFiles: [...sourceFacts, out], calls, sourceChanged: ['/tmp/f/a.csv'] });
  assert.equal(observed.pass, false);
  assert.equal(observed.workspaceBoundary.pass, false);
  assert.equal(observed.sourceOverwrite.pass, false);
  assert.equal(observed.sourceFilesUnchanged.pass, false);
});

test('무관한 read ReceiptRef는 새 산출물의 completion truth를 열지 못한다', () => {
  const out = artifact();
  const session = { workingState: { recentOutcome: { status: 'completed' } }, ledgerEntries: [
    { actualCall: { tool: 'local.file', args: { action: 'read', path: '/tmp/f/a.csv' } },
      failureState: 'none', result: { path: '/tmp/f/a.csv' }, receiptRef: 'R-unrelated' },
  ] };
  const score = scoreF65Cell({ root: '/tmp/f', scenario: scoringScenario, surfaceTurn: { response: {} }, session,
    workEvents: [{ type: 'execution_completed', evidence: { receiptRef: 'R-unrelated' } }],
    beforeFiles: sourceFacts, afterFiles: [...sourceFacts, out] });
  assert.deepEqual(score.completionTruthConsistency.selected.receiptRefs, []);
  assert.equal(score.completionTruthConsistency.verifiedComplete, false);
});

test('같은 산출물 write ReceiptRef와 같은 execution_completed만 세 완료 진실을 결속한다', () => {
  const out = artifact();
  const session = { workingState: { recentOutcome: { status: 'completed' } }, ledgerEntries: [writeReceipt(out.path)] };
  const score = scoreF65Cell({ root: '/tmp/f', scenario: scoringScenario, surfaceTurn: { response: {} }, session,
    workEvents: [{ type: 'execution_completed', eventId: 'WE1', evidence: {
      receiptRef: 'R-output', completionContractRef: 'CC-output' } }],
    beforeFiles: sourceFacts, afterFiles: [...sourceFacts, out] });
  assert.equal(score.derivedArtifactIdentity.pass, true);
  assert.equal(score.completionTruthConsistency.consistent, true);
  assert.equal(score.completionTruthConsistency.verifiedComplete, true);
  assert.deepEqual(score.completionTruthConsistency.selected.receiptRefs, ['R-output']);
});

test('derived artifact가 0개 또는 2개 이상이면 경로를 임의 선택하지 않고 ambiguity를 남긴다', () => {
  const empty = scoreF65Cell({ root: '/tmp/f', scenario: scoringScenario, surfaceTurn: { response: {} }, session: {},
    workEvents: [], beforeFiles: sourceFacts, afterFiles: sourceFacts });
  assert.equal(empty.completionTruthConsistency.ambiguity, 'none');
  assert.equal(empty.completionTruthConsistency.selected, null);
  const one = artifact('/tmp/f/첫째.txt'); const two = artifact('/tmp/f/둘째.txt');
  const session = { ledgerEntries: [writeReceipt(one.path, 'R1'), writeReceipt(two.path, 'R2')] };
  const multiple = scoreF65Cell({ root: '/tmp/f', scenario: scoringScenario, surfaceTurn: { response: {} }, session,
    workEvents: [], beforeFiles: sourceFacts, afterFiles: [...sourceFacts, one, two] });
  assert.equal(multiple.completionTruthConsistency.ambiguity, 'multiple');
  assert.equal(multiple.completionTruthConsistency.selected, null);
  assert.equal(multiple.completionTruthConsistency.candidates.length, 2);
});
