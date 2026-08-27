import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { readFile } from 'node:fs/promises';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('설정 화면은 실제 기본·관리 스킬과 현재 기억을 같은 서버 상태로 보여준다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-settings-truth-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const server = makeConsoleServer({
    stateDir, workspace,
    modelFactory: () => ({ async respond() { return { text: 'ok', toolCalls: [] }; } }),
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'test-model' }),
  });
  const base = await listen(server);
  try {
    await server.memoryLedger.ensure();
    const remembered = await server.memoryLedger.add({ kind: 'user', content: '사용자는 따뜻한 라떼를 좋아한다.' });
    await (await server.managedSkillStore).install('xurl');
    const skills = await fetch(`${base}/skills`).then((response) => response.json());
    assert.equal(skills.skills.find((skill) => skill.id === 'file-discovery').state, 'admitted');
    assert.equal(skills.skills.find((skill) => skill.id === 'xurl').state, 'admitted');
    assert.equal(skills.skills.find((skill) => skill.id === 'github-workflow').state, 'available');
    const overview = await fetch(`${base}/overview`).then((response) => response.json());
    assert.deepEqual(overview.preferences.reflected, [{
      id: remembered.memoryId, statement: remembered.content, kind: 'user',
    }]);
    assert.ok(overview.skills.active.some((skill) => skill.id === 'file-discovery'));
    assert.ok(overview.connections.ready.some((connection) => connection.id === 'model'));
    const forgotten = await fetch(`${base}/memory/rollback`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ candidateId: remembered.memoryId }),
    }).then((response) => response.json());
    assert.equal(forgotten.receiptWritten, true);
    assert.deepEqual((await fetch(`${base}/memory/state`).then((response) => response.json())).items, []);
  } finally {
    await server.closeBrowsers();
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('종료 때 응답하지 않는 브라우저도 짧게 중단하고 서버 종료를 막지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-browser-close-bound-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  let closeSignal = null;
  const server = makeConsoleServer({
    stateDir, workspace,
    modelFactory: () => ({ async respond() { return { text: 'ok', toolCalls: [] }; } }),
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'test-model' }),
    browserDriverFactory: () => ({
      async available() { return { available: false }; },
      async close({ signal } = {}) {
        closeSignal = signal;
        await new Promise((resolve) => signal?.addEventListener('abort', resolve, { once: true }));
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      },
    }),
  });
  const base = await listen(server);
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '확인' }) });
    const started = Date.now();
    await server.closeBrowsers();
    assert.ok(Date.now() - started < 3_000);
    assert.equal(closeSignal?.aborted, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('제품 실행기는 외부 연결과 열린 HTTP 연결이 멈춰도 종료 전체를 제한한다', async () => {
  const source = await readFile(new URL('../scripts/start-console.mjs', import.meta.url), 'utf8');
  assert.match(source, /boundedShutdown\(\(\) => server\.closeMessengers\(\), shutdownBudget\.channel\)/u);
  assert.match(source, /boundedShutdown\(\(\) => server\.closeWorkspaceConnections\(\), shutdownBudget\.resources\)/u);
  assert.match(source, /server\.closeAllConnections\?\.\(\)/u);
  assert.match(source, /if \(stopping\) return/u);
});
