import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRemoteMcpAuthorizeUrl } from '../src/remote-mcp-oauth.js';

const input = { metadata: { authorization_endpoint: 'https://accounts.example/authorize',
  scopes_supported: ['openid', 'drive.readonly'] }, client: { client_id: 't5-client' },
redirectUri: 'http://127.0.0.1:4186/', challenge: 'challenge', state: 'state',
requestedScopes: ['openid', 'drive.readonly'] };

test('Google형 offline·incremental parameter는 보안 필드를 건드리지 않고 authorization URL에 들어간다', () => {
  const url = new URL(buildRemoteMcpAuthorizeUrl({ ...input,
    authorizationParameters: { access_type: 'offline', include_granted_scopes: 'true' } }));
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('include_granted_scopes'), 'true');
  assert.equal(url.searchParams.get('state'), 'state'); assert.equal(url.searchParams.get('client_id'), 't5-client');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge');
});

test('catalog나 provider adapter는 state·redirect·client·PKCE·임의 authorization parameter를 덮어쓸 수 없다', () => {
  for (const authorizationParameters of [
    { state: 'evil' }, { redirect_uri: 'https://evil.example' }, { client_id: 'evil' },
    { code_challenge: 'evil' }, { prompt: 'none' }, { arbitrary: 'value' },
    { access_type: 'online' }, { include_granted_scopes: 'false' },
  ]) assert.throws(() => buildRemoteMcpAuthorizeUrl({ ...input, authorizationParameters }), /authorization parameter/u);
});
