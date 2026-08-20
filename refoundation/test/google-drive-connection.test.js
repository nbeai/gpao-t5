import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeGoogleDriveConnection } from '../src/google-drive-connection.js';
import { WorkspaceCredentialStore } from '../src/workspace-credential-store.js';

test('Google Drive 연결은 사용자 OAuth 완료 뒤 실제 Drive API 확인에 성공해야 저장된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-google-connection-'));
  const store = new WorkspaceCredentialStore(room);
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), authorization: options.headers?.authorization ?? null });
    if (String(url) === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({
      access_token: 'GOOGLE-ACCESS', refresh_token: 'GOOGLE-REFRESH', expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/drive', token_type: 'Bearer',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (String(url).startsWith('https://www.googleapis.com/drive/v3/about')) return new Response(JSON.stringify({
      user: { permissionId: 'permission-id' }, storageQuota: { usage: '123' },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error(`unexpected URL ${url}`);
  };
  const connection = makeGoogleDriveConnection({
    store, clientId: 'desktop-client.apps.googleusercontent.com', fetchImpl,
  });
  try {
    const before = await connection.inspect();
    assert.equal(before.state, 'needs_connection');
    assert.equal(before.actions[0].kind, 'oauth');
    const started = await connection.start();
    const authorize = new URL(started.authorizeUrl);
    const redirectUri = authorize.searchParams.get('redirect_uri');
    const callback = await fetch(`${redirectUri}?code=AUTH-CODE&state=${authorize.searchParams.get('state')}`);
    assert.equal(callback.status, 200);
    const connected = await connection.awaitConnection();
    assert.equal(connected.connected, true);
    const after = await connection.inspect();
    assert.equal(after.state, 'connected');
    assert.equal(after.actions[0].kind, 'disconnect');
    assert.equal(calls.some((call) => call.authorization === 'Bearer GOOGLE-ACCESS'), true);
    assert.equal((await store.get('google-workspace')).credential.refreshToken, 'GOOGLE-REFRESH');
    assert.doesNotMatch(JSON.stringify({ started, connected, inspected: await connection.inspect() }),
      /GOOGLE-ACCESS|GOOGLE-REFRESH|permission-id/u);
  } finally {
    connection.close(); await rm(room, { recursive: true, force: true });
  }
});

test('OAuth client가 없는 배포는 브라우저 fallback과 공식 연결 부재를 정직하게 구분한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-google-no-client-'));
  const connection = makeGoogleDriveConnection({ store: new WorkspaceCredentialStore(room), clientId: null });
  try {
    const inspected = await connection.inspect({ browserAvailable: true });
    assert.equal(inspected.state, 'needs_connection');
    assert.equal(inspected.routes.find((route) => route.kind === 'official').state, 'unavailable');
    assert.equal(inspected.routes.find((route) => route.kind === 'browser').state, 'ready');
    await assert.rejects(() => connection.start(), (error) => error.status === 503);
  } finally { connection.close(); await rm(room, { recursive: true, force: true }); }
});

test('만료된 Google access token은 refresh 뒤 0600 저장소와 API 호출에만 사용된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-google-refresh-'));
  const store = new WorkspaceCredentialStore(room);
  await store.setVerified('google-workspace', {
    credential: {
      accessToken: 'OLD-ACCESS', refreshToken: 'REFRESH-SECRET', expiresAt: 1,
      scopes: ['https://www.googleapis.com/auth/drive'], tokenType: 'Bearer',
    }, scopes: ['https://www.googleapis.com/auth/drive'],
  });
  const seen = [];
  const fetchImpl = async (url, options = {}) => {
    if (String(url) === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({
      access_token: 'NEW-ACCESS', expires_in: 3600, token_type: 'Bearer',
      scope: 'https://www.googleapis.com/auth/drive',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    seen.push(options.headers?.authorization);
    return new Response(JSON.stringify({ user: {}, storageQuota: {} }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  const connection = makeGoogleDriveConnection({
    store, clientId: 'desktop-client', fetchImpl, now: () => 10_000,
  });
  try {
    await connection.verify();
    assert.deepEqual(seen, ['Bearer NEW-ACCESS']);
    assert.equal((await store.get('google-workspace')).credential.accessToken, 'NEW-ACCESS');
    assert.equal((await store.get('google-workspace')).credential.refreshToken, 'REFRESH-SECRET');
    assert.doesNotMatch(JSON.stringify(await connection.inspect()), /NEW-ACCESS|REFRESH-SECRET/u);
  } finally { connection.close(); await rm(room, { recursive: true, force: true }); }
});

test('동시에 들어온 Google 연결 시작도 callback을 하나만 연다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-google-start-race-'));
  const connection = makeGoogleDriveConnection({
    store: new WorkspaceCredentialStore(room), clientId: 'desktop-client',
  });
  try {
    const results = await Promise.allSettled([connection.start(), connection.start()]);
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
    const rejected = results.find((item) => item.status === 'rejected');
    assert.equal(rejected.reason.status, 409);
    assert.equal(rejected.reason.reason, 'oauth_in_progress');
    assert.equal((await connection.inspect()).actions[0].kind, 'cancel');
    assert.equal((await connection.cancelPending()).cancelled, true);
    assert.equal((await connection.inspect()).actions[0].kind, 'oauth');
    assert.equal((await connection.start()).authorizeUrl.includes('accounts.google.com'), true);
  } finally { connection.close(); await rm(room, { recursive: true, force: true }); }
});

test('Finder에 로그인된 Google Drive가 있으면 공식 API 미연결과 별개로 일반 파일 경로를 사용 가능으로 올린다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-google-local-sync-'));
  const connection = makeGoogleDriveConnection({
    store: new WorkspaceCredentialStore(room), clientId: 'desktop-client',
    localSyncAvailable: async () => true,
  });
  try {
    const truth = await connection.inspect();
    assert.equal(truth.state, 'ready');
    assert.equal(truth.reason, 'local_sync_available');
    assert.equal(truth.capabilities.read, true);
    assert.equal(truth.capabilities.upload, true);
    assert.equal(truth.routes.some((route) => route.kind === 'local_sync' && route.state === 'ready'), true);
    assert.equal(truth.actions[0].kind, 'oauth');
  } finally { connection.close(); await rm(room, { recursive: true, force: true }); }
});
