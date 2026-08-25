import test from 'node:test';
import assert from 'node:assert/strict';

import { discoverRemoteMcpOAuth, exchangeRemoteMcpCode } from '../src/remote-mcp-oauth.js';

test('Slack 공식 metadata의 root resource와 cross-origin OAuth endpoint를 그대로 수용한다', async () => {
  const calls = [];
  const metadata = {
    issuer: 'https://mcp.slack.com',
    authorization_endpoint: 'https://slack.com/oauth/v2_user/authorize',
    token_endpoint: 'https://slack.com/api/oauth.v2.user.access',
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post'],
  };
  const discovered = await discoverRemoteMcpOAuth({
    serverUrl: 'https://mcp.slack.com/mcp', label: 'Slack',
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url) === 'https://mcp.slack.com/.well-known/oauth-protected-resource/mcp') {
        return new Response('', { status: 404 });
      }
      if (String(url) === 'https://mcp.slack.com/.well-known/oauth-protected-resource') {
        return new Response(JSON.stringify({
          resource: 'https://mcp.slack.com', authorization_servers: ['https://mcp.slack.com'],
        }));
      }
      if (String(url) === 'https://mcp.slack.com/.well-known/oauth-authorization-server') {
        return new Response(JSON.stringify(metadata));
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  assert.deepEqual(discovered, { ...metadata, protected_resource: 'https://mcp.slack.com' });
  assert.deepEqual(calls, [
    'https://mcp.slack.com/.well-known/oauth-protected-resource/mcp',
    'https://mcp.slack.com/.well-known/oauth-protected-resource',
    'https://mcp.slack.com/.well-known/oauth-authorization-server',
  ]);
});

test('Google 공식 OIDC metadata와 cross-origin token endpoint를 그대로 수용한다', async () => {
  const metadata = {
    issuer: 'https://accounts.google.com',
    authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    token_endpoint: 'https://oauth2.googleapis.com/token',
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['openid', 'email', 'profile'],
  };
  const discovered = await discoverRemoteMcpOAuth({
    serverUrl: 'https://drivemcp.googleapis.com/mcp/v1', label: 'Google Workspace',
    fetchImpl: async (url) => {
      if (String(url) === 'https://drivemcp.googleapis.com/.well-known/oauth-protected-resource/mcp/v1') {
        return new Response(JSON.stringify({ resource: 'https://drivemcp.googleapis.com/mcp/v1',
          authorization_servers: ['https://accounts.google.com'] }));
      }
      if (String(url) === 'https://accounts.google.com/.well-known/oauth-authorization-server') {
        return new Response('', { status: 404 });
      }
      if (String(url) === 'https://accounts.google.com/.well-known/openid-configuration') {
        return new Response(JSON.stringify(metadata));
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  assert.deepEqual(discovered, { ...metadata, protected_resource: 'https://drivemcp.googleapis.com/mcp/v1' });
});

test('expires_in 없는 비회전 token을 임의의 8시간 만료로 만들지 않는다', async () => {
  const tokens = await exchangeRemoteMcpCode({
    metadata: { token_endpoint: 'https://slack.com/api/oauth.v2.user.access' },
    client: { client_id: 'client', client_secret: 'secret' }, redirectUri: 'http://127.0.0.1:4185/',
    code: 'code', verifier: 'verifier', requestedScopes: ['search:read.public'], label: 'Slack',
  }, { now: () => 1_000, fetchImpl: async () => new Response(JSON.stringify({
    access_token: 'ACCESS', token_type: 'Bearer', scope: 'search:read.public',
  })) });
  assert.equal(tokens.expiresAt, null);
  assert.equal(tokens.refreshToken, null);
});

test('protected resource가 가리킨 issuer와 metadata issuer가 다르면 endpoint를 사용하지 않는다', async () => {
  await assert.rejects(() => discoverRemoteMcpOAuth({
    serverUrl: 'https://mcp.slack.com/mcp', label: 'Slack',
    fetchImpl: async (url) => {
      if (String(url).endsWith('/oauth-protected-resource/mcp')) return new Response('', { status: 404 });
      if (String(url).endsWith('/oauth-protected-resource')) return new Response(JSON.stringify({
        resource: 'https://mcp.slack.com', authorization_servers: ['https://mcp.slack.com'],
      }));
      if (String(url).endsWith('/oauth-authorization-server')) return new Response(JSON.stringify({
        issuer: 'https://lookalike.example', authorization_endpoint: 'https://slack.com/oauth/v2_user/authorize',
        token_endpoint: 'https://slack.com/api/oauth.v2.user.access', code_challenge_methods_supported: ['S256'],
      }));
      throw new Error(`unexpected ${url}`);
    },
  }), /issuer does not match/u);
});
