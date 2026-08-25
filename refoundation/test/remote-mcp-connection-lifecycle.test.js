import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConnectionCredentialCoordinator } from '../src/connection-credential-coordinator.js';
import { ConnectionStateStore } from '../src/connection-state-store.js';
import { makeRemoteMcpConnection } from '../src/remote-mcp-connection.js';

function secrets() {
  const values = new Map(); let failClears = false;
  return { values, async get(key) { return structuredClone(values.get(key) ?? null); },
    async set(key, value) { values.set(key, structuredClone(value)); }, async clear(key) {
      if (failClears) throw new Error('injected cleanup failure'); values.delete(key);
    }, set failClears(value) { failClears = Boolean(value); } };
}

async function fixture(t, options = {}) {
  const room = await mkdtemp(join(tmpdir(), 't5-remote-mcp-lifecycle-'));
  t.after(() => rm(room, { recursive: true, force: true }));
  const secretStore = secrets(); const stateStore = new ConnectionStateStore(join(room, 'connections.sqlite'));
  t.after(() => stateStore.close()); let ids = 0;
  const credentialCoordinator = new ConnectionCredentialCoordinator({ stateStore, secretStore,
    makeId: () => `credential-${++ids}` });
  let tokenCalls = 0; let access = 'ACCESS-A'; let clock = 1_000;
  const buildConnection = () => makeRemoteMcpConnection({
    id: 'official', label: 'Official', serverUrl: 'https://mcp.service.test/mcp', resource: 'https://mcp.service.test',
    secretStore, stateStore, credentialCoordinator, callbackPort: 0,
    oauthClient: { client_id: 't5-client', client_secret: 't5-secret' }, requestedScopes: ['read'],
    requireObservedAccount: true, makeId: () => `protocol-${++ids}`,
    now: () => clock,
    ...(options.authorizationParameters ? { authorizationParameters: options.authorizationParameters } : {}),
    ...(options.oauthPolicy ? { oauthPolicy: options.oauthPolicy } : {}),
    fetchImpl: async (url) => {
      if (String(url).includes('oauth-protected-resource')) return new Response(JSON.stringify({
        resource: 'https://mcp.service.test', authorization_servers: ['https://identity.service.test'],
      }));
      if (String(url).includes('oauth-authorization-server')) return new Response(JSON.stringify({
        issuer: 'https://identity.service.test', authorization_endpoint: 'https://login.service.test/authorize',
        token_endpoint: 'https://token.service.test/token', code_challenge_methods_supported: ['S256'],
      }));
      if (String(url) === 'https://token.service.test/token') {
        tokenCalls += 1; access = tokenCalls === 1 ? 'ACCESS-A' : 'ACCESS-B';
        if (tokenCalls === 2 && options.secondTokenBarrier) {
          options.secondTokenBarrier.started(); await options.secondTokenBarrier.wait;
        }
        return new Response(JSON.stringify({ access_token: access, refresh_token: `REFRESH-${tokenCalls}`,
          expires_in: 3600, scope: 'read' }));
      }
      throw new Error(`unexpected ${url}`);
    },
    runtimeFactory: ({ credential }) => { let activeList = null; return {
      async listTools() { activeList = credential(); const token = await activeList;
        if (options.rejectSecond && token.accessToken === 'ACCESS-B') throw new Error('candidate rejected');
        return [{ name: 'read_item', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }]; },
      async callTool() { return { content: [{ type: 'text', text: 'ok' }] }; },
      async close() { if (options.closeWaitsForCredential) await activeList; }, invalidate() {},
    }; },
    verifyConnection: async ({ credential }) => ({ accountId: credential.accessToken === 'ACCESS-A' ? 'account-a' : 'account-b',
      accountLabel: credential.accessToken, permissions: ['read'], capabilities: { read: true } }),
  });
  const connection = buildConnection();
  return { connection, newConnection: buildConnection, secretStore, stateStore,
    set clock(value) { clock = value; }, get tokenCalls() { return tokenCalls; } };
}

