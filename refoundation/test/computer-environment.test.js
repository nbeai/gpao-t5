import test from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultMacOSComputerFileRoots, discoverComputerEnvironment, discoverMacOSComputerFileRoots,
} from '../src/computer-environment.js';

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

test('macOS 기본 파일 검색은 사용자 자료 폴더만 열고 다른 앱의 Library 데이터는 건드리지 않는다', () => {
  const roots = defaultMacOSComputerFileRoots('/Users/person');
  assert.deepEqual(roots, [
    '/Users/person/Desktop', '/Users/person/Documents', '/Users/person/Downloads',
    '/Users/person/Movies', '/Users/person/Music', '/Users/person/Pictures', '/Users/person/Public',
    '/Users/Shared', '/Volumes',
  ]);
  assert.equal(roots.includes('/Users/person'), false);
  assert.equal(roots.some((root) => root.includes('/Library')), false);
});

test('macOS 사용자가 만든 최상위 자료 폴더는 포함하되 Library와 숨김 폴더는 제외한다', async () => {
  const entries = [
    { name: 'Library', isDirectory: () => true },
    { name: '.private', isDirectory: () => true },
    { name: 'Projects', isDirectory: () => true },
    { name: 'Documents', isDirectory: () => true },
    { name: 'loose.txt', isDirectory: () => false },
  ];
  const roots = await discoverMacOSComputerFileRoots('/Users/person', async () => entries);
  assert.equal(roots.includes('/Users/person/Projects'), true);
  assert.equal(roots.includes('/Users/person/Documents'), true);
  assert.equal(roots.includes('/Users/person/Library'), false);
  assert.equal(roots.includes('/Users/person/.private'), false);
});
