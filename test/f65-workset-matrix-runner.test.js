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
  FROZEN_F65_MATRIX_SHA256, applyDiagnosticReality, enumerateF65Cells,
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

test('결과 판정기는 읽기 범위·경로·내용·세 완료 진실을 별도 기계 사실로 남긴다', () => {
  const scenario = { sourceFiles: ['a.csv', 'b.csv'], expectedOutput: '결과/out.csv', requiredContent: ['A', 'B'] };
  const output = { exists: true, path: '/tmp/f/결과/out.csv', relativePath: '결과/out.csv', text: 'A만' };
  const session = { workingState: { recentOutcome: { status: 'completed' } }, ledgerEntries: [
    { actualCall: { tool: 'local.file', args: { action: 'read', path: '/tmp/f/a.csv' } },
      failureState: 'none', result: { path: '/tmp/f/a.csv' } },
    { actualCall: { tool: 'local.file', args: { action: 'write', path: '/tmp/f/결과/out.csv' } },
      failureState: 'none', result: { path: '/tmp/f/결과/out.csv' }, receiptRef: 'R1' },
  ] };
  const score = scoreF65Cell({ scenario, surfaceTurn: { response: { kind: 'clarify' } }, session,
    workEvents: [{ eventType: 'execution_completed' }], output });
  assert.deepEqual(score.sourceFilesReadCoverage, { read: ['a.csv'], total: 2 });
  assert.equal(score.userRestatementBurden, 1);
  assert.equal(score.exactOutputPath.pass, true);
  assert.equal(score.requiredContentCoverage.pass, false);
  assert.equal(score.completionTruthConsistency.consistent, true);
  assert.equal(score.semantic, 'PM_UNJUDGED');
});
