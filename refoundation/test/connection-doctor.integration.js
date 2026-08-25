import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { makeApiCredentialConnection } from '../src/api-credential-connection.js';

test('연결 닥터와 기존 connector truth는 같은 실제 연결 목록을 사용한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-connection-doctor-'));
  const workspaceConnectionInspectors = [{
    id: 'google-workspace', label: 'Google Workspace', category: 'workspace',
    async inspect() {
      return {
        state: 'unavailable', reason: 'official_connector_not_installed',
        userSafeSummary: '전용 연결은 아직 없고 T5 브라우저 로그인만 사용할 수 있어요.',
        capabilities: { search: false, read: false, create: false, update: false, download: false, upload: false },
        routes: [{ kind: 'browser', label: 'T5 브라우저', state: 'ready', canStart: true }],
      };
    },
  }];
  const server = makeConsoleServer({
    stateDir: join(room, 'state'), workspace: room, workspaceConnectionInspectors,
    browserDriverFactory: async () => null,
    modelFactory: () => ({ respond: async () => ({ text: '네', toolCalls: [] }) }),
    modelStatus: () => ({
      connected: true, provider: 'fixture', modelId: 'fixture',
      connections: [{ id: 'fixture:model', provider: 'fixture', modelId: 'fixture', active: true }],
      accessToken: 'NEVER-EXPOSE',
    }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const doctor = await fetch(`${base}/connections/doctor`).then((response) => response.json());
    const truth = await fetch(`${base}/connectors/truth`).then((response) => response.json());
    assert.deepEqual(doctor.connections.map(({ id, state }) => ({ id, state })), [
      { id: 'model', state: 'connected' },
      { id: 'telegram', state: 'needs_connection' },
      { id: 't5-browser', state: 'ready' },
      { id: 'google-workspace', state: 'unavailable' },
    ]);
    assert.deepEqual(truth.connectors.map(({ id, state }) => ({ id, state })),
      doctor.connections.map(({ id, state }) => ({ id, state })));
    assert.doesNotMatch(JSON.stringify({ doctor, truth }), /NEVER-EXPOSE|accessToken/u);
  } finally {
    server.closeWakeStreams(); await server.closeMessengers();
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('설정의 범용 OAuth 연결·완료·해제 endpoint는 등록된 업무공간 서비스만 호출한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-workspace-connection-actions-'));
  let connected = false;
  const calls = [];
  const service = {
    id: 'google-workspace', label: 'Google Workspace', category: 'workspace',
    inspect: async () => ({
      state: connected ? 'connected' : 'needs_connection',
      userSafeSummary: connected ? '연결됨' : '연결 필요', capabilities: {}, routes: [],
      actions: connected ? [{
        id: 'disconnect', label: '연결 해제', kind: 'disconnect',
        endpoint: '/connections/google-workspace/disconnect',
      }] : [{
        id: 'connect', label: 'Google 계정 연결', kind: 'oauth',
        startEndpoint: '/connections/google-workspace/start',
        awaitEndpoint: '/connections/google-workspace/await',
      }],
    }),
    async start() { calls.push('start'); return { authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=public' }; },
    async awaitConnection() { calls.push('await'); connected = true; return { connected: true, userSafeSummary: 'Google Drive를 연결했어요.' }; },
    async disconnect() { calls.push('disconnect'); connected = false; return { disconnected: true, userSafeSummary: 'Google Drive 연결을 해제했어요.' }; },
  };
  const server = makeConsoleServer({
    stateDir: join(room, 'state'), workspace: room, workspaceConnectionServices: [service],
    modelFactory: () => ({ respond: async () => ({ text: '네', toolCalls: [] }) }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const postAction = (path) => fetch(`${base}${path}`, { method: 'POST' });
  try {
    const before = await fetch(`${base}/connections/doctor`).then((response) => response.json());
    assert.equal(before.connections.find((item) => item.id === 'google-workspace').actions[0].kind, 'oauth');
    assert.equal((await postAction('/connections/google-workspace/start')).status, 200);
    assert.equal((await postAction('/connections/google-workspace/await')).status, 200);
    const after = await fetch(`${base}/connections/doctor`).then((response) => response.json());
    assert.equal(after.connections.find((item) => item.id === 'google-workspace').state, 'connected');
    assert.equal((await postAction('/connections/google-workspace/disconnect')).status, 200);
    assert.deepEqual(calls, ['start', 'await', 'disconnect']);
    assert.equal((await postAction('/connections/not-registered/start')).status, 404);
  } finally {
    server.closeWakeStreams(); await server.closeMessengers(); server.closeWorkspaceConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('설정의 사용자 행동 endpoint는 현재 연결 진실에 남아 있는 exact action만 실행한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-workspace-user-action-'));
  const calls = [];
  const service = {
    id: 'google-workspace', label: 'Google Workspace', category: 'workspace',
    inspect: async () => ({
      state: 'needs_connection', userSafeSummary: '설치 필요', capabilities: {}, routes: [],
      actions: [{
        id: 'install_drive_desktop', label: 'Google Drive 설치하기', kind: 'user_action',
        endpoint: '/connections/google-workspace/action',
      }],
    }),
    async performAction(actionId) {
      calls.push(actionId);
      return { performed: true, userSafeSummary: 'Google 공식 설치 안내를 열었어요.' };
    },
  };
  const server = makeConsoleServer({
    stateDir: join(room, 'state'), workspace: room, workspaceConnectionServices: [service],
    modelFactory: () => ({ respond: async () => ({ text: '네', toolCalls: [] }) }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (actionId) => fetch(`${base}/connections/google-workspace/action`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actionId }),
  });
  try {
    assert.equal((await post('install_drive_desktop')).status, 200);
    assert.equal((await post('stale-action')).status, 409);
    assert.deepEqual(calls, ['install_drive_desktop']);
  } finally {
    server.closeWakeStreams(); await server.closeMessengers(); await server.closeWorkspaceConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('설정의 사업자 credential endpoint는 비밀을 응답하지 않고 검증된 계정만 ready로 연다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-workspace-credential-action-'));
  const values = new Map(); const secret = 'CHANNEL-SECRET-NEVER-RETURN';
  const service = makeApiCredentialConnection({
    id: 'channel-talk', label: 'Channel Talk', category: 'customer_channel',
    secretStore: { async get(key) { return structuredClone(values.get(key) ?? null); },
      async set(key, value) { values.set(key, structuredClone(value)); }, async clear(key) { values.delete(key); } },
    credentialFields: [{ id: 'accessKey', label: 'Access Key', secret: true },
      { id: 'accessSecret', label: 'Access Secret', secret: true }],
    verifyCredentials: async () => ({ accountId: 'channel-42', accountLabel: '우리 가게',
      permissions: ['conversations:read'], capabilities: { read: true, reply: true } }),
  });
  const server = makeConsoleServer({
    stateDir: join(room, 'state'), workspace: room, workspaceConnectionServices: [service],
    modelFactory: () => ({ respond: async () => ({ text: '네', toolCalls: [] }) }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const before = await fetch(`${base}/connections/doctor`).then((response) => response.json());
    const candidate = before.connections.find((item) => item.id === 'channel-talk');
    assert.equal(candidate.actions[0].kind, 'credentials');
    assert.deepEqual(candidate.credentialRequest.fields.map((field) => field.id), ['accessKey', 'accessSecret']);
    const response = await fetch(`${base}/connections/channel-talk/credentials`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credentials: {
        accessKey: 'CHANNEL-ACCESS', accessSecret: secret,
      } }) });
    assert.equal(response.status, 200); const text = await response.text(); assert.doesNotMatch(text, new RegExp(secret));
    const after = await fetch(`${base}/connections/doctor`).then((result) => result.json());
    const ready = after.connections.find((item) => item.id === 'channel-talk');
    assert.equal(ready.state, 'ready'); assert.equal(ready.identity.accountId, 'channel-42');
    assert.doesNotMatch(JSON.stringify(after), new RegExp(secret));
  } finally {
    server.closeWakeStreams(); await server.closeMessengers(); await server.closeWorkspaceConnections();
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});
