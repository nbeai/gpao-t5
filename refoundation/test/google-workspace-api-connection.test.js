import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConnectionCredentialCoordinator } from '../src/connection-credential-coordinator.js';
import { ConnectionStateStore } from '../src/connection-state-store.js';
import { makeGoogleWorkspaceApiConnection } from '../src/google-workspace-api-connection.js';

function memorySecrets() {
  const values = new Map();
  return {
    values,
    async get(key) { return structuredClone(values.get(key) ?? null); },
    async set(key, value) { values.set(key, structuredClone(value)); },
    async clear(key) { values.delete(key); },
  };
}

async function fixture(fetchImpl, options = {}) {
  const room = await mkdtemp(join(tmpdir(), 't5-google-api-connection-'));
  const secretStore = memorySecrets();
  const stateStore = new ConnectionStateStore(join(room, 'connection.sqlite'));
  let sequence = 0;
  const coordinator = new ConnectionCredentialCoordinator({
    stateStore, secretStore, makeId: () => `credential-${++sequence}`,
  });
  const connection = makeGoogleWorkspaceApiConnection({
    secretStore, stateStore, credentialCoordinator: coordinator,
    clientId: 'desktop-client.apps.googleusercontent.com', callbackPort: 0,
    fetchImpl, ...options,
  });
  return { room, secretStore, stateStore, connection };
}

test('Google 로그인은 계정·Drive protected probe 뒤에만 연결되고 읽기 손만 연다', async () => {
  const calls = [];
  const f = await fixture(async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET',
      authorization: init.headers?.authorization ?? null, body: String(init.body ?? '') });
    if (String(url) === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({
      access_token: 'GOOGLE-ACCESS', refresh_token: 'GOOGLE-REFRESH', expires_in: 3600,
      token_type: 'Bearer',
      scope: 'openid email profile https://www.googleapis.com/auth/drive.readonly',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (String(url) === 'https://openidconnect.googleapis.com/v1/userinfo') return new Response(JSON.stringify({
      sub: 'google-account-1', email: 'owner@example.com', hd: 'example.com',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (String(url).startsWith('https://www.googleapis.com/drive/v3/about')) return new Response(JSON.stringify({
      user: { permissionId: 'drive-user-1', displayName: 'Owner' }, storageQuota: { usage: '1' },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error(`unexpected URL ${url}`);
  });
  try {
    const before = await f.connection.inspect();
    assert.equal(before.state, 'needs_connection');
    assert.equal(before.actions[0].label, 'Google 계정 연결');

    const started = await f.connection.start();
    const authorize = new URL(started.authorizeUrl);
    assert.equal(authorize.origin, 'https://accounts.google.com');
    assert.equal(authorize.searchParams.get('client_id'), 'desktop-client.apps.googleusercontent.com');
    assert.match(authorize.searchParams.get('scope'), /drive\.readonly/u);
    assert.doesNotMatch(authorize.searchParams.get('scope'), /auth\/drive(?:\s|$)/u);
    assert.equal(authorize.searchParams.get('access_type'), 'offline');
    assert.equal((await f.connection.inspect()).state, 'needs_connection');

    const callback = new URL(authorize.searchParams.get('redirect_uri'));
    const awaiting = f.connection.awaitConnection();
    const page = await fetch(`${callback}?code=GOOGLE-CODE&state=${encodeURIComponent(authorize.searchParams.get('state'))}`);
    assert.doesNotMatch(await page.text(), /연결됐|연결을 완료|연결됨/u);
    assert.equal((await awaiting).connected, true);

    const after = await f.connection.inspect();
    assert.equal(after.state, 'connected');
    assert.equal(after.identity.accountId, 'google-account-1');
    assert.equal(after.identity.accountLabel, 'owner@example.com');
    assert.deepEqual(after.capabilities, {
      search: true, read: true, create: false, update: false, download: true, upload: false,
    });
    const tool = await f.connection.makeTool({
      attachments: { receive: async () => ({ id: 'artifact-1' }) }, sessionId: 'session-1',
    });
    assert.deepEqual(tool.parameters.properties.action.enum, ['search', 'metadata', 'download']);
    assert.doesNotMatch(JSON.stringify({ started, after, tool: tool.parameters }), /GOOGLE-ACCESS|GOOGLE-REFRESH/u);
    assert.equal(calls.filter((call) => call.authorization === 'Bearer GOOGLE-ACCESS').length, 2);
  } finally {
    await f.connection.close(); f.stateStore.close(); await rm(f.room, { recursive: true, force: true });
  }
});

test('OAuth token만 받아도 Drive probe가 실패하면 기존 상태를 ready로 꾸미지 않는다', async () => {
  const f = await fixture(async (url) => {
    if (String(url) === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({
      access_token: 'ACCESS', refresh_token: 'REFRESH', expires_in: 3600,
      scope: 'openid email profile https://www.googleapis.com/auth/drive.readonly',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (String(url).includes('/userinfo')) return new Response(JSON.stringify({
      sub: 'account-1', email: 'owner@example.com',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (String(url).includes('/drive/v3/about')) return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403, headers: { 'content-type': 'application/json' },
    });
    throw new Error(`unexpected URL ${url}`);
  });
  try {
    const authorize = new URL((await f.connection.start()).authorizeUrl);
    const awaiting = f.connection.awaitConnection();
    const rejected = assert.rejects(awaiting, /Google Drive 읽기 권한/u);
    await fetch(`${authorize.searchParams.get('redirect_uri')}?code=CODE&state=${encodeURIComponent(authorize.searchParams.get('state'))}`);
    await rejected;
    assert.equal((await f.connection.inspect()).state, 'needs_connection');
    assert.equal(await f.connection.makeTool({ attachments: {}, sessionId: 's' }), null);
  } finally {
    await f.connection.close(); f.stateStore.close(); await rm(f.room, { recursive: true, force: true });
  }
});
