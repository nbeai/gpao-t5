import test from 'node:test';
import assert from 'node:assert/strict';

import { inspectNotionCli, makeNotionCliInspector } from '../src/notion-cli-inspector.js';

test('공식 Notion CLI가 없으면 없는 경로를 연결된 것으로 꾸미지 않는다', async () => {
  const result = await inspectNotionCli({ locate: async () => null });
  assert.deepEqual(result, {
    installed: false, authenticated: false, state: 'unavailable', reason: 'notion_cli_not_installed',
  });
});

test('Notion CLI는 실제 사용자 조회가 성공한 경우에만 인증됨으로 판정한다', async () => {
  const calls = [];
  const result = await inspectNotionCli({
    locate: async () => '/fixture/ntn',
    execute: async (command, args) => {
      calls.push({ command, args });
      return { code: 0, stdout: JSON.stringify({ object: 'user', id: 'user-1', name: '비공개 사용자' }), stderr: '' };
    },
  });
  assert.deepEqual(calls, [{ command: '/fixture/ntn', args: ['api', 'v1/users/me'] }]);
  assert.deepEqual(result, {
    installed: true, authenticated: true, state: 'ready', reason: 'notion_cli_authenticated',
  });
  assert.doesNotMatch(JSON.stringify(result), /비공개 사용자/u);
});

test('실행 파일만 있고 계정 조회가 실패하면 로그인 필요로 남긴다', async () => {
  const result = await inspectNotionCli({
    locate: async () => '/fixture/ntn',
    execute: async () => ({ code: 1, stdout: '', stderr: 'secret diagnostic' }),
  });
  assert.deepEqual(result, {
    installed: true, authenticated: false, state: 'needs_connection', reason: 'notion_cli_login_required',
  });
  assert.doesNotMatch(JSON.stringify(result), /secret diagnostic/u);
});

test('연결 닥터의 반복 조회는 짧은 시간 안에 Notion 계정 네트워크 검사를 되풀이하지 않는다', async () => {
  let clock = 1_000;
  let calls = 0;
  const inspect = makeNotionCliInspector({
    ttlMs: 30_000, now: () => clock,
    locate: async () => '/fixture/ntn',
    execute: async () => {
      calls += 1;
      return { code: 0, stdout: JSON.stringify({ id: 'user-1' }), stderr: '' };
    },
  });
  assert.equal((await inspect()).authenticated, true);
  assert.equal((await inspect()).authenticated, true);
  assert.equal(calls, 1);
  clock += 30_001;
  await inspect();
  assert.equal(calls, 2);
});
