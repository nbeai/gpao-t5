import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

test('설정은 0.1.1의 대화별 T5 브라우저 로그인 경계를 정직하게 보여준다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-browser-identity-settings-'));
  const server = makeConsoleServer({
    stateDir: room, workspace: room, browserDriverFactory: async () => null,
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
    assert.equal(identity.connected, false);
    assert.equal(identity.profile.kind, 'managed_isolated');
    assert.match(identity.userSafeSummary, /로그인이 필요한 순간.*T5 브라우저/u);
    assert.equal((await fetch(`${base}/browser/identity/reset`, { method: 'POST' })).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
