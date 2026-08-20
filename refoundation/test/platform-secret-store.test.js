import test from 'node:test';
import assert from 'node:assert/strict';

import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { readFile } from 'node:fs/promises';

test('macOS Keychain adapter는 비밀을 argv에 넣지 않고 stdin으로 저장한다', async () => {
  const calls = [];
  let stored = null;
  const run = async (file, args, { input } = {}) => {
    calls.push({ file, args: [...args], input });
    if (args[0] === 'add-generic-password') { stored = input.trim(); return { exitCode: 0, stdout: '', stderr: '' }; }
    if (args[0] === 'find-generic-password') {
      return stored == null ? { exitCode: 44, stdout: '', stderr: '' }
        : { exitCode: 0, stdout: `${stored}\n`, stderr: '' };
    }
    if (args[0] === 'delete-generic-password') { stored = null; return { exitCode: 0, stdout: '', stderr: '' }; }
    throw new Error('unexpected command');
  };
  const store = makePlatformSecretStore({ platform: 'darwin', run });
  await store.set('notion', { accessToken: 'ACCESS-SECRET', refreshToken: 'REFRESH-SECRET' });
  assert.equal(calls[0].file, '/usr/bin/security');
  assert.equal(calls[0].args.at(-1), '-w');
  assert.doesNotMatch(calls[0].args.join(' '), /ACCESS-SECRET|REFRESH-SECRET/u);
  assert.match(calls[0].input, /ACCESS-SECRET/);
  assert.equal((await store.get('notion')).refreshToken, 'REFRESH-SECRET');
  await store.clear('notion');
  assert.equal(await store.get('notion'), null);
});

test('아직 안전한 OS 자격 저장소가 없는 플랫폼은 파일 평문으로 조용히 낮추지 않는다', () => {
  assert.throws(() => makePlatformSecretStore({ platform: 'win32' }), /secure credential store/u);
});

test('macOS security는 보이지 않는 TTY prompt 대신 stdin을 읽도록 별도 process session에서 실행된다', async () => {
  const source = await readFile(new URL('../src/platform-secret-store.js', import.meta.url), 'utf8');
  assert.match(source, /detached:\s*true/u);
  assert.doesNotMatch(source, /-w',\s*serialized|'-w',\s*serialized/u);
});
