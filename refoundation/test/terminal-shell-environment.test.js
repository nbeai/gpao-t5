import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';

import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeExecTool } from '../src/exec-tool.js';
import {
  parseCapturedTerminalPath, resolveTerminalShellEnvironment,
} from '../src/terminal-shell-environment.js';

test('safe login capture는 startup 출력에서 PATH marker만 채택하고 비밀·잡음을 버린다', async () => {
  const fallback = ['/usr/bin', '/bin'].join(delimiter);
  const expected = ['/opt/user/bin', '/usr/bin'].join(delimiter);
  const environment = await resolveTerminalShellEnvironment({
    computer: discoverComputerEnvironment({ platform: 'darwin', userHome: '/isolated' }),
    home: '/isolated', baseEnv: { PATH: fallback },
    capture: async () => `TOKEN=must-not-survive\n__T5_SAFE_LOGIN_PATH__=${expected}\nPRIVATE KEY`,
  });
  assert.equal(environment.PATH, expected);
  assert.equal(environment.HOME, '/isolated');
  assert.equal(environment.ZDOTDIR, '/isolated');
  assert.equal(environment.source, 'login_shell_safe_path');
  assert.doesNotMatch(JSON.stringify(environment), /must-not-survive|PRIVATE KEY/u);
});

test('login capture 실패와 malformed PATH는 비밀 없는 현재 PATH로 degraded된다', async () => {
  const fallback = ['/usr/local/bin', '/usr/bin'].join(delimiter);
  const computer = discoverComputerEnvironment({ platform: 'darwin', userHome: '/isolated' });
  const failed = await resolveTerminalShellEnvironment({
    computer, home: '/isolated', baseEnv: { PATH: fallback },
    capture: async () => { throw new Error('startup echoed secret'); },
  });
  assert.equal(failed.PATH, fallback);
  assert.equal(failed.source, 'fallback');
  assert.equal(parseCapturedTerminalPath('__T5_SAFE_LOGIN_PATH__=bad\u0000path', fallback), fallback);
});

test('Windows command runtime은 profile을 열지 않고 safe PATH·HOME만 사용한다', async () => {
  let captureCalls = 0;
  const computer = discoverComputerEnvironment({
    platform: 'win32', userHome: 'C:\\Users\\fixture',
    env: { ComSpec: 'cmd.exe', PATH: 'C:\\Windows\\System32' },
  });
  const environment = await resolveTerminalShellEnvironment({
    computer, home: 'C:\\Users\\fixture', baseEnv: { PATH: 'C:\\Windows\\System32' },
    capture: async () => { captureCalls += 1; return ''; },
  });
  assert.equal(captureCalls, 0);
  assert.deepEqual(computer.commandRuntime.argsFor('echo ok'), ['/d', '/s', '/c', 'echo ok']);
  assert.equal(environment.HOME, 'C:\\Users\\fixture');
});

test('model command는 login profile이 HOME을 바꿀 기회를 받지 않고 configured HOME에서 실행된다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-terminal-non-login-'));
  const fakeShell = join(root, 'fake-shell');
  await writeFile(fakeShell, [
    '#!/bin/sh',
    'flags="$1"',
    'shift',
    'case "$flags" in *l*) export HOME=/escaped-real-home ;; esac',
    'exec /bin/sh -c "$1"',
  ].join('\n'), { mode: 0o700 });
  await chmod(fakeShell, 0o700);
  try {
    const computer = discoverComputerEnvironment({
      platform: 'darwin', userHome: root,
      env: { SHELL: fakeShell, T5_REFOUNDATION_SHELL: fakeShell },
    });
    assert.deepEqual(computer.commandRuntime.argsFor('printf ok'), ['-c', 'printf ok']);
    const result = await makeExecTool({ workspace: root, computer }).execute({
      command: 'printf %s "$HOME"', cwd: null,
      effect: { kind: 'observe', summary: 'HOME 확인', targets: [], reversible: true,
        backupAvailable: false, recipientNew: false, approvalToken: null },
    });
    assert.equal(result.stdout, await realpath(root));
  } finally { await rm(root, { recursive: true, force: true }); }
});
