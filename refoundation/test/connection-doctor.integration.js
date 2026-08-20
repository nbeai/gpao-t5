import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

test('연결 닥터와 기존 connector truth는 같은 실제 연결 목록을 사용한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-connection-doctor-'));
  const browserHost = { profile: { id: 'default', kind: 'managed_persistent', selected: true } };
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
    stateDir: join(room, 'state'), workspace: room, browserHost, workspaceConnectionInspectors,
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
