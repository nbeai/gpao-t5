import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

test('설정은 사용자 Chrome 연결 상태만 보여주고 T5가 로그인 정보를 지우지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-browser-identity-settings-'));
  const browserHost = {
    profile: { id: 'user-chrome', kind: 'existing_user_browser', selected: true },
    status: () => ({ connected: true }),
  };
  const server = makeConsoleServer({
    stateDir: room, workspace: room, browserHost,
    modelFactory: async () => ({ respond: async () => ({ text: '네', toolCalls: [] }) }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const identity = await fetch(`${base}/browser/identity`).then((response) => response.json());
    assert.equal(identity.available, true);
    assert.equal(identity.connected, true);
    assert.equal(identity.profile.kind, 'existing_user_browser');
    assert.match(identity.userSafeSummary, /로그인 정보는 Chrome에 그대로/u);
    assert.equal((await fetch(`${base}/browser/identity/reset`, { method: 'POST' })).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
