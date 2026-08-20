import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

test('설정은 지속 T5 브라우저 상태를 보여주고 두 단계 확인 뒤 로그인만 초기화한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-browser-identity-settings-'));
  let resetCalls = 0;
  const browserHost = {
    profile: { id: 'default', kind: 'managed_persistent', selected: true },
    async reset({ confirmation }) {
      assert.equal(confirmation, 'RESET_T5_BROWSER'); resetCalls += 1; return { reset: true };
    },
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
  const post = (body) => fetch(`${base}/browser/identity/reset`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    const identity = await fetch(`${base}/browser/identity`).then((response) => response.json());
    assert.equal(identity.available, true);
    assert.equal(identity.profile.kind, 'managed_persistent');
    assert.equal((await post({ confirmation: 'wrong' })).status, 400);
    assert.equal(resetCalls, 0);
    const reset = await post({ confirmation: 'RESET_T5_BROWSER' });
    assert.equal(reset.status, 200);
    assert.equal(resetCalls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
