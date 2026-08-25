import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConnectionStateStore, connectionStateKey } from '../src/connection-state-store.js';

function key(service, slot = 'account-a') {
  return connectionStateKey({ t5UserId: 'user-1', connectionSlotId: slot, service,
    endpoint: `https://${service}.example/mcp`, oauthClientId: `t5-${service}` });
}

function childLease(moduleUrl, file, ownerId, connectionKey) {
  const source = `import { ConnectionStateStore } from ${JSON.stringify(moduleUrl)};
    const store = new ConnectionStateStore(${JSON.stringify(file)});
    const lease = store.acquireLease({ connectionKey: ${JSON.stringify(connectionKey)}, ownerId: ${JSON.stringify(ownerId)}, leaseMs: 5000 });
    process.stdout.write(JSON.stringify({ acquired: Boolean(lease) }));
    setTimeout(() => { store.close(); }, 100);`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = []; const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk)); child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject); child.once('close', (code) => code === 0
      ? resolve(JSON.parse(Buffer.concat(stdout).toString('utf8')))
      : reject(new Error(Buffer.concat(stderr).toString('utf8'))));
  });
}

test('OAuth attempt는 connection별 최신 state만 exact-once claim하고 오래된 callback을 폐기한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-connection-attempt-'));
  let now = 1_000;
  try {
    const store = new ConnectionStateStore(join(room, 'connections.sqlite'), { now: () => now });
    const googleKey = key('google'); const slackKey = key('slack', 'workspace-a');
    const first = store.beginOAuthAttempt({ connectionKey: googleKey, state: 'state-a',
      secretRef: 'oauth-attempt-first', redirectUri: 'http://127.0.0.1:41001/', requestedScopes: ['openid'], ttlMs: 60_000 });
    const second = store.beginOAuthAttempt({ connectionKey: googleKey, state: 'state-b',
      secretRef: 'oauth-attempt-second', redirectUri: 'http://127.0.0.1:41002/', requestedScopes: ['openid', 'drive.readonly'], ttlMs: 60_000 });
    assert.equal(store.readOAuthAttempt(first.attemptId).status, 'superseded');
    assert.equal(store.claimOAuthAttempt('state-a'), null);
    assert.equal(store.claimOAuthAttempt('wrong-state'), null);
    const claimed = store.claimOAuthAttempt('state-b');
    assert.equal(claimed.attemptId, second.attemptId); assert.equal(claimed.secretRef, 'oauth-attempt-second');
    assert.deepEqual(claimed.requestedScopes, ['openid', 'drive.readonly']);
    assert.equal(store.claimOAuthAttempt('state-b'), null);

    now += 1;
    store.beginOAuthAttempt({ connectionKey: slackKey, state: 'state-expired',
      secretRef: 'oauth-attempt-expired', redirectUri: 'http://127.0.0.1:41003/', requestedScopes: ['search:read.public'], ttlMs: 10 });
    now += 11;
    assert.equal(store.claimOAuthAttempt('state-expired'), null);
    assert.equal(store.readOAuthAttemptByState('state-expired').status, 'expired');
    store.close();
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('두 store의 refresh lease는 한 owner만 허용하고 stale fence의 credential commit을 막는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-connection-lease-')); let now = 10_000;
  try {
    const file = join(room, 'connections.sqlite');
    const first = new ConnectionStateStore(file, { now: () => now });
    const second = new ConnectionStateStore(file, { now: () => now });
    const notionKey = key('notion');
    const leaseA = first.acquireLease({ connectionKey: notionKey, ownerId: 'process-a', leaseMs: 1_000 });
    assert.ok(leaseA); assert.equal(second.acquireLease({ connectionKey: notionKey, ownerId: 'process-b', leaseMs: 1_000 }), null);
    const committed = first.commitCredential({ connectionKey: notionKey, expectedGeneration: 0,
      secretRef: 'remote-mcp-notion-generation-1', issuer: 'https://mcp.notion.com',
      identity: { accountId: 'account-a' }, scopes: ['read'], capabilities: { read: true }, lease: leaseA });
    assert.equal(committed.generation, 1); assert.equal(committed.state, 'ready');
    assert.throws(() => first.commitCredential({ connectionKey: notionKey, expectedGeneration: 0,
      secretRef: 'stale-secret', issuer: 'https://mcp.notion.com', identity: { accountId: 'account-a' },
      scopes: ['read'], capabilities: { read: true }, lease: leaseA }), /generation is stale/u);

    now += 1_001;
    const leaseB = second.acquireLease({ connectionKey: notionKey, ownerId: 'process-b', leaseMs: 1_000 });
    assert.ok(leaseB);
    assert.throws(() => first.commitCredential({ connectionKey: notionKey, expectedGeneration: 1,
      secretRef: 'late-process-a', issuer: 'https://mcp.notion.com', identity: { accountId: 'account-a' },
      scopes: ['read'], capabilities: { read: true }, lease: leaseA }), /lease is stale/u);
    const rotated = second.commitCredential({ connectionKey: notionKey, expectedGeneration: 1,
      secretRef: 'remote-mcp-notion-generation-2', issuer: 'https://mcp.notion.com',
      identity: { accountId: 'account-a' }, scopes: ['read', 'write'], capabilities: { read: true, update: true }, lease: leaseB });
    assert.equal(rotated.generation, 2); assert.equal(rotated.secretRef, 'remote-mcp-notion-generation-2');
    first.close(); second.close();
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('실제 두 Node process도 같은 connection refresh lease를 동시에 소유하지 못한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-connection-process-lease-'));
  try {
    const file = join(room, 'connections.sqlite');
    const moduleUrl = new URL('../src/connection-state-store.js', import.meta.url).href;
    const connectionKey = key('shared');
    const results = await Promise.all([childLease(moduleUrl, file, 'process-a', connectionKey), childLease(moduleUrl, file, 'process-b', connectionKey)]);
    assert.equal(results.filter((result) => result.acquired).length, 1);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('새 OAuth attempt는 이미 claim된 이전 exchange도 supersede하고 credential commit을 막는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-connection-attempt-fence-'));
  try {
    const store = new ConnectionStateStore(join(room, 'connections.sqlite'));
    const googleKey = key('google');
    const oldAttempt = store.beginOAuthAttempt({ connectionKey: googleKey, state: 'old-state',
      secretRef: 'old-verifier', redirectUri: 'http://127.0.0.1:42001/', requestedScopes: ['openid'] });
    assert.equal(store.claimOAuthAttempt('old-state').status, 'claimed');
    const newAttempt = store.beginOAuthAttempt({ connectionKey: googleKey, state: 'new-state',
      secretRef: 'new-verifier', redirectUri: 'http://127.0.0.1:42002/', requestedScopes: ['openid'] });
    assert.equal(store.readOAuthAttempt(oldAttempt.attemptId).status, 'superseded');
    const lease = store.acquireLease({ connectionKey: googleKey, ownerId: 'exchange-worker', leaseMs: 5_000 });
    assert.throws(() => store.commitCredential({ connectionKey: googleKey, expectedGeneration: 0,
      secretRef: 'old-token-bundle', issuer: 'https://accounts.google.com', identity: { accountId: 'account-a' },
      scopes: ['openid'], capabilities: { read: true }, lease, attemptId: oldAttempt.attemptId }), /OAuth attempt is stale/u);
    assert.equal(store.readCredential(googleKey).generation, 0);
    assert.equal(store.claimOAuthAttempt('new-state').attemptId, newAttempt.attemptId);
    const committed = store.commitCredential({ connectionKey: googleKey, expectedGeneration: 0,
      secretRef: 'new-token-bundle', issuer: 'https://accounts.google.com', identity: { accountId: 'account-a' },
      scopes: ['openid'], capabilities: { read: true }, lease, attemptId: newAttempt.attemptId });
    assert.equal(committed.generation, 1); assert.equal(store.readOAuthAttempt(newAttempt.attemptId).status, 'completed');
    store.close();
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('logout은 generation을 전진시킨 cleared 정본이며 token 원문은 SQLite에 저장하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-connection-clear-'));
  try {
    const file = join(room, 'connections.sqlite'); const store = new ConnectionStateStore(file);
    const linearKey = key('linear');
    const lease = store.acquireLease({ connectionKey: linearKey, ownerId: 'process', leaseMs: 5_000 });
    store.commitCredential({ connectionKey: linearKey, expectedGeneration: 0,
      secretRef: 'remote-mcp-linear-generation-1', issuer: 'https://linear.app', identity: { accountId: 'account-a' },
      scopes: ['read'], capabilities: { read: true }, lease });
    const cleared = store.clearCredential({ connectionKey: linearKey, expectedGeneration: 1, lease });
    assert.equal(cleared.generation, 2); assert.equal(cleared.state, 'cleared'); assert.equal(cleared.secretRef, null);
    assert.throws(() => store.commitCredential({ connectionKey: linearKey, expectedGeneration: 1,
      secretRef: 'late-refresh', issuer: 'https://linear.app', identity: { accountId: 'account-a' },
      scopes: ['read'], capabilities: { read: true }, lease }), /generation is stale/u);
    store.close();
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.doesNotMatch((await readFile(file)).toString('latin1'), /ACCESS-TOKEN|REFRESH-TOKEN/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});
