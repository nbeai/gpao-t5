import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { ManagedProcessRegistry } from '../src/managed-process.js';
import {
  quoteWindowsArgument, trustedWindowsSystemExecutable, windowsCommandLine, windowsJobHostLaunch,
} from '../src/windows-process-boundary.js';

test('Windows argv quoting은 공백·따옴표·후행 역슬래시를 CreateProcess command line에 보존한다', () => {
  assert.equal(quoteWindowsArgument('plain'), 'plain');
  assert.equal(quoteWindowsArgument('two words'), '"two words"');
  assert.equal(quoteWindowsArgument('say"hi'), '"say\\"hi"');
  assert.equal(quoteWindowsArgument('C:\\path with space\\'), '"C:\\path with space\\\\"');
  assert.match(windowsCommandLine('C:\\Program Files\\node.exe', ['a b']), /^"C:\\Program Files/u);
});

test('Windows Job host launch는 application·command line·cwd를 direct argv로 분리한다', () => {
  const launch = windowsJobHostLaunch({ host: 'C:\\T5\\t5-job.exe',
    program: 'C:\\Program Files\\PowerShell\\pwsh.exe', args: ['-NoProfile', '-Command', 'echo ok'],
    cwd: 'C:\\Users\\owner\\Work' });
  assert.equal(launch.program, 'C:\\T5\\t5-job.exe');
  assert.deepEqual(launch.args.slice(0, 2), ['--application', 'C:\\Program Files\\PowerShell\\pwsh.exe']);
  assert.equal(launch.boundary.killOnJobClose, true);
  assert.equal(trustedWindowsSystemExecutable('taskkill.exe', { SystemRoot: 'C:\\Windows' }),
    'C:\\Windows\\System32\\taskkill.exe');
});

test('ManagedProcessRegistry는 Windows child를 Job host에 먼저 넣고 qualified receipt를 돌려준다', async () => {
  let observed;
  const spawnProcess = (program, args) => {
    observed = { program, args };
    const child = new EventEmitter(); child.pid = 4821; child.stdout = new PassThrough();
    child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => true;
    queueMicrotask(() => child.emit('close', 0, null));
    return child;
  };
  const registry = new ManagedProcessRegistry({ platform: 'win32', spawnProcess,
    windowsJobHost: 'C:\\T5\\t5-job.exe' });
  const result = await registry.start({ program: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/s', '/c', 'echo ok'], cwd: 'C:\\Work', env: {}, ownerId: 'owner', waitMs: null });
  assert.equal(observed.program, 'C:\\T5\\t5-job.exe');
  assert.equal(observed.args[0], '--application');
  assert.deepEqual(result.processBoundary, {
    kind: 'windows_job_object', qualified: true, killOnJobClose: true,
  });
});

test('Windows Job host가 없으면 taskkill fallback으로 낮추지 않고 실행 전에 닫힌다', async () => {
  let spawned = false;
  const registry = new ManagedProcessRegistry({ platform: 'win32', windowsJobHost: null,
    spawnProcess: () => { spawned = true; } });
  await assert.rejects(registry.start({ program: 'C:\\Windows\\System32\\cmd.exe', args: [],
    cwd: 'C:\\Work', env: {}, ownerId: 'owner' }), { code: 'T5_WINDOWS_JOB_HOST_REQUIRED' });
  assert.equal(spawned, false);
});

test('Windows Job host C source는 suspended child를 assign한 뒤 resume하고 kill-on-close를 쓴다', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(
    new URL('../native/windows/t5-windows-job-host.c', import.meta.url), 'utf8',
  ));
  assert.match(source, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/u);
  assert.match(source, /CryptProtectData/u);
  assert.match(source, /CryptUnprotectData/u);
  assert.match(source, /CREATE_SUSPENDED/u);
  assert.ok(source.indexOf('AssignProcessToJobObject') < source.indexOf('ResumeThread'));
  assert.match(source, /SearchPathW/u);
  assert.match(source, /CreateProcessW\(application, commandLine/u);
});
