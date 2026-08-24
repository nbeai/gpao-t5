import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MessengerPlatformCredentialStore, migrateMessengerCredentials,
} from '../src/messenger-platform-credential-store.js';
import { MessengerCredentialStore } from '../src/messenger-credential-store.js';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function memorySecrets() {
  const values = new Map();
  return {
    values,
    async get(name) { return structuredClone(values.get(name) ?? null); },
    async set(name, value) { values.set(name, structuredClone(value)); },
    async clear(name) { values.delete(name); },
  };
}

test('Messenger credential은 platform secret owner에만 저장하고 공개 상태에는 token을 투영하지 않는다', async () => {
  const secrets = memorySecrets();
  const store = new MessengerPlatformCredentialStore(secrets);
  const token = '123456:HP07-CANARY-SECRET';
  await store.setVerified('telegram', {
    token, bot: { id: '77', username: 't5_bot' }, verifiedAt: 123,
  });

  assert.equal(secrets.values.get('messenger-telegram').token, token);
  assert.equal((await store.get('telegram')).token, token, 'provider capability keeps working');
  const status = await store.describe();
  assert.deepEqual(status.telegram, {
    connected: true, bot: { id: '77', username: 't5_bot' }, verifiedAt: 123,
  });
  assert.doesNotMatch(JSON.stringify(status), /HP07-CANARY-SECRET/u);

  await store.clear('telegram');
  assert.equal(await store.get('telegram'), null);
});

test('credential rotation은 공개 identity를 갱신하되 이전 secret을 남기지 않는다', async () => {
  const secrets = memorySecrets();
  const store = new MessengerPlatformCredentialStore(secrets);
  await store.setVerified('telegram', { token: 'old-secret', bot: { id: '1', username: 'old' } });
  await store.setVerified('telegram', { token: 'new-secret', bot: { id: '2', username: 'new' } });
  assert.equal((await store.get('telegram')).token, 'new-secret');
  assert.doesNotMatch(JSON.stringify(await store.describe()), /old-secret|new-secret/u);
});

test('기존 평문 Messenger credential은 platform store 검증 뒤에만 원본을 제거한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-secret-migration-'));
  const source = new MessengerCredentialStore(room); const secrets = memorySecrets();
  const target = new MessengerPlatformCredentialStore(secrets);
  await source.setVerified('telegram', {
    token: 'legacy-canary-secret', bot: { id: '7', username: 'legacy' }, verifiedAt: 99,
  });
  assert.deepEqual(await migrateMessengerCredentials({ source, target }), { migrated: ['telegram'] });
  assert.equal((await target.get('telegram')).token, 'legacy-canary-secret');
  assert.equal(await source.get('telegram'), null);
  await assert.rejects(() => stat(source.file), (error) => error.code === 'ENOENT');
});

test('platform secret 저장 검증이 실패하면 기존 credential을 지우지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-secret-migration-fail-'));
  const source = new MessengerCredentialStore(room);
  await source.setVerified('telegram', { token: 'keep-me', bot: { id: '8', username: 'kept' } });
  const target = { async setVerified() {}, async get() { return null; } };
  await assert.rejects(() => migrateMessengerCredentials({ source, target }), /verification failed/u);
  assert.equal((await source.get('telegram')).token, 'keep-me');
});
