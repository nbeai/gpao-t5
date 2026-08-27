import test from 'node:test';
import assert from 'node:assert/strict';

import { discoverComputerEnvironment } from '../src/computer-environment.js';

test('제품 의미와 분리된 환경 발견기가 POSIX 컴퓨터의 실제 셸을 사용한다', () => {
  const computer = discoverComputerEnvironment({
    platform: 'linux', architecture: 'x64', userHome: '/home/person', env: { SHELL: '/bin/zsh' },
  });
  assert.equal(computer.platform, 'linux');
  assert.equal(computer.userHome, '/home/person');
  assert.equal(computer.commandRuntime.family, 'posix');
  assert.equal(computer.commandRuntime.program, '/bin/zsh');
  assert.deepEqual(computer.commandRuntime.argsFor('pwd'), ['-c', 'pwd']);
});

test('Windows 컴퓨터에서는 같은 exec 손이 현재 명령 처리기를 사용한다', () => {
  const computer = discoverComputerEnvironment({
    platform: 'win32', architecture: 'arm64', userHome: 'C:\\Users\\person',
    env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
  });
  assert.equal(computer.platform, 'win32');
  assert.equal(computer.commandRuntime.family, 'cmd');
  assert.equal(computer.commandRuntime.program, 'C:\\Windows\\System32\\cmd.exe');
  assert.ok(computer.commandRuntime.environmentKeys.includes('SystemRoot'));
  assert.ok(computer.commandRuntime.environmentKeys.includes('PATHEXT'));
  assert.deepEqual(computer.commandRuntime.argsFor('cd'), ['/d', '/s', '/c', 'cd']);
});
