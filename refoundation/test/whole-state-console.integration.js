import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeConsoleServer } from '../src/console-server.js';
import { restoreWholeStateBundle, wholeStateTreeDigest } from '../src/whole-state-bundle.js';
import { validateT5WholeStateRelationships } from '../src/t5-whole-state.js';

async function allText(root) {
  const output = [];
  async function walk(path) {
    let entries; try { entries = await readdir(path, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const exact = join(path, entry.name); if (entry.isDirectory()) await walk(exact);
      else if (entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith('.jsonl'))) {
        output.push(await readFile(exact, 'utf8').catch(() => ''));
      }
    }
  }
  await walk(root); return output.join('\n');
}

test('설정의 전체 백업은 runtime maintenance에서 암호화 download를 만들고 canonical state를 다시 연다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-whole-console-')); const state = join(room, 'state'); const workspace = join(room, 'workspace');
  await mkdir(workspace);
  const server = makeConsoleServer({ stateDir: state, workspace,
    modelFactory: () => ({ async respond() { return { text: 'unused', toolCalls: [] }; } }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`; const password = 'console backup password';
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const response = await fetch(`${base}/backup/create`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }) });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-disposition'), /T5-whole-state\.t5backup/u);
    const bundle = join(room, 'download.t5backup'); await writeFile(bundle, Buffer.from(await response.arrayBuffer()));
    const destination = join(room, 'destination');
    const restored = await restoreWholeStateBundle({ bundleFile: bundle, password, destinationStateRoot: destination,
      validateRelationships: validateT5WholeStateRelationships });
    assert.equal(restored.restored, true);
    const restoredSessions = JSON.parse(await readFile(join(destination, 'console-sessions.json'), 'utf8'));
    assert.ok(restoredSessions.sessions.some((item) => item.id === session.id));
    assert.doesNotMatch(await allText(state), new RegExp(password, 'u'));
  } finally {
    await server.closeAutomations(); await server.closeMessengers();
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});

test('설정은 전체 백업 범위·secret 제외·암호 분실 책임을 일반 사용자 문장으로 보여준다', async () => {
  const ui = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
  assert.match(ui, /T5 전체 백업/u); assert.match(ui, /비밀값은 포함하지 않아요/u);
  assert.match(ui, /암호를 잊으면 백업을 복원할 수 없어요/u); assert.match(ui, /form\.action = '\/backup\/create'/u);
  assert.match(ui, /전체 백업 복원/u); assert.match(ui, /지금 상태는 되돌릴 사본으로 보존/u);
});

test('복원 upload는 incoming 검증 뒤 activation helper를 예약하고 그 다음 Runtime stop을 요청한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-whole-restore-console-')); const state = join(room, 'state'); const workspace = join(room, 'workspace');
  await mkdir(workspace); let scheduled = null; let stopReason = null;
  const server = makeConsoleServer({ stateDir: state, workspace,
    modelFactory: () => ({ async respond() { return { text: 'unused', toolCalls: [] }; } }),
    scheduleWholeStateActivation: async (value) => { scheduled = value; },
    requestRuntimeStop: async (reason) => { stopReason = reason; } });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`; const password = 'restore console password';
  try {
    await fetch(`${base}/sessions`, { method: 'POST' });
    const backup = await fetch(`${base}/backup/create`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }) }); const bytes = Buffer.from(await backup.arrayBuffer());
    const uploaded = await fetch(`${base}/backup/restore/upload`, { method: 'POST',
      headers: { 'content-type': 'application/vnd.gpao-t5.backup' }, body: bytes }).then((response) => response.json());
    const activated = await fetch(`${base}/backup/restore/activate`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ restoreId: uploaded.restoreId, password }) });
    assert.equal(activated.status, 202); await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(scheduled?.preparedStateRoot); assert.equal(await wholeStateTreeDigest(scheduled.preparedStateRoot), scheduled.stateDigest);
    assert.equal(stopReason, 'product_restore');
    assert.ok((await readdir(scheduled.preparedStateRoot)).includes('console-sessions.json'));
  } finally {
    await server.closeAutomations(); await server.closeMessengers(); await new Promise((resolve) => server.close(resolve));
    if (scheduled?.preparedStateRoot) await rm(scheduled.preparedStateRoot, { recursive: true, force: true });
    await rm(room, { recursive: true, force: true });
  }
});

test('전체 백업은 진행 중 Work를 몰래 중단하지 않고 idle 뒤 재시도를 요구한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-whole-busy-')); const workspace = join(room, 'workspace'); await mkdir(workspace);
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace,
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ respond({ signal }) { return new Promise((resolve, reject) => {
      const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    }); } }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const turn = fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '계속 실행 중인 작업' }) });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const current = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
      if (current.activity?.status === 'running') break; await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const backup = await fetch(`${base}/backup/create`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'busy backup password' }) });
    assert.equal(backup.status, 409); assert.match((await backup.json()).error, /진행 중인 작업/u);
    const cancel = await fetch(`${base}/turn/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id }) }); assert.equal(cancel.status, 200); await turn;
  } finally {
    await server.closeAutomations(); await server.closeMessengers(); await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('복원 전 rollback sibling은 사용자 표면에서 확인하고 같은 atomic activation으로 되돌린다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-whole-rollback-console-')); const state = join(room, 'state'); const workspace = join(room, 'workspace');
  const previous = join(room, 'state.rollback.fixture'); await Promise.all([mkdir(workspace), mkdir(previous)]);
  await writeFile(join(previous, 'console-sessions.json'), JSON.stringify({ version: 1, nextOrder: 1, sessions: [] }));
  let scheduled = null; let stopReason = null;
  const server = makeConsoleServer({ stateDir: state, workspace,
    modelFactory: () => ({ async respond() { return { text: 'unused', toolCalls: [] }; } }),
    scheduleWholeStateActivation: async (value) => { scheduled = value; },
    requestRuntimeStop: async (reason) => { stopReason = reason; } });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/backup/restore/status`).then((response) => response.json())).previousStateAvailable, true);
    const response = await fetch(`${base}/backup/restore/rollback`, { method: 'POST' }); assert.equal(response.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 10)); assert.equal(scheduled.preparedStateRoot, previous);
    assert.equal(stopReason, 'product_restore');
  } finally {
    await server.closeAutomations(); await server.closeMessengers(); await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
