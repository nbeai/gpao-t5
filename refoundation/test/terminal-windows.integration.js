import assert from 'node:assert/strict';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import test from 'node:test';

import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeExecTool, makeProcessControlTool, makeProcessStartTool } from '../src/exec-tool.js';
import { makePtyStartTool } from '../src/pty-tool.js';

const effect = { kind: 'observe', targets: [], confirmation: 'not_applicable' };
const ps = (value) => `'${String(value).replaceAll("'", "''")}'`;

test('Windows runner는 PowerShell·Job Object tree cancel·ConPTY를 실제 자격한다', async (context) => {
  if (process.platform !== 'win32') return context.skip('Windows runner qualification');
  const root = await mkdtemp(join(tmpdir(), 't5-windows-terminal-live-'));
  const powershell = win32.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const computer = discoverComputerEnvironment({ platform: 'win32', userHome: root,
    env: { ...process.env, T5_REFOUNDATION_SHELL: powershell } });
  const marker = join(root, 'late-marker.txt');
  const childScript = join(root, 'child.mjs'); const parentScript = join(root, 'parent.mjs');
  const ttyScript = join(root, 'tty.mjs');
  await writeFile(childScript, "import{writeFile}from'node:fs/promises';setTimeout(async()=>{await writeFile(process.argv[2],'late');process.exit(0)},1200);\n");
  await writeFile(parentScript, "import{spawn}from'node:child_process';spawn(process.execPath,[process.argv[2],process.argv[3]],{stdio:'ignore'});setInterval(()=>{},1000);\n");
  await writeFile(ttyScript, "if(!process.stdin.isTTY){process.exit(42)}process.stdout.write('READY>');process.stdin.once('data',v=>{console.log('VALUE='+v.toString().trim());process.exit(0)});\n");
  const exec = makeExecTool({ workspace: root, computer });
  try {
    const observed = await exec.execute({ command: "Write-Output 'WINDOWS-OBSERVED-42'", cwd: null, effect });
    assert.equal(observed.exitCode, 0); assert.match(observed.stdout, /WINDOWS-OBSERVED-42/u);
    assert.equal(observed.processBoundary?.kind, 'windows_job_object');

    const start = makeProcessStartTool({ workspace: root, computer,
      processRegistry: exec.processRegistry, ownerId: 'windows-owner', yieldMs: 100 });
    const running = await start.execute({ command: `& ${ps(process.execPath)} ${ps(parentScript)} ${ps(childScript)} ${ps(marker)}`,
      cwd: null, effect });
    assert.equal(running.state, 'running'); assert.equal(running.processBoundary?.qualified, true);
    const control = makeProcessControlTool({ processRegistry: exec.processRegistry, ownerId: 'windows-owner' });
    const stopped = await control.execute({ action: 'stop', processId: running.processId,
      cursor: running.cursor, input: null, end: null, waitMs: null, cols: null, rows: null });
    assert.equal(stopped.state, 'stopped'); assert.equal(stopped.terminationConfirmed, true);
    await new Promise((resolve) => setTimeout(resolve, 1500)); await assert.rejects(access(marker));

    const pty = makePtyStartTool({ workingDirectory: root, computer,
      processRegistry: exec.processRegistry, ownerId: 'windows-pty', yieldMs: 100 });
    let current = await pty.execute({ command: `& ${ps(process.execPath)} ${ps(ttyScript)}`,
      cwd: null, effect, cols: 80, rows: 24 });
    const ptyControl = makeProcessControlTool({ processRegistry: exec.processRegistry, ownerId: 'windows-pty' });
    let output = current.stdout;
    await ptyControl.execute({ action: 'write', processId: current.processId, cursor: current.cursor,
      input: 'hello-windows\r', end: false, waitMs: null, cols: null, rows: null });
    for (let attempt = 0; attempt < 10 && current.state === 'running'; attempt += 1) {
      current = await ptyControl.execute({ action: 'poll', processId: current.processId, cursor: current.cursor,
        input: null, end: null, waitMs: 1000, cols: null, rows: null }); output += current.stdout;
    }
    assert.equal(current.state, 'completed'); assert.match(output, /VALUE=hello-windows/u);
  } finally { await exec.processRegistry.stopAll('windows_test_cleanup'); await rm(root, { recursive: true, force: true }); }
});
