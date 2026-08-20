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
  const writeSecret = async ({ account, serialized }) => {
    assert.equal(account, 'notion');
    assert.match(serialized, /ACCESS-SECRET/u);
    stored = serialized;
  };
  const store = makePlatformSecretStore({ platform: 'darwin', run, writeSecret });
  await store.set('notion', { accessToken: 'ACCESS-SECRET', refreshToken: 'REFRESH-SECRET' });
  assert.equal((await store.get('notion')).refreshToken, 'REFRESH-SECRET');
  assert.equal(calls.some((call) => call.args[0] === 'find-generic-password'), true);
  assert.equal(calls.some((call) => /ACCESS-SECRET|REFRESH-SECRET/u.test(call.args.join(' '))), false);
  await store.clear('notion');
  assert.equal(await store.get('notion'), null);
});

test('아직 안전한 OS 자격 저장소가 없는 플랫폼은 파일 평문으로 조용히 낮추지 않는다', () => {
  assert.throws(() => makePlatformSecretStore({ platform: 'win32' }), /secure credential store/u);
});

test('macOS security 저장은 비밀을 argv에 넣지 않고 bounded Keychain 조각과 manifest를 사용한다', async () => {
  const source = await readFile(new URL('../src/platform-secret-store.js', import.meta.url), 'utf8');
  assert.match(source, /pty\.spawn/u);
  assert.match(source, /t5\.keychain\.chunks\.v1/u);
  assert.match(source, /sha256/u);
  assert.doesNotMatch(source, /'-w',\s*serialized|-w \$\{serialized\}/u);
});
