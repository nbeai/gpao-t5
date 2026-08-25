import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConnectionCredentialCoordinator } from '../src/connection-credential-coordinator.js';
import { ConnectionStateStore, connectionStateKey } from '../src/connection-state-store.js';

function key() {
  return connectionStateKey({ t5UserId: 'user-1', connectionSlotId: 'google-work', service: 'google',
    endpoint: 'https://drivemcp.googleapis.com/mcp/v1', oauthClientId: 't5-google' });
}

function secrets() {
  const values = new Map(); const failures = { set: false, clear: new Set() };
  return { values, failures,
    async get(name) { return structuredClone(values.get(name) ?? null); },
    async set(name, value) { if (failures.set) throw new Error('secret set failed'); values.set(name, structuredClone(value)); },
    async clear(name) { if (failures.clear.has(name)) throw new Error('secret clear failed'); values.delete(name); },
  };
}

test('새 credential은 Keychain prepare 뒤 generation commit되고 이전 generation만 정리된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-credential-coordinator-'));
  try {
    const state = new ConnectionStateStore(join(room, 'connections.sqlite'));
    const secretStore = secrets(); const coordinator = new ConnectionCredentialCoordinator({
      stateStore: state, secretStore, makeId: () => 'prepared1',
    });
    const connectionKey = key(); const lease = state.acquireLease({ connectionKey, ownerId: 'worker', leaseMs: 5_000 });
    const first = await coordinator.commit({ connectionKey, expectedGeneration: 0,
      credential: { accessToken: 'ACCESS-1', refreshToken: 'REFRESH-1' }, issuer: 'https://accounts.google.com',
      identity: { accountId: 'google-account' }, scopes: ['openid'], capabilities: { read: true }, lease });
    assert.equal(first.state.generation, 1); assert.equal(first.cleanupPending, false);
    assert.deepEqual((await coordinator.read(connectionKey)).credential,
      { accessToken: 'ACCESS-1', refreshToken: 'REFRESH-1' });
    const firstRef = first.state.secretRef;

    coordinator.makeId = () => 'prepared2';
    const second = await coordinator.commit({ connectionKey, expectedGeneration: 1,
      credential: { accessToken: 'ACCESS-2', refreshToken: 'REFRESH-2' }, issuer: 'https://accounts.google.com',
      identity: { accountId: 'google-account' }, scopes: ['openid'], capabilities: { read: true }, lease });
    assert.equal(second.state.generation, 2); assert.equal(secretStore.values.has(firstRef), false);
    assert.equal((await coordinator.read(connectionKey)).credential.accessToken, 'ACCESS-2');
    state.close();
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('state commit이 stale이면 준비한 새 secret만 제거하고 기존 ready generation을 보존한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-credential-stale-'));
  try {
    const state = new ConnectionStateStore(join(room, 'connections.sqlite')); const secretStore = secrets();
    const coordinator = new ConnectionCredentialCoordinator({ stateStore: state, secretStore, makeId: () => 'candidate' });
    const connectionKey = key(); const lease = state.acquireLease({ connectionKey, ownerId: 'worker', leaseMs: 5_000 });
    await coordinator.commit({ connectionKey, expectedGeneration: 0, credential: { accessToken: 'GOOD' },
      issuer: 'https://accounts.google.com', identity: { accountId: 'google-account' },
      scopes: ['openid'], capabilities: { read: true }, lease });
    await assert.rejects(coordinator.commit({ connectionKey, expectedGeneration: 0, credential: { accessToken: 'STALE' },
      issuer: 'https://accounts.google.com', identity: { accountId: 'google-account' },
      scopes: ['openid'], capabilities: { read: true }, lease }), /generation is stale/u);
    assert.equal((await coordinator.read(connectionKey)).credential.accessToken, 'GOOD');
    assert.equal([...secretStore.values.values()].some((value) => value.credential?.accessToken === 'STALE'), false);
    state.close();
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('logout state commit 뒤 Keychain 삭제가 실패해도 연결은 cleared이고 과거 token을 다시 읽지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-credential-clear-'));
  try {
    const state = new ConnectionStateStore(join(room, 'connections.sqlite')); const secretStore = secrets();
    const coordinator = new ConnectionCredentialCoordinator({ stateStore: state, secretStore, makeId: () => 'current' });
    const connectionKey = key(); const lease = state.acquireLease({ connectionKey, ownerId: 'worker', leaseMs: 5_000 });
    const ready = await coordinator.commit({ connectionKey, expectedGeneration: 0, credential: { accessToken: 'ACCESS' },
      issuer: 'https://accounts.google.com', identity: { accountId: 'google-account' },
      scopes: ['openid'], capabilities: { read: true }, lease });
    secretStore.failures.clear.add(ready.state.secretRef);
    const cleared = await coordinator.clear({ connectionKey, expectedGeneration: 1, lease });
    assert.equal(cleared.state.state, 'cleared'); assert.equal(cleared.cleanupPending, true);
    assert.equal(await coordinator.read(connectionKey), null);
    assert.equal(secretStore.values.has(ready.state.secretRef), true);
    state.close();
  } finally { await rm(room, { recursive: true, force: true }); }
});
