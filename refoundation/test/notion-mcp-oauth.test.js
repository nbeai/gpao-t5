import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNotionAuthorizeUrl, createNotionPkce, discoverNotionOAuth,
  exchangeNotionCode, refreshNotionTokens, registerNotionClient, startNotionCallback,
} from '../src/notion-mcp-oauth.js';

const metadata = {
  issuer: 'https://auth.notion.test',
  authorization_endpoint: 'https://auth.notion.test/authorize',
  token_endpoint: 'https://auth.notion.test/token',
  registration_endpoint: 'https://auth.notion.test/register',
  code_challenge_methods_supported: ['S256'],
  scopes_supported: ['mcp:tools'],
};

test('Notion OAuth discovery는 protected resource→authorization metadata 두 단계를 검증한다', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) return new Response(JSON.stringify({
      authorization_servers: ['https://auth.notion.test'],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify(metadata), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  assert.deepEqual(await discoverNotionOAuth({
    serverUrl: 'https://mcp.notion.com/mcp', fetchImpl,
  }), metadata);
  assert.deepEqual(calls, [
    'https://mcp.notion.com/mcp/.well-known/oauth-protected-resource',
    'https://auth.notion.test/.well-known/oauth-authorization-server',
  ]);
});

test('Notion 동적 클라이언트 등록은 public PKCE client와 정확한 callback만 선언한다', async () => {
  let body;
  const fetchImpl = async (url, options) => {
    assert.equal(String(url), metadata.registration_endpoint);
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({ client_id: 'notion-client', client_secret: 'client-secret' }), {
      status: 201, headers: { 'content-type': 'application/json' },
    });
  };
  const client = await registerNotionClient({
    metadata, redirectUri: 'http://127.0.0.1:1456/', fetchImpl,
  });
  assert.equal(client.client_id, 'notion-client');
  assert.equal(body.client_name, 'GPAO-T5');
  assert.deepEqual(body.redirect_uris, ['http://127.0.0.1:1456/']);
  assert.equal(body.token_endpoint_auth_method, 'none');
  assert.deepEqual(body.grant_types, ['authorization_code', 'refresh_token']);
});

test('Notion authorize URL과 code exchange는 PKCE·state·등록 client를 같은 흐름으로 쓴다', async () => {
  const pkce = createNotionPkce((length) => Buffer.alloc(length, 9));
  const url = new URL(buildNotionAuthorizeUrl({
    metadata, client: { client_id: 'notion-client' }, redirectUri: 'http://127.0.0.1:1456/', ...pkce,
  }));
  assert.equal(url.origin, 'https://auth.notion.test');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('scope'), 'mcp:tools');
  assert.equal(url.searchParams.get('state'), pkce.state);
  let body;
  const tokens = await exchangeNotionCode({
    metadata, client: { client_id: 'notion-client', client_secret: 'client-secret' },
    redirectUri: 'http://127.0.0.1:1456/', code: 'CODE', verifier: pkce.verifier,
  }, { fetchImpl: async (_url, options) => {
    body = new URLSearchParams(options.body);
    return new Response(JSON.stringify({
      access_token: 'ACCESS', refresh_token: 'REFRESH-1', expires_in: 3600,
      token_type: 'Bearer', scope: 'mcp:tools', user_id: 'user-id', workspace_id: 'workspace-id',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }, now: () => 1_000 });
  assert.equal(body.get('code_verifier'), pkce.verifier);
  assert.equal(body.get('client_secret'), 'client-secret');
  assert.equal(tokens.refreshToken, 'REFRESH-1');
  assert.equal(tokens.workspaceId, 'workspace-id');
});

test('Notion refresh는 회전된 refresh token을 반환하고 invalid_grant를 영구 재인증으로 분류한다', async () => {
  const existing = { accessToken: 'OLD', refreshToken: 'REFRESH-1', expiresAt: 1, workspaceId: 'ws' };
  const refreshed = await refreshNotionTokens({
    metadata, client: { client_id: 'client' }, tokens: existing,
  }, { fetchImpl: async () => new Response(JSON.stringify({
    access_token: 'NEW', refresh_token: 'REFRESH-2', expires_in: 3600, token_type: 'Bearer',
  }), { status: 200, headers: { 'content-type': 'application/json' } }), now: () => 2_000 });
  assert.equal(refreshed.refreshToken, 'REFRESH-2');
  assert.equal(refreshed.workspaceId, 'ws');
  await assert.rejects(() => refreshNotionTokens({
    metadata, client: { client_id: 'client' }, tokens: refreshed,
  }, { fetchImpl: async () => new Response(JSON.stringify({ error: 'invalid_grant' }), {
    status: 400, headers: { 'content-type': 'application/json' },
  }) }), (error) => error.reason === 'reauth_required');
});

test('Notion loopback callback은 state를 확인하고 code·state를 HTML에 반사하지 않는다', async () => {
  const callback = startNotionCallback({ state: 'EXPECTED', port: 0, timeoutMs: 2_000 });
  const { redirectUri } = await callback.listening;
  try {
    const response = await fetch(`${redirectUri}?code=NOTION-CODE&state=EXPECTED`);
    const html = await response.text();
    assert.equal(await callback.waitForCode, 'NOTION-CODE');
    assert.doesNotMatch(html, /NOTION-CODE|EXPECTED/u);
  } finally { callback.cancel(); }
});

test('Notion discovery가 비 HTTPS endpoint를 돌려주면 자격을 보내기 전에 닫힌다', async () => {
  let call = 0;
  await assert.rejects(() => discoverNotionOAuth({
    serverUrl: 'https://mcp.notion.com/mcp',
    fetchImpl: async () => {
      call += 1;
      return new Response(JSON.stringify(call === 1
        ? { authorization_servers: ['http://evil.test'] }
        : metadata), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  }), /HTTPS/u);
  assert.equal(call, 1);
});