async function authorize(connection, code) {
  const started = await connection.start(); const url = new URL(started.authorizeUrl);
  const completion = connection.awaitConnection();
  completion.catch(() => {});
  await fetch(`${url.searchParams.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(url.searchParams.get('state'))}`);
  return completion;
}

test('제품 Remote MCP가 durable attempt와 generation coordinator로 연결을 commit한다', async (t) => {
  const f = await fixture(t); await authorize(f.connection, 'CODE-A');
  const rows = f.stateStore.database.prepare('SELECT * FROM connection_credentials').all();
  assert.equal(rows.length, 1); assert.equal(rows[0].generation, 1); assert.equal(rows[0].state, 'ready');
  assert.equal(f.stateStore.database.prepare("SELECT count(*) AS n FROM oauth_attempts WHERE status='completed'").get().n, 1);
  assert.equal(f.secretStore.values.has('remote-mcp-official'), false);
  assert.equal((await f.connection.inspect()).identity.accountId, 'account-a');
});

test('기존 ready 연결에서 새 계정 재인증 검증이 실패하면 이전 generation과 identity를 보존한다', async (t) => {
  const f = await fixture(t, { rejectSecond: true }); await authorize(f.connection, 'CODE-A');
  const before = f.stateStore.database.prepare('SELECT * FROM connection_credentials').get();
  await assert.rejects(() => authorize(f.connection, 'CODE-B'), /candidate rejected/u);
  const after = f.stateStore.database.prepare('SELECT * FROM connection_credentials').get();
  assert.equal(after.generation, before.generation); assert.equal(after.secret_ref, before.secret_ref);
  const inspected = await f.connection.inspect();
  assert.equal(inspected.state, 'connected'); assert.equal(inspected.identity.accountId, 'account-a');
});

test('기존 account A에서 검증된 account B 재인증도 명시적 해제 전에는 commit하지 않는다', async (t) => {
  const f = await fixture(t); await authorize(f.connection, 'CODE-A');
  const before = f.stateStore.database.prepare('SELECT * FROM connection_credentials').get();
  await assert.rejects(() => authorize(f.connection, 'CODE-B'), (error) => error.reason === 'account_mismatch');
  const after = f.stateStore.database.prepare('SELECT * FROM connection_credentials').get();
  assert.equal(after.generation, before.generation); assert.equal(after.secret_ref, before.secret_ref);
  assert.equal((await f.connection.inspect()).identity.accountId, 'account-a');
});

test('기존 fixed Keychain Remote MCP bundle은 첫 inspect에서 durable generation으로 무손실 이관된다', async (t) => {
  const f = await fixture(t);
  await f.secretStore.set('remote-mcp-official', {
    metadata: { issuer: 'https://identity.service.test', token_endpoint: 'https://token.service.test/token' },
    client: { client_id: 't5-client' }, verifiedAt: 1,
    tokens: { accessToken: 'LEGACY', refreshToken: 'REFRESH', expiresAt: null, scopes: ['read'] },
    tools: ['read_item'], identity: { accountId: 'legacy-account', accountLabel: 'Legacy', permissions: ['read'] },
    capabilities: { read: true },
  });
  const inspected = await f.connection.inspect();
  assert.equal(inspected.state, 'connected'); assert.equal(inspected.identity.accountId, 'legacy-account');
  assert.equal(f.stateStore.database.prepare('SELECT generation FROM connection_credentials').get().generation, 1);
  assert.equal(f.secretStore.values.has('remote-mcp-official'), false);
});

