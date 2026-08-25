import test from 'node:test';
import assert from 'node:assert/strict';

import { makeGoogleWorkspaceDriveMcpConnection } from '../src/google-workspace-mcp-connection.js';

function memorySecretStore() {
  const values = new Map();
  return { async get(key) { return structuredClone(values.get(key) ?? null); },
    async set(key, value) { values.set(key, structuredClone(value)); }, async clear(key) { values.delete(key); } };
}

test('Google Workspace Drive는 사전등록 OAuth·offline consent·userinfo·protected tools 뒤에만 연결된다', async () => {
  const calls = []; const metadata = { issuer: 'https://accounts.google.test',
    authorization_endpoint: 'https://accounts.google.test/o/oauth2/auth', token_endpoint: 'https://accounts.google.test/token',
    code_challenge_methods_supported: ['S256'], scopes_supported: ['openid', 'email', 'profile',
      'https://www.googleapis.com/auth/drive.readonly'] };
  const connection = makeGoogleWorkspaceDriveMcpConnection({ secretStore: memorySecretStore(),
    clientId: 'T5-GOOGLE-CLIENT', clientSecret: 'T5-GOOGLE-SECRET', callbackPort: 0,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method ?? 'GET', headers: structuredClone(init.headers ?? {}) });
      if (String(url).includes('oauth-protected-resource')) return new Response(JSON.stringify({ authorization_servers: ['https://accounts.google.test'] }));
      if (String(url).includes('oauth-authorization-server')) return new Response(JSON.stringify(metadata));
      if (String(url).endsWith('/token')) return new Response(JSON.stringify({ access_token: 'GOOGLE-ACCESS',
        refresh_token: 'GOOGLE-REFRESH', expires_in: 3600,
        scope: 'openid email profile https://www.googleapis.com/auth/drive.readonly' }));
      if (String(url) === 'https://www.googleapis.com/oauth2/v3/userinfo') return new Response(JSON.stringify({
        sub: 'google-sub-1', email: 'owner@example.com', name: 'Owner', hd: 'example.com',
      }));
      throw new Error(`unexpected ${url}`);
    }, runtimeFactory: () => ({ async listTools() { return [{ name: 'search_files', inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true } }, { name: 'get_file', inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true } }]; }, async callTool() { return { content: [], isError: false }; },
    invalidate() {}, async close() {} }) });
  const authorize = new URL((await connection.start()).authorizeUrl);
  assert.equal(authorize.searchParams.get('client_id'), 'T5-GOOGLE-CLIENT');
  assert.equal(authorize.searchParams.get('access_type'), 'offline');
  assert.equal(authorize.searchParams.get('include_granted_scopes'), 'true');
  assert.match(authorize.searchParams.get('scope'), /drive\.readonly/u);
  const callback = new URL(authorize.searchParams.get('redirect_uri')); const completion = connection.awaitConnection();
  await fetch(`${callback}?code=GOOGLE-CODE&state=${encodeURIComponent(authorize.searchParams.get('state'))}`);
  assert.equal((await completion).connected, true);
  const inspected = await connection.inspect(); assert.equal(inspected.identity.accountId, 'google-sub-1');
  assert.equal(inspected.identity.accountLabel, 'owner@example.com');
  assert.deepEqual(inspected.capabilities, { search: true, read: true, create: false, update: false });
  assert.equal(calls.find((call) => call.url.includes('/userinfo')).headers.authorization, 'Bearer GOOGLE-ACCESS');
  assert.doesNotMatch(JSON.stringify(inspected), /GOOGLE-ACCESS|GOOGLE-REFRESH|T5-GOOGLE-SECRET/u);
  await connection.close();
});

test('Google userinfo에 sub·email이 없으면 tools/list가 성공해도 ready가 아니다', async () => {
  const metadata = { issuer: 'https://accounts.google.test', authorization_endpoint: 'https://accounts.google.test/auth',
    token_endpoint: 'https://accounts.google.test/token', code_challenge_methods_supported: ['S256'],
    scopes_supported: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.readonly'] };
  const connection = makeGoogleWorkspaceDriveMcpConnection({ secretStore: memorySecretStore(), clientId: 'CLIENT',
    clientSecret: 'SECRET', callbackPort: 0, fetchImpl: async (url) => {
      if (String(url).includes('oauth-protected-resource')) return new Response(JSON.stringify({ authorization_servers: ['https://accounts.google.test'] }));
      if (String(url).includes('oauth-authorization-server')) return new Response(JSON.stringify(metadata));
      if (String(url).endsWith('/token')) return new Response(JSON.stringify({ access_token: 'ACCESS',
        scope: 'openid email profile https://www.googleapis.com/auth/drive.readonly' }));
      if (String(url).includes('/userinfo')) return new Response(JSON.stringify({ name: 'Unknown' }));
      throw new Error(`unexpected ${url}`);
    }, runtimeFactory: () => ({ async listTools() { return [{ name: 'search_files', inputSchema: { type: 'object' } }]; },
      async callTool() { return { content: [], isError: false }; }, invalidate() {}, async close() {} }) });
  const authorize = new URL((await connection.start()).authorizeUrl); const callback = new URL(authorize.searchParams.get('redirect_uri'));
  const completion = connection.awaitConnection(); const rejected = assert.rejects(completion, /Google 계정 identity/u);
  await fetch(`${callback}?code=CODE&state=${encodeURIComponent(authorize.searchParams.get('state'))}`); await rejected;
  assert.equal((await connection.inspect()).state, 'needs_connection'); await connection.close();
});
