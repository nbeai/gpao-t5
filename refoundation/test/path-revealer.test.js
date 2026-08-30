import test from 'node:test';
import assert from 'node:assert/strict';

import { makePathRevealer, revealInvocation } from '../src/path-revealer.js';

test('macOS 파일과 폴더는 Finder 호출로 변환한다', () => {
  assert.deepEqual(revealInvocation('darwin', '/tmp/report.txt', 'file'), {
    program: 'open', args: ['-R', '/tmp/report.txt'],
  });
  assert.deepEqual(revealInvocation('darwin', '/tmp/reports', 'directory'), {
    program: 'open', args: ['/tmp/reports'],
  });
});

test('Windows 파일과 폴더는 Explorer 호출로 변환한다', () => {
  assert.deepEqual(revealInvocation('win32', 'C:\\Temp\\report.txt', 'file'), {
    program: 'explorer.exe', args: ['/select,C:\\Temp\\report.txt'],
  });
  assert.deepEqual(revealInvocation('win32', 'C:\\Temp', 'directory'), {
    program: 'explorer.exe', args: ['C:\\Temp'],
  });
});

test('삭제된 경로를 누르면 가장 가까운 존재하는 상위 폴더를 연다', async () => {
  const calls = [];
  const reveal = makePathRevealer({
    platform: 'darwin',
    statPath: async (path) => {
      if (path === '/tmp') return { isDirectory: () => true };
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    },
    spawnProcess: (program, args) => {
      calls.push({ program, args });
      return { unref() {} };
    },
  });
  const result = await reveal('/tmp/deleted/report.txt');
  assert.deepEqual(calls, [{ program: 'open', args: ['/tmp'] }]);
  assert.equal(result.openedPath, '/tmp');
  assert.equal(result.targetType, 'nearest_existing_parent');
});

test('홈 축약 경로는 현재 컴퓨터의 userHome으로 확장해 연다', async () => {
  const calls = [];
  const reveal = makePathRevealer({
    platform: 'darwin', userHome: '/Users/person',
    statPath: async (path) => {
      assert.equal(path, '/Users/person/Downloads/report.pdf');
      return { isDirectory: () => false };
    },
    spawnProcess: (program, args) => {
      calls.push({ program, args });
      return { unref() {} };
    },
  });
  const result = await reveal('~/Downloads/report.pdf');
  assert.deepEqual(calls, [{
    program: 'open', args: ['-R', '/Users/person/Downloads/report.pdf'],
  }]);
  assert.equal(result.requestedPath, '/Users/person/Downloads/report.pdf');
});

test('검색 결과 제목 reveal은 exact file identity가 바뀌거나 사라지면 부모 폴더를 열지 않는다', async () => {
  const calls = [];
  const reveal = makePathRevealer({ platform: 'darwin', userHome: '/Users/person',
    statPath: async () => ({ isDirectory: () => false, size: 43,
      mtime: new Date('2026-08-30T00:00:00.000Z') }),
    spawnProcess: (program, args) => { calls.push({ program, args }); return { unref() {} }; } });
  await assert.rejects(() => reveal('~/Downloads/report.pdf', { exactFile: true, bytes: 42,
    modifiedAt: '2026-08-30T00:00:00.000Z' }), /identity changed/u);
  assert.deepEqual(calls, []);
});