test('공식 pin이 있는 Connector는 protected resource 없는 legacy bundle을 ready로 자동 승격하지 않는다', async (t) => {
  const f = await fixture(t, { oauthPolicy: { issuer: 'https://identity.service.test',
    authorizationEndpoint: 'https://login.service.test/authorize', tokenEndpoint: 'https://token.service.test/token',
    expectedResource: 'https://mcp.service.test' } });
  await f.secretStore.set('remote-mcp-official', {
    metadata: { issuer: 'https://identity.service.test', authorization_endpoint: 'https://login.service.test/authorize',
      token_endpoint: 'https://token.service.test/token' }, client: { client_id: 't5-client' }, verifiedAt: 1,
    tokens: { accessToken: 'LEGACY', refreshToken: 'REFRESH', expiresAt: null, scopes: ['read'] },
    identity: { accountId: 'legacy-account', permissions: ['read'] }, capabilities: { read: true }, tools: ['read_item'],
  });
  assert.equal((await f.connection.inspect()).state, 'needs_connection');
  assert.equal(f.stateStore.database.prepare('SELECT count(*) AS n FROM connection_credentials').get().n, 0);
  assert.equal(f.secretStore.values.has('remote-mcp-official'), true);
});

test('두 Connector가 같은 만료 generation을 동시에 읽어도 refresh token POST는 한 번뿐이다', async (t) => {
  const f = await fixture(t); await authorize(f.connection, 'CODE-A'); f.clock = 10_000_000;
  const second = f.newConnection();
  const [firstTool, secondTool] = await Promise.all([
    f.connection.makeTool({ authorizeEffect: async () => ({ allowed: true }) }),
    second.makeTool({ authorizeEffect: async () => ({ allowed: true }) }),
  ]);
  await Promise.all([firstTool, secondTool].map((tool) => tool.execute({
    action: 'list_tools', toolName: null, argumentsJson: null, effect: null,
  })));
  assert.equal(f.tokenCalls, 2);
  assert.equal(f.stateStore.database.prepare('SELECT generation FROM connection_credentials').get().generation, 2);
  await second.close();
});

test('다른 process가 새 OAuth attempt를 시작하면 오래된 callback은 token exchange와 commit을 못 한다', async (t) => {
  const f = await fixture(t); const second = f.newConnection();
  const oldStart = await f.connection.start(); const oldUrl = new URL(oldStart.authorizeUrl);
  const oldAttempt = f.stateStore.database.prepare("SELECT secret_ref FROM oauth_attempts WHERE status='pending'").get();
  await second.start();
  assert.equal(f.secretStore.values.has(oldAttempt.secret_ref), false);
  const oldCompletion = f.connection.awaitConnection(); oldCompletion.catch(() => {});
  await fetch(`${oldUrl.searchParams.get('redirect_uri')}?code=STALE&state=${encodeURIComponent(oldUrl.searchParams.get('state'))}`);
  await assert.rejects(oldCompletion, /stale|만료/u);
  assert.equal(f.tokenCalls, 0);
  assert.equal(f.stateStore.database.prepare('SELECT count(*) AS n FROM connection_credentials').get().n, 0);
  await second.cancelPending(); await second.close();
});

test('OAuth 대기 중 connection close는 durable attempt와 PKCE candidate secret을 함께 닫는다', async (t) => {
  const f = await fixture(t); await f.connection.start();
  const pending = f.stateStore.database.prepare("SELECT * FROM oauth_attempts WHERE status='pending'").get();
  assert.equal(f.secretStore.values.has(pending.secret_ref), true);
  await f.connection.close();
  assert.equal(f.stateStore.database.prepare('SELECT status FROM oauth_attempts WHERE attempt_id=?').get(pending.attempt_id).status, 'cancelled');
  assert.equal(f.secretStore.values.has(pending.secret_ref), false);
});

test('attempt 저장 뒤 authorization URL 구성이 실패해도 candidate secret과 pending 상태를 남기지 않는다', async (t) => {
  const f = await fixture(t, { authorizationParameters: { prompt: 'unsafe' } });
  await assert.rejects(() => f.connection.start(), /not allowed/u);
  const attempt = f.stateStore.database.prepare('SELECT * FROM oauth_attempts').get();
  assert.equal(attempt.status, 'failed'); assert.equal(f.secretStore.values.has(attempt.secret_ref), false);
});

