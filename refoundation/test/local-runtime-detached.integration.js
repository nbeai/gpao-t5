import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { stopLocalRuntime } from '../src/local-runtime-lifecycle.js';

const helper = resolve(import.meta.dirname, '../scripts/ensure-local-runtime.mjs');

async function runHelper(environment) {
  const child = spawn(process.execPath, [helper], {
    cwd: resolve(import.meta.dirname, '../..'), env: environment, stdio: 'ignore',
  });
  return new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL'); rejectExit(new Error('runtime attach helper timed out'));
    }, 50_000);
    child.once('error', rejectExit);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolveExit();
      else rejectExit(new Error(`runtime attach helper exited ${code ?? signal}`));
    });
  });
}

async function waitForExit(pid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); }
    catch (error) { if (error?.code === 'ESRCH') return true; throw error; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  return false;
}

test('UI bootstrap이 끝나도 Runtime은 남고 다음 UI는 같은 owner에 attach한다', { timeout: 70_000 }, async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-detached-runtime-'));
  const home = join(room, 'home'); const state = join(room, 'state'); const workspace = join(room, 'workspace');
  const portFile = join(state, 'console-port.json'); let runtimePid = null;
  await Promise.all([mkdir(home, { recursive: true }), mkdir(workspace, { recursive: true })]);
  const environment = {
    ...process.env,
    HOME: home,
    PATH: '/usr/bin:/bin',
    T5_REFOUNDATION_CONSOLE_STATE: state,
    T5_REFOUNDATION_WORKSPACE: workspace,
    T5_REFOUNDATION_MODEL_CONNECTION_FILE: join(room, 'credentials', 'model-connection.json'),
    T5_REFOUNDATION_PORT_FILE: portFile,
    T5_FILE_ACTIVITY_HELPER: join(room, 'missing-file-activity-helper'),
    T5_APP_ACTIVITY_HELPER: join(room, 'missing-app-activity-helper'),
  };
  try {
    await runHelper(environment);
    const first = JSON.parse(await readFile(portFile, 'utf8')); runtimePid = first.pid;
    assert.ok(Number.isSafeInteger(runtimePid) && runtimePid > 0);
    process.kill(runtimePid, 0);
    const health = await fetch(`http://127.0.0.1:${first.port}/health`).then((response) => response.json());
    assert.equal(health.ok, true);

    await runHelper(environment);
    const second = JSON.parse(await readFile(portFile, 'utf8'));
    assert.equal(second.pid, runtimePid);
    process.kill(runtimePid, 0);

    const root = await fetch(`http://127.0.0.1:${second.port}/`);
    const cookie = root.headers.get('set-cookie')?.split(';', 1)[0]; await root.text();
    const stopped = await fetch(`http://127.0.0.1:${second.port}/runtime/stop`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie,
        origin: `http://127.0.0.1:${second.port}` }, body: JSON.stringify({ confirm: true }),
    });
    assert.equal(stopped.status, 202);
    assert.equal((await stopped.json()).stopping, true);
    assert.equal(await waitForExit(runtimePid), true);
    await assert.rejects(() => readFile(portFile), { code: 'ENOENT' });

    await runHelper(environment);
    const replacement = JSON.parse(await readFile(portFile, 'utf8')); runtimePid = replacement.pid;
    assert.equal((await stopLocalRuntime({ portFile, reason: 'product_update' })).stopped, true);
    assert.equal(await waitForExit(runtimePid), true);
    await assert.rejects(() => readFile(portFile), { code: 'ENOENT' });

    await runHelper(environment);
    const crashed = JSON.parse(await readFile(portFile, 'utf8')); runtimePid = crashed.pid;
    process.kill(runtimePid, 'SIGKILL'); assert.equal(await waitForExit(runtimePid), true);
    await runHelper(environment);
    const recovered = JSON.parse(await readFile(portFile, 'utf8')); runtimePid = recovered.pid;
    const continuity = JSON.parse(await readFile(join(state, 'runtime-continuity', 'events.json'), 'utf8'));
    const recoveryStart = continuity.events.filter((event) => event.type === 'runtime_started').at(-1);
    assert.equal(recoveryStart.previousDisposition, 'interrupted');
    assert.equal(recoveryStart.executionClaimedDuringDowntime, false);
    await stopLocalRuntime({ portFile, reason: 'product_update' });
  } finally {
    if (runtimePid) {
      try { process.kill(runtimePid, 'SIGTERM'); } catch (error) { if (error?.code !== 'ESRCH') throw error; }
      if (!await waitForExit(runtimePid)) {
        try { process.kill(runtimePid, 'SIGKILL'); } catch (error) { if (error?.code !== 'ESRCH') throw error; }
        await waitForExit(runtimePid);
      }
    }
    await rm(room, { recursive: true, force: true });
  }
});
