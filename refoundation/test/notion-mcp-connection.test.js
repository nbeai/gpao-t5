import test from 'node:test';
import assert from 'node:assert/strict';

import { makeNotionMcpConnection } from '../src/notion-mcp-connection.js';

function memorySecrets() {
  let value = null;
  return {
    get: async () => value == null ? null : structuredClone(value),
    set: async (_name, next) => { value = structuredClone(next); return true; },
    clear: async () => { value = null; return true; },
    peek: () => structuredClone(value),
  };
}

const metadata = {
  issuer: 'https://auth.notion.test', authorization_endpoint: 'https://auth.notion.test/authorize',
  token_endpoint: 'https://auth.notion.test/token', registration_endpoint: 'https://auth.notion.test/register',
  code_challenge_methods_supported: ['S256'], scopes_supported: ['mcp:tools'],
};

test('Notion 연결은 discovery·DCR·OAuth 뒤 MCP self/tool 목록까지 확인해야 연결됨이 된다', async () => {
  const secretStore = memorySecrets();
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const value = String(url); calls.push(value);
    if (value.endsWith('/mcp/.well-known/oauth-protected-resource')) return new Response(JSON.stringify({
      authorization_servers: ['https://auth.notion.test'],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (value.endsWith('/.well-known/oauth-authorization-server')) return new Response(JSON.stringify(metadata), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
    if (value.endsWith('/register')) return new Response(JSON.stringify({
      client_id: 'dynamic-client', client_secret: 'dynamic-secret',
    }), { status: 201, headers: { 'content-type': 'application/json' } });
    if (value.endsWith('/token')) return new Response(JSON.stringify({
      access_token: 'NOTION-ACCESS', refresh_token: 'NOTION-REFRESH', expires_in: 3600,
      token_type: 'Bearer', scope: 'mcp:tools', workspace_id: 'workspace-id', user_id: 'user-id',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error(`unexpected ${value} ${options.method ?? 'GET'}`);
  };
  const runtimeFactory = ({ credential }) => ({
    async listTools() { assert.equal((await credential()).accessToken, 'NOTION-ACCESS'); return [
      { name: 'notion-fetch', annotations: { readOnlyHint: true }, inputSchema: { type: 'object' } },
      { name: 'notion-search', annotations: { readOnlyHint: true }, inputSchema: { type: 'object' } },
      { name: 'notion-update-page', annotations: { readOnlyHint: false }, inputSchema: { type: 'object' } },
    ]; },
    async callTool({ name, arguments: args }) {
      assert.equal(name, 'notion-fetch'); assert.deepEqual(args, { id: 'self' });
      return { content: [{ type: 'text', text: JSON.stringify({ self: {
        workspace: { id: 'workspace-id', name: '테스트 업무공간' },
        current_tool_access: {},
      } }) }], isError: false };
    },
    async close() {}, invalidate() {},
  });
  const connection = makeNotionMcpConnection({
    secretStore, fetchImpl, runtimeFactory, callbackPort: 0,
  });
  try {
    assert.equal((await connection.inspect()).state, 'needs_connection');
    const started = await connection.start();
    const authorize = new URL(started.authorizeUrl);
    const redirect = authorize.searchParams.get('redirect_uri');
    await fetch(`${redirect}?code=NOTION-CODE&state=${authorize.searchParams.get('state')}`);
    const connected = await connection.awaitConnection();
    assert.equal(connected.connected, true);
    assert.match(connected.userSafeSummary, /테스트 업무공간/u);
    const inspected = await connection.inspect();
    assert.equal(inspected.state, 'connected');
    assert.equal(inspected.capabilities.search, true);
    assert.equal(inspected.capabilities.update, true);
    assert.equal(inspected.capabilities.upload, false);
    assert.equal(inspected.actions[0].kind, 'disconnect');
    assert.equal(secretStore.peek().client.client_secret, 'dynamic-secret');
    assert.equal(secretStore.peek().tokens.refreshToken, 'NOTION-REFRESH');
    assert.doesNotMatch(JSON.stringify({ started, connected, inspected }),
      /dynamic-secret|NOTION-ACCESS|NOTION-REFRESH|user-id/u);
  } finally { await connection.close(); }
});

test('Notion invalid_grant는 재시도 루프 없이 token만 지우고 등록 정보는 재사용한다', async () => {
  const secretStore = memorySecrets();
  await secretStore.set('notion', {
    version: 1, redirectUri: 'http://127.0.0.1:1456/', metadata,
    client: { client_id: 'dynamic-client', client_secret: 'dynamic-secret' },
    tokens: { accessToken: 'OLD', refreshToken: 'ROTATED-OUT', expiresAt: 1 },
  });
  let refreshCalls = 0;
  const connection = makeNotionMcpConnection({
    secretStore, now: () => 10_000,
    fetchImpl: async () => {
      refreshCalls += 1;
      return new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400, headers: { 'content-type': 'application/json' },
      });
    },
    runtimeFactory: () => { throw new Error('runtime must not start'); },
  });
  try {
    await assert.rejects(() => connection.credential(), (error) => error.reason === 'reauth_required');
    assert.equal(refreshCalls, 1);
    assert.equal(secretStore.peek().tokens, undefined);
    assert.equal(secretStore.peek().client.client_id, 'dynamic-client');
    assert.equal((await connection.inspect()).state, 'needs_connection');
  } finally { await connection.close(); }
});

test('동시에 들어온 Notion 연결 시작은 callback 포트를 열기 전에 하나만 입장한다', async () => {
  const secretStore = memorySecrets();
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.endsWith('/mcp/.well-known/oauth-protected-resource')) return new Response(JSON.stringify({
      authorization_servers: ['https://auth.notion.test'],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (value.endsWith('/.well-known/oauth-authorization-server')) return new Response(JSON.stringify(metadata), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
    return new Response(JSON.stringify({ client_id: 'one-client' }), {
      status: 201, headers: { 'content-type': 'application/json' },
    });
  };
  const connection = makeNotionMcpConnection({
    secretStore, fetchImpl, callbackPort: 0,
    runtimeFactory: () => { throw new Error('not used'); },
  });
  try {
    const results = await Promise.allSettled([connection.start(), connection.start()]);
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
    const rejected = results.find((item) => item.status === 'rejected');
    assert.equal(rejected.reason.status, 409);
    assert.equal(rejected.reason.reason, 'oauth_in_progress');
  } finally { await connection.close(); }
});
