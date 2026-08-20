import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

async function post(base, path, input) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input ?? {}),
  });
  return { status: response.status, body: await response.json() };
}

for (const request of [
  '구글 계정 연동은 할 수 있어?',
  '내 드라이브 자료를 같이 보고 싶어.',
  '노션하고 이어서 일할 수 있게 해줘.',
]) test(`연결 목적 표현 “${request}”에 실제 연결 진실 도구가 같은 방식으로 제공된다`, async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-connection-language-'));
  let turn = 0;
  const modelFactory = () => ({ async respond(input) {
    turn += 1;
    const connection = input.tools.find((tool) => tool.name === 'connection');
    assert.ok(connection);
    assert.equal(input.tools.some((tool) => tool.name === 'connector_connect'), false);
    if (turn === 1) return {
      text: '', toolCalls: [{ id: 'connection-truth', name: 'connection', args: { action: 'list', id: null } }],
    };
    const receipt = JSON.parse(input.messages.at(-1).content);
    assert.equal(receipt.requestedCall.name, 'connection');
    assert.equal(receipt.result.state, 'listed');
    const google = receipt.result.connections.find((item) => item.id === 'google-workspace');
    assert.equal(google.state, 'needs_connection');
    assert.equal(google.routes.some((route) => route.kind === 'browser' && route.canStart), true);
    return { text: '전용 연결은 아직 없고 T5 브라우저 로그인을 시작할 수 있어요.', toolCalls: [] };
  } });
  const server = makeConsoleServer({
    stateDir: join(room, 'state'), workspace: room, modelFactory,
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    browserHost: { profile: { id: 'default', kind: 'managed_persistent', selected: true } },
    workspaceConnectionInspectors: [{
      id: 'google-workspace', label: 'Google Workspace', category: 'workspace',
      inspect: async () => ({
        state: 'needs_connection', reason: 'official_connector_not_installed',
        userSafeSummary: '전용 연결은 아직 없어요.', capabilities: {},
        routes: [{
          kind: 'browser', label: 'T5 브라우저', state: 'ready', canStart: true,
          startUrl: 'https://drive.google.com/',
        }],
      }),
    }],
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const answer = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: request }),
    }).then((response) => response.json());
    assert.match(answer.reply, /전용 연결은 아직 없/u);
    const run = await fetch(`${base}/runs/${answer.runId}`).then((response) => response.json());
    assert.equal(run.events.some((event) => (
      event.type === 'tool_completed' && event.payload.receipt.actualCall?.name === 'connection'
    )), true);
  } finally {
    server.closeWakeStreams(); await server.closeMessengers();
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('연결 진실의 준비된 브라우저 경로는 기존 로그인 handoff로 조합되고 전용 연결로 오인되지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-connection-browser-handoff-'));
  const calls = [];
  const driver = {
    profile: { id: 'default', kind: 'managed_persistent', selected: true },
    userControlActive: () => false,
    available: async () => ({ available: true, version: '0.34.0' }),
    async beginUserLogin(url) {
      calls.push(url);
      return {
        state: 'user_control_required', pageObserved: false, secretValuesObserved: false,
        profile: this.profile,
        tab: { tabId: 'google-login', targetId: 'google-target', title: 'Google Drive', url },
        handoff: { visible: true, inputOwner: 'user', modelActionsBlocked: true, canReveal: true },
      };
    },
    status: async () => ({ state: 'ready' }), profiles: async () => ({ profiles: [driver.profile] }),
    tabs: async () => ({ tabs: [] }), close: async () => {},
  };
  let turn = 0;
  const nulls = {
    url: null, tabId: null, full: null, maxChars: 20_000, fullPage: null,
    observationId: null, ref: null, text: null, filePath: null, effect: null,
  };
  const server = makeConsoleServer({
    stateDir: join(room, 'state'), workspace: room,
    browserHost: { profile: driver.profile }, browserDriverFactory: () => driver,
    workspaceConnectionInspectors: [{
      id: 'google-workspace', label: 'Google Workspace', category: 'workspace',
      inspect: async () => ({
        state: 'needs_connection', reason: 'official_connector_not_installed',
        userSafeSummary: '전용 연결은 아직 없어요.', capabilities: {},
        routes: [{
          kind: 'browser', label: 'T5 브라우저', state: 'ready', canStart: true,
          startUrl: 'https://drive.google.com/',
        }],
      }),
    }],
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond(input) {
      turn += 1;
      if (turn === 1) return { text: '', toolCalls: [{
        id: 'inspect-google', name: 'connection', args: { action: 'inspect', id: 'google-workspace' },
      }] };
      if (turn === 2) {
        const connection = JSON.parse(input.messages.at(-1).content).result.connection;
        assert.equal(connection.state, 'needs_connection');
        assert.equal(connection.routes[0].kind, 'browser');
        return { text: '', toolCalls: [{ id: 'start-google-login', name: 'browser', args: {
          action: 'login_start', ...nulls, url: connection.routes[0].startUrl,
        } }] };
      }
      const receipt = JSON.parse(input.messages.at(-1).content);
      assert.equal(receipt.result.state, 'user_control_required');
      return { text: '전용 연결은 아직 없어요. T5 브라우저에서 Google 계정 연결을 마쳐 주세요.', toolCalls: [] };
    } }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const answer = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '내 드라이브를 T5하고 같이 쓰게 연결해줘' }),
    }).then((response) => response.json());
    assert.deepEqual(calls, ['https://drive.google.com/']);
    assert.equal(answer.browserHandoff?.active, true);
    assert.equal(answer.browserHandoff?.visible, true);
    assert.match(answer.reply, /전용 연결은 아직 없/u);
  } finally {
    await server.closeBrowsers(); server.closeWakeStreams(); await server.closeMessengers();
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('자연어 계정 연결은 connection start 뒤 대화 내 OAuth handoff로 지속되고 완료 시 닫힌다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-connection-oauth-handoff-'));
  let connected = false;
  const service = {
    id: 'notion', label: 'Notion', category: 'workspace',
    inspect: async () => ({
      state: connected ? 'connected' : 'needs_connection',
      userSafeSummary: connected ? '연결됨' : '연결 필요', capabilities: {}, routes: [],
      actions: connected ? [] : [{
        id: 'connect', label: 'Notion 계정 연결', kind: 'oauth',
        startEndpoint: '/connections/notion/start', awaitEndpoint: '/connections/notion/await',
      }],
    }),
    async start() { return { authorizeUrl: 'https://notion.example/authorize?state=public' }; },
    async awaitConnection() { connected = true; return { connected: true, userSafeSummary: 'Notion을 연결했어요.' }; },
  };
  let turn = 0;
  const server = makeConsoleServer({
    stateDir: join(room, 'state'), workspace: room, workspaceConnectionServices: [service],
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond(input) {
      turn += 1;
      if (turn === 1) return { text: '', toolCalls: [{
        id: 'start-notion', name: 'connection', args: { action: 'start', id: 'notion' },
      }] };
      const receipt = JSON.parse(input.messages.at(-1).content);
      assert.equal(receipt.result.state, 'user_authorization_required');
      return { text: 'Notion 계정 연결 화면에서 허용해 주세요.', toolCalls: [] };
    } }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const answer = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '노션을 T5하고 연결해줘' }),
    }).then((response) => response.json());
    assert.equal(answer.connectionHandoff?.connectionId, 'notion');
    assert.equal(answer.connectionHandoff?.handoffId, answer.runId);
    let detail = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
    assert.deepEqual(detail.activeConnectionHandoffIds, [answer.runId]);
    const other = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    assert.notEqual(other.id, session.id);
    assert.deepEqual(
      (await fetch(`${base}/sessions/${other.id}`).then((response) => response.json())).activeConnectionHandoffIds,
      [],
    );
    detail = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
    assert.deepEqual(detail.activeConnectionHandoffIds, [answer.runId]);
    const completed = await fetch(`${base}/connections/notion/await`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, handoffId: answer.runId }),
    }).then((response) => response.json());
    assert.equal(completed.connected, true);
    detail = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
    assert.deepEqual(detail.activeConnectionHandoffIds, []);
    assert.equal(detail.transcript.some((entry) => (
      entry.role === 'system_event' && entry.event?.kind === 'connection_completed'
    )), true);
  } finally {
    server.closeWakeStreams(); await server.closeMessengers(); await server.closeWorkspaceConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('대화 안 계정 연결은 사용자가 즉시 취소할 수 있고 같은 대화에서 다시 시작할 수 있다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-connection-oauth-cancel-'));
  let pending = false;
  const service = {
    id: 'notion', label: 'Notion', category: 'workspace',
    inspect: async () => ({
      state: 'needs_connection', userSafeSummary: pending ? '사용자 확인을 기다리고 있어요.' : '연결 필요',
      capabilities: {}, routes: [], actions: pending ? [{
        id: 'cancel', label: '연결 취소', kind: 'cancel', endpoint: '/connections/notion/cancel',
      }] : [{
        id: 'connect', label: 'Notion 계정 연결', kind: 'oauth',
        startEndpoint: '/connections/notion/start', awaitEndpoint: '/connections/notion/await',
      }],
    }),
    async start() { pending = true; return { authorizeUrl: 'https://notion.example/authorize' }; },
    async cancelPending() {
      const cancelled = pending; pending = false;
      return { cancelled, userSafeSummary: cancelled ? 'Notion 계정 연결을 취소했어요.' : '진행 중인 연결이 없어요.' };
    },
  };
  let calls = 0;
  const server = makeConsoleServer({
    stateDir: join(room, 'state'), workspace: room, workspaceConnectionServices: [service],
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond(input) {
      calls += 1;
      if (calls % 2 === 1) return { text: '', toolCalls: [{
        id: `start-${calls}`, name: 'connection', args: { action: 'start', id: 'notion' },
      }] };
      return { text: 'Notion 연결 화면을 준비했어요.', toolCalls: [] };
    } }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const first = await post(base, '/turn', { sessionId: session.id, text: '노션 연결해줘' });
    const cancelled = await post(base, '/connections/notion/cancel', {
      sessionId: session.id, handoffId: first.body.runId,
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.cancelled, true);
    assert.deepEqual(
      (await fetch(`${base}/sessions/${session.id}`).then((response) => response.json())).activeConnectionHandoffIds,
      [],
    );
    const restarted = await post(base, '/turn', { sessionId: session.id, text: '다시 노션 연결해줘' });
    assert.equal(restarted.status, 200);
    assert.notEqual(restarted.body.connectionHandoff?.handoffId, first.body.runId);
  } finally {
    server.closeWakeStreams(); await server.closeMessengers(); await server.closeWorkspaceConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
