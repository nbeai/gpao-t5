import test from 'node:test';
import assert from 'node:assert/strict';

import { makeSlackMcpConnection } from '../src/slack-mcp-connection.js';

function memorySecretStore() {
  const values = new Map();
  return { async get(key) { return structuredClone(values.get(key) ?? null); },
    async set(key, value) { values.set(key, structuredClone(value)); }, async clear(key) { values.delete(key); } };
}

test('Slack은 DCR 없이 T5 사전등록 OAuth와 auth.test identity 뒤에만 연결된다', async () => {
  const calls = []; const metadata = { issuer: 'https://slack.test',
    authorization_endpoint: 'https://slack.test/oauth/authorize', token_endpoint: 'https://slack.test/oauth/token',
    code_challenge_methods_supported: ['S256'], scopes_supported: ['search:read.public', 'chat:write'] };
  const connection = makeSlackMcpConnection({ secretStore: memorySecretStore(), clientId: 'T5-SLACK-CLIENT',
    clientSecret: 'T5-SLACK-SECRET', callbackPort: 0,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method ?? 'GET', headers: structuredClone(init.headers ?? {}) });
      if (String(url).includes('oauth-protected-resource')) return new Response(JSON.stringify({ authorization_servers: ['https://slack.test'] }));
      if (String(url).includes('oauth-authorization-server')) return new Response(JSON.stringify(metadata));
      if (String(url).endsWith('/oauth/token')) return new Response(JSON.stringify({ access_token: 'SLACK-ACCESS',
        refresh_token: 'SLACK-REFRESH', expires_in: 3600, scope: 'search:read.public' }));
      if (String(url) === 'https://slack.com/api/auth.test') return new Response(JSON.stringify({
        ok: true, team_id: 'T123', team: '우리 회사', user_id: 'U123', user: 'owner', url: 'https://team.slack.com/',
      }));
      throw new Error(`unexpected ${url}`);
    },
    runtimeFactory: () => ({ async listTools() { return [{ name: 'slack_search', inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true } }]; }, async callTool() { return { content: [], isError: false }; },
    invalidate() {}, async close() {} }),
  });
  const started = await connection.start(); const authorize = new URL(started.authorizeUrl);
  assert.equal(authorize.searchParams.get('client_id'), 'T5-SLACK-CLIENT');
  assert.equal(authorize.searchParams.get('scope'), 'search:read.public');
  assert.equal(calls.some((call) => call.url.includes('/register')), false);
  const callback = new URL(authorize.searchParams.get('redirect_uri')); const completion = connection.awaitConnection();
  await fetch(`${callback}?code=SLACK-CODE&state=${encodeURIComponent(authorize.searchParams.get('state'))}`);
  assert.equal((await completion).connected, true);
  const inspected = await connection.inspect(); assert.equal(inspected.identity.accountId, 'T123:U123');
  assert.equal(inspected.identity.accountLabel, '우리 회사 · owner');
  assert.deepEqual(inspected.capabilities, { search: true, read: true, create: false, update: false });
  assert.doesNotMatch(JSON.stringify(inspected), /SLACK-ACCESS|SLACK-REFRESH|T5-SLACK-SECRET/u);
  assert.equal(calls.find((call) => call.url === 'https://slack.com/api/auth.test').headers.authorization, 'Bearer SLACK-ACCESS');
  await connection.close();
});

test('Slack auth.test가 다른 형식이거나 실패하면 tools/list 성공도 ready가 아니다', async () => {
  const metadata = { issuer: 'https://slack.test', authorization_endpoint: 'https://slack.test/oauth/authorize',
    token_endpoint: 'https://slack.test/oauth/token', code_challenge_methods_supported: ['S256'],
    scopes_supported: ['search:read.public'] };
  const connection = makeSlackMcpConnection({ secretStore: memorySecretStore(), clientId: 'CLIENT', clientSecret: 'SECRET',
    callbackPort: 0, fetchImpl: async (url) => {
      if (String(url).includes('oauth-protected-resource')) return new Response(JSON.stringify({ authorization_servers: ['https://slack.test'] }));
      if (String(url).includes('oauth-authorization-server')) return new Response(JSON.stringify(metadata));
      if (String(url).endsWith('/oauth/token')) return new Response(JSON.stringify({ access_token: 'ACCESS', scope: 'search:read.public' }));
      if (String(url) === 'https://slack.com/api/auth.test') return new Response(JSON.stringify({ ok: false, error: 'invalid_auth' }));
      throw new Error(`unexpected ${url}`);
    }, runtimeFactory: () => ({ async listTools() { return [{ name: 'slack_search', inputSchema: { type: 'object' } }]; },
      async callTool() { return { content: [], isError: false }; }, invalidate() {}, async close() {} }) });
  const authorize = new URL((await connection.start()).authorizeUrl); const callback = new URL(authorize.searchParams.get('redirect_uri'));
  const completion = connection.awaitConnection(); const rejected = assert.rejects(completion, /Slack 계정 identity/u);
  await fetch(`${callback}?code=CODE&state=${encodeURIComponent(authorize.searchParams.get('state'))}`); await rejected;
  assert.equal((await connection.inspect()).state, 'needs_connection'); await connection.close();
});
