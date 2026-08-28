import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ManagedProcessRegistry } from '../src/managed-process.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exists = (path) => access(path).then(() => true, () => false);
const quote = (value) => `'${String(value).replaceAll("'", `'\"'\"'`)}'`;

test('S4-D4A RED: macOS Runtime SIGKILL 뒤 managed process group은 late effect 전에 종료된다', {
  timeout: 5000, skip: process.platform !== 'darwin',
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-d4a-parent-death-'));
  const marker = join(root, 'late-effect'); const pidFile = join(root, 'pid');
  const command = `printf '%s' "$$" > ${quote(pidFile)}; sleep 0.50; printf late > ${quote(marker)}; sleep 5`;
  const inner = `
    import { ManagedProcessRegistry } from ${JSON.stringify(new URL('../src/managed-process.js', import.meta.url).href)};
    const registry = new ManagedProcessRegistry();
    const started = await registry.start({ program: '/bin/sh', args: ['-lc', ${JSON.stringify(command)}],
      cwd: ${JSON.stringify(root)}, env: process.env, ownerId: 'runtime', waitMs: 10,
      metadata: { kind: 'managed', originRunId: 'run' } });
    process.stdout.write(JSON.stringify({ processId: started.processId, state: started.state }) + '\\n');
    setInterval(() => {}, 1000);
  `;
  const runtime = spawn(process.execPath, ['--input-type=module', '-e', inner], {
    cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; runtime.stdout.setEncoding('utf8'); runtime.stdout.on('data', (chunk) => { output += chunk; });
  let managedPid = null;
  try {
    for (let attempt = 0; attempt < 100 && (!output.includes('\n') || !(await exists(pidFile))); attempt += 1) {
      await delay(10);
    }
    assert.ok(output.includes('\n')); managedPid = Number(await readFile(pidFile, 'utf8'));
    runtime.kill('SIGKILL'); await new Promise((resolve) => runtime.once('close', resolve));
    await delay(800);
    assert.equal(await exists(marker), false);
    let alive = false; try { process.kill(managedPid, 0); alive = true; } catch { alive = false; }
    assert.equal(alive, false);
  } finally {
    if (runtime.exitCode == null && runtime.signalCode == null) runtime.kill('SIGKILL');
    if (managedPid) { try { process.kill(-managedPid, 'SIGKILL'); } catch { /* exact test group */ } }
    await rm(root, { recursive: true, force: true });
  }
});

test('S4-D4A 양성 대조: Runtime이 살아 있으면 managed process의 정상 effect와 output을 보존한다', {
  timeout: 3000, skip: process.platform !== 'darwin',
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-d4a-alive-')); const marker = join(root, 'normal-effect');
  const registry = new ManagedProcessRegistry();
  try {
    const result = await registry.start({ program: '/bin/sh',
      args: ['-lc', `printf normal-output; printf normal > ${quote(marker)}`],
      cwd: root, env: process.env, ownerId: 'runtime', waitMs: null,
      metadata: { kind: 'managed', originRunId: 'run' } });
    assert.equal(result.state, 'completed'); assert.equal(result.stdout, 'normal-output');
    assert.deepEqual(result.processBoundary, {
      kind: 'macos_parent_death_process_group', qualified: true,
    });
    assert.equal(await exists(marker), true);
  } finally { await registry.stopAll('test_cleanup'); await rm(root, { recursive: true, force: true }); }
});

test('S4-D4A helper 부재는 보호 없는 macOS managed 실행으로 낮추지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-d4a-missing-host-'));
  const registry = new ManagedProcessRegistry({ platform: 'darwin',
    macosParentDeathHost: join(root, 'missing-host.mjs') });
  try {
    await assert.rejects(() => registry.start({ program: '/bin/sh', args: ['-lc', 'printf unsafe'],
      cwd: root, env: process.env, ownerId: 'runtime', waitMs: null }), {
      code: 'T5_MACOS_PARENT_DEATH_HOST_REQUIRED',
    });
    assert.equal(registry.list('runtime').length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
