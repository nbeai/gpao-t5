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

test('연결 도구는 연결 실행을 꾸미지 않고 조회 두 행동만 제공한다', () => {
  const tool = makeConnectionTool({ doctor: { inspect: async () => report } });
  assert.deepEqual(tool.parameters.properties.action.enum, ['list', 'inspect']);
  assert.doesNotMatch(JSON.stringify(tool.parameters), /connector_connect|oauth_start|install/u);
});
