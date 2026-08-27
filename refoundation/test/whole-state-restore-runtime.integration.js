import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { stopLocalRuntime } from '../src/local-runtime-lifecycle.js';

const ensure = resolve(import.meta.dirname, '../scripts/ensure-local-runtime.mjs');
async function runEnsure(environment) {
  const child = spawn(process.execPath, [ensure], { cwd: resolve(import.meta.dirname, '../..'), env: environment, stdio: 'ignore' });
  const code = await new Promise((resolveExit, rejectExit) => { child.once('error', rejectExit); child.once('close', resolveExit); });
  if (code !== 0) throw new Error(`ensure runtime exited ${code}`);
}
async function connect(port) {
  const root = await fetch(`http://127.0.0.1:${port}/`); const cookie = root.headers.get('set-cookie')?.split(';', 1)[0]; await root.text();
  return { base: `http://127.0.0.1:${port}`, cookie, headers: { cookie, origin: `http://127.0.0.1:${port}` } };
}
async function waitReplacement(portFile, oldPid) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const fact = JSON.parse(await readFile(portFile, 'utf8'));
      if (fact.pid !== oldPid) {
        const health = await fetch(`http://127.0.0.1:${fact.port}/health`).then((response) => response.json()).catch(() => null);
        if (health?.ok) return fact;
      }
    } catch { /* old runtime is between stop and replacement */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('restored runtime did not become healthy');
}

test('실제 resident Runtime은 검증된 incoming을 원자 활성화하고 복원 상태로 다시 선다', { timeout: 60_000 }, async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-whole-runtime-restore-')); const home = join(room, 'home');
  const state = join(room, 'state'); const workspace = join(room, 'workspace'); const portFile = join(state, 'console-port.json');
  await Promise.all([mkdir(home), mkdir(workspace)]); let currentPid = null;
  const environment = { ...process.env, HOME: home, PATH: '/usr/bin:/bin',
    T5_REFOUNDATION_CONSOLE_STATE: state, T5_REFOUNDATION_WORKSPACE: workspace,
    T5_REFOUNDATION_MODEL_CONNECTION_FILE: join(room, 'credentials', 'model-connection.json'),
    T5_REFOUNDATION_PORT_FILE: portFile, T5_FILE_ACTIVITY_HELPER: join(room, 'missing-file-helper'),
    T5_APP_ACTIVITY_HELPER: join(room, 'missing-app-helper') };
  try {
    await runEnsure(environment); const first = JSON.parse(await readFile(portFile, 'utf8')); currentPid = first.pid;
    const firstConnection = await connect(first.port);
    const sessionA = await fetch(`${firstConnection.base}/sessions`, { method: 'POST', headers: firstConnection.headers }).then((response) => response.json());
    const password = 'runtime restore password';
    const backupResponse = await fetch(`${firstConnection.base}/backup/create`, { method: 'POST',
      headers: { ...firstConnection.headers, 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
    const backup = Buffer.from(await backupResponse.arrayBuffer());
    const sessionB = await fetch(`${firstConnection.base}/sessions`, { method: 'POST', headers: firstConnection.headers }).then((response) => response.json());
    const upload = await fetch(`${firstConnection.base}/backup/restore/upload`, { method: 'POST',
      headers: { ...firstConnection.headers, 'content-type': 'application/vnd.gpao-t5.backup' }, body: backup }).then((response) => response.json());
    const activate = await fetch(`${firstConnection.base}/backup/restore/activate`, { method: 'POST',
      headers: { ...firstConnection.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ restoreId: upload.restoreId, password }) });
    assert.equal(activate.status, 202);
    const replacement = await waitReplacement(portFile, first.pid); currentPid = replacement.pid;
    const restoredConnection = await connect(replacement.port);
    const sessions = await fetch(`${restoredConnection.base}/sessions`, { headers: restoredConnection.headers }).then((response) => response.json());
    assert.ok(sessions.sessions.some((item) => item.id === sessionA.id));
    assert.equal(sessions.sessions.some((item) => item.id === sessionB.id), false);
    const rollbackName = (await readdir(room)).find((name) => name.startsWith('state.rollback.'));
    assert.ok(rollbackName); const rollback = JSON.parse(await readFile(join(room, rollbackName, 'console-sessions.json'), 'utf8'));
    assert.ok(rollback.sessions.some((item) => item.id === sessionB.id));
  } finally {
    await stopLocalRuntime({ portFile, reason: 'product_update' }).catch(() => {});
    await rm(room, { recursive: true, force: true });
  }
});
