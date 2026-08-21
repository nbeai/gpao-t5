import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { makeUserBrowserConnection } from '../src/user-browser-connection.js';

test('제품 진입점은 전용 browser host·profile을 시작하지 않는다', async () => {
  const source = await readFile(new URL('../scripts/start-console.mjs', import.meta.url), 'utf8');
  assert.match(source, /makeUserChromeMcpRuntime/u);
  assert.match(source, /existing_user_browser/u);
  assert.doesNotMatch(source, /makePersistentBrowserHost|makeAgentBrowserDriver|managed_persistent/u);
});

test('내 브라우저 연결은 전용 profile을 만들지 않고 Chrome의 명시 허용 화면을 한 번만 연다', async () => {
  let connected = false; let connectCalls = 0; const opened = [];
  const connection = makeUserBrowserConnection({
    runtime: {
      status: () => ({ connected }),
      async connect() { connectCalls += 1; connected = true; },
      async close() { connected = false; },
    },
    openPage: (url) => { opened.push(url); return { opened: true }; },
  });
  const before = await connection.inspect();
  assert.equal(before.state, 'needs_connection');
  assert.deepEqual(before.actions.map((action) => action.id), ['connect-user-chrome']);
  const started = await connection.performAction('connect-user-chrome');
  assert.equal(started.performed, true);
  assert.deepEqual(opened, ['chrome://inspect/#remote-debugging']);
  await new Promise((resolve) => setTimeout(resolve, 850));
  assert.equal(connectCalls, 1);
  assert.equal((await connection.inspect()).state, 'connected');
  const stopped = await connection.disconnect();
  assert.match(stopped.userSafeSummary, /Chrome의 로그인은 그대로/u);
  assert.equal((await connection.inspect()).state, 'needs_connection');
});
