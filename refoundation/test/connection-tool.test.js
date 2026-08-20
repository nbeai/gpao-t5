import test from 'node:test';
import assert from 'node:assert/strict';

import { makeConnectionTool } from '../src/connection-tool.js';

const report = {
  schema: 't5.connection-truth.v1', checkedAt: '2026-08-20T00:00:00.000Z',
  userSafeSummary: '연결 상태를 확인했어요.', counts: {},
  connections: [{
    id: 'google-workspace', label: 'Google Workspace', category: 'workspace',
    state: 'needs_connection', reason: 'official_connector_not_installed',
    userSafeSummary: '전용 연결은 아직 없어요.', capabilities: { search: false },
    routes: [{
      kind: 'browser', label: 'T5 브라우저', state: 'ready', canStart: true,
      startUrl: 'https://drive.google.com/',
    }],
  }],
};

test('모델은 사용자의 표현을 규칙으로 분류하지 않고 연결 진실을 도구로 직접 확인한다', async () => {
  let inspected = 0;
  const tool = makeConnectionTool({ doctor: { async inspect() { inspected += 1; return report; } } });
  assert.equal(tool.name, 'connection');
  assert.match(tool.description, /connect|link|연결|account data/i);
  const listed = await tool.execute({ action: 'list', id: null });
  assert.equal(listed.state, 'listed');
  assert.equal(listed.connections[0].id, 'google-workspace');
  const detail = await tool.execute({ action: 'inspect', id: 'google-workspace' });
  assert.equal(detail.state, 'inspected');
  assert.equal(detail.connection.routes[0].startUrl, 'https://drive.google.com/');
  assert.equal(inspected, 2);
  await assert.rejects(() => tool.execute({ action: 'inspect', id: 'missing' }), /not found/u);
});

test('연결 도구는 설치나 자격 입력을 꾸미지 않고 조회·사용자 동의 시작만 제공한다', () => {
  const tool = makeConnectionTool({
    doctor: { inspect: async () => report },
    startConnection: async (id) => ({
      connection: { id, label: 'Google Workspace' },
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=public',
      awaitEndpoint: '/connections/google-workspace/await',
    }),
  });
  assert.deepEqual(tool.parameters.properties.action.enum, ['list', 'inspect', 'start']);
  assert.doesNotMatch(JSON.stringify(tool.parameters), /connector_connect|oauth_start|install/u);
});

test('연결 시작은 등록된 서비스의 사용자 동의 handoff만 반환하고 자격을 받지 않는다', async () => {
  const tool = makeConnectionTool({
    doctor: { inspect: async () => report },
    startConnection: async (id) => ({
      connection: { id, label: 'Google Workspace' },
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=public',
      awaitEndpoint: '/connections/google-workspace/await',
    }),
  });
  const started = await tool.execute({ action: 'start', id: 'google-workspace' });
  assert.equal(started.state, 'user_authorization_required');
  assert.equal(started.connection.id, 'google-workspace');
  assert.match(started.authorizeUrl, /^https:\/\/accounts\.google\.com/u);
  assert.equal(started.awaitEndpoint, '/connections/google-workspace/await');
  assert.doesNotMatch(JSON.stringify(started), /access_token|refresh_token|client_secret/u);
});
