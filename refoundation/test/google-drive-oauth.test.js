import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGoogleDriveAuthorizeUrl, createGoogleDrivePkce, exchangeGoogleDriveCode,
  refreshGoogleDriveCredential, startGoogleDriveCallback,
} from '../src/google-drive-oauth.js';

test('Google Drive 데스크톱 OAuth는 PKCE S256·state·127.0.0.1 callback과 전체 Drive 범위를 명시한다', () => {
  const pkce = createGoogleDrivePkce((length) => Buffer.alloc(length, 7));
  const authorize = new URL(buildGoogleDriveAuthorizeUrl({
    clientId: 'desktop-client.apps.googleusercontent.com', redirectUri: 'http://127.0.0.1:49123/', ...pkce,
  }));
  assert.equal(authorize.origin, 'https://accounts.google.com');
  assert.equal(authorize.searchParams.get('response_type'), 'code');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorize.searchParams.get('state'), pkce.state);
  assert.equal(authorize.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive');
  assert.equal(authorize.searchParams.get('access_type'), 'offline');
  assert.equal(authorize.searchParams.get('include_granted_scopes'), 'true');
  assert.equal(authorize.searchParams.has('client_secret'), false);
});

test('Google authorization code와 refresh token은 공식 token endpoint wire로 교환된다', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), body: new URLSearchParams(options.body) });
    return new Response(JSON.stringify({
      access_token: calls.length === 1 ? 'ACCESS-1' : 'ACCESS-2',
      refresh_token: calls.length === 1 ? 'REFRESH-1' : undefined,
      expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive', token_type: 'Bearer',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const credential = await exchangeGoogleDriveCode({
    clientId: 'desktop-client', code: 'CODE', verifier: 'VERIFIER', redirectUri: 'http://127.0.0.1:4000/',
  }, { fetchImpl, now: () => 1_000 });
  assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token');
  assert.equal(calls[0].body.get('grant_type'), 'authorization_code');
  assert.equal(calls[0].body.get('code_verifier'), 'VERIFIER');
  assert.equal(calls[0].body.has('client_secret'), false);
  assert.equal(credential.accessToken, 'ACCESS-1');
  assert.equal(credential.refreshToken, 'REFRESH-1');
  const refreshed = await refreshGoogleDriveCredential({
    clientId: 'desktop-client', credential,
  }, { fetchImpl, now: () => 2_000 });
  assert.equal(calls[1].body.get('grant_type'), 'refresh_token');
  assert.equal(refreshed.accessToken, 'ACCESS-2');
  assert.equal(refreshed.refreshToken, 'REFRESH-1');
});

test('Google callback은 임의 loopback port에서 정확한 state만 받고 비밀을 HTML에 쓰지 않는다', async () => {
  const callback = startGoogleDriveCallback({ state: 'EXPECTED', timeoutMs: 2_000 });
  const { redirectUri } = await callback.listening;
  try {
    const response = await fetch(`${redirectUri}?code=AUTH-CODE&state=EXPECTED`);
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /AUTH-CODE|EXPECTED/u);
    assert.equal(await callback.waitForCode, 'AUTH-CODE');
  } finally { callback.cancel(); }
});

test('Google token 오류는 응답 원문과 credential을 사용자 오류로 반사하지 않는다', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    error: 'invalid_grant', error_description: 'leaked CODE-SECRET',
  }), { status: 400, headers: { 'content-type': 'application/json' } });
  await assert.rejects(() => exchangeGoogleDriveCode({
    clientId: 'client', code: 'CODE-SECRET', verifier: 'VERIFIER-SECRET', redirectUri: 'http://127.0.0.1:4000/',
  }, { fetchImpl }), (error) => {
    assert.equal(error.status, 400);
    assert.doesNotMatch(error.message, /CODE-SECRET|VERIFIER-SECRET|leaked/u);
    return true;
  });
});
