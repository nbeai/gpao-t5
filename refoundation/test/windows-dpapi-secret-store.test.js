import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeWindowsDpapiSecretStore } from '../src/windows-dpapi-secret-store.js';

test('Windows DPAPI store 계약은 평문을 디스크에 쓰지 않고 재시작·삭제를 보존한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-windows-dpapi-contract-'));
  const protect = async (plain) => Buffer.from(`sealed:${plain}`).toString('base64');
  const unprotect = async (cipher) => Buffer.from(cipher, 'base64').toString('utf8').slice('sealed:'.length);
  try {
    const store = makeWindowsDpapiSecretStore({ directory: room, protect, unprotect });
    await store.set('model-secret', { token: 'SECRET-7391' });
    const disk = await readFile(join(room, 'model-secret.dpapi'), 'utf8');
    assert.doesNotMatch(disk, /SECRET-7391/u);
    const restarted = makeWindowsDpapiSecretStore({ directory: room, protect, unprotect });
    assert.deepEqual(await restarted.get('model-secret'), { token: 'SECRET-7391' });
    await restarted.clear('model-secret');
    assert.equal(await restarted.get('model-secret'), null);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('실제 Windows runner는 CurrentUser DPAPI로 암호화·재개방한다', async (context) => {
  if (process.platform !== 'win32') return context.skip('Windows DPAPI qualification');
  const room = await mkdtemp(join(tmpdir(), 't5-windows-dpapi-live-'));
  try {
    const store = makeWindowsDpapiSecretStore({ directory: room, program: process.env.T5_WINDOWS_JOB_HOST });
    await store.set('live-secret', { token: 'WINDOWS-DPAPI-4821' });
    assert.deepEqual(await store.get('live-secret'), { token: 'WINDOWS-DPAPI-4821' });
    assert.doesNotMatch(await readFile(join(room, 'live-secret.dpapi'), 'utf8'), /WINDOWS-DPAPI-4821/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});