test('만료 token을 읽는 SDK callback 안에서 현재 runtime close를 기다리는 순환 대기를 만들지 않는다', async (t) => {
  const f = await fixture(t, { closeWaitsForCredential: true }); await authorize(f.connection, 'CODE-A');
  f.clock = 10_000_000; const second = f.newConnection();
  const tool = await second.makeTool({ authorizeEffect: async () => ({ allowed: true }) });
  const listed = await Promise.race([
    tool.execute({ action: 'list_tools', toolName: null, argumentsJson: null, effect: null }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('refresh deadlocked')), 500)),
  ]);
  assert.equal(listed.state, 'listed'); await second.close();
});

test('다른 process의 pending OAuth 중 disconnect하면 attempt와 credential을 한 transaction으로 닫아 부활을 막는다', async (t) => {
  const f = await fixture(t); await authorize(f.connection, 'CODE-A'); const second = f.newConnection();
  const started = await f.connection.start(); const url = new URL(started.authorizeUrl);
  await second.disconnect();
  const completion = f.connection.awaitConnection(); completion.catch(() => {});
  await fetch(`${url.searchParams.get('redirect_uri')}?code=LATE&state=${encodeURIComponent(url.searchParams.get('state'))}`);
  await assert.rejects(completion, /stale|만료/u);
  const credential = f.stateStore.database.prepare('SELECT state FROM connection_credentials').get();
  const attempt = f.stateStore.database.prepare('SELECT status FROM oauth_attempts ORDER BY created_at DESC LIMIT 1').get();
  assert.equal(credential.state, 'cleared'); assert.equal(attempt.status, 'cancelled');
  assert.equal((await second.inspect()).state, 'needs_connection'); await second.close();
});

test('claimed OAuth exchange와 경합한 disconnect는 같은 lease 뒤 최종 cleared로 직렬화된다', async (t) => {
  let release; let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const wait = new Promise((resolve) => { release = resolve; });
  const f = await fixture(t, { secondTokenBarrier: { started: markStarted, wait } });
  await authorize(f.connection, 'CODE-A'); const second = f.newConnection();
  const auth = new URL((await f.connection.start()).authorizeUrl);
  const completion = f.connection.awaitConnection(); completion.catch(() => {});
  await fetch(`${auth.searchParams.get('redirect_uri')}?code=CODE-B&state=${encodeURIComponent(auth.searchParams.get('state'))}`);
  await started; const disconnecting = second.disconnect(); release();
  await Promise.allSettled([completion, disconnecting]);
  assert.equal(f.stateStore.database.prepare('SELECT state FROM connection_credentials').get().state, 'cleared');
  assert.equal((await second.inspect()).state, 'needs_connection'); await second.close();
});

test('Keychain cleanup 실패는 무시하지 않고 durable queue에 남아 다음 inspect에서 회수된다', async (t) => {
  const f = await fixture(t); await authorize(f.connection, 'CODE-A');
  f.secretStore.failClears = true; await f.connection.disconnect();
  assert.ok(f.stateStore.database.prepare('SELECT count(*) AS n FROM connection_secret_cleanup').get().n > 0);
  f.secretStore.failClears = false; await f.connection.inspect();
  assert.equal(f.stateStore.database.prepare('SELECT count(*) AS n FROM connection_secret_cleanup').get().n, 0);
});

test('403 required scope는 generation에 durable 결속되고 다음 OAuth 요청에 기존 scope와 합쳐진다', async (t) => {
  const f = await fixture(t); await authorize(f.connection, 'CODE-A');
  const row = f.stateStore.database.prepare('SELECT connection_key,generation FROM connection_credentials').get();
  const lease = f.stateStore.acquireLease({ connectionKey: row.connection_key, ownerId: 'scope-test' });
  f.stateStore.setCredentialState({ connectionKey: row.connection_key, expectedGeneration: row.generation,
    state: 'needs_additional_permission', requiredScopes: ['files:read'], lease });
  f.stateStore.releaseLease(lease);
  const inspected = await f.connection.inspect();
  assert.equal(inspected.reason, 'additional_permission_required');
  const authorizeUrl = new URL((await f.connection.start()).authorizeUrl);
  assert.deepEqual(authorizeUrl.searchParams.get('scope').split(' '), ['read', 'files:read']);
  await f.connection.cancelPending();
});
