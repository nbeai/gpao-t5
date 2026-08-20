import test from 'node:test';
import assert from 'node:assert/strict';

import { makeConnectionDoctor } from '../src/connection-truth.js';

test('연결 닥터는 서로 다른 연결 방식을 같은 사용자 상태로 모으고 비밀·원문 오류를 버린다', async () => {
  const doctor = makeConnectionDoctor({ inspectors: [
    {
      id: 'workspace-a', label: '업무공간 A', category: 'workspace',
      async inspect() {
        return {
          state: 'connected', userSafeSummary: '연결되어 있어요.',
          capabilities: { search: true, read: true, update: false },
          routes: [{ kind: 'official', label: '공식 연결', state: 'connected', canStart: false }],
          token: 'MUST-NOT-LEAK', raw: { authorization: 'Bearer SECRET' },
        };
      },
    },
    {
      id: 'workspace-b', label: '업무공간 B', category: 'workspace',
      async inspect() { throw new Error('provider failed with token SECRET-2'); },
    },
  ] });
  const report = await doctor.inspect();
  assert.deepEqual(report.connections.map((item) => item.id), ['workspace-a', 'workspace-b']);
  assert.equal(report.connections[0].state, 'connected');
  assert.deepEqual(report.connections[0].capabilities, { search: true, read: true, update: false });
  assert.equal(report.connections[1].state, 'needs_attention');
  assert.match(report.connections[1].userSafeSummary, /상태를 확인하지 못했어요/u);
  assert.doesNotMatch(JSON.stringify(report), /MUST-NOT-LEAK|SECRET-2|authorization|Bearer/u);
});

test('검사가 끝나지 않는 연결 하나가 전체 연결 상태 확인을 가두지 않는다', async () => {
  const doctor = makeConnectionDoctor({
    timeoutMs: 20,
    inspectors: [{
      id: 'stuck', label: '응답 없는 업무공간', category: 'workspace',
      inspect: () => new Promise(() => {}),
    }],
  });
  const started = Date.now();
  const report = await doctor.inspect();
  assert.ok(Date.now() - started < 500);
  assert.equal(report.connections[0].state, 'needs_attention');
  assert.equal(report.connections[0].reason, 'check_timeout');
});

test('검사 정의의 중복 id와 내부 기술 상태는 사용자 연결 진실로 승격하지 않는다', async () => {
  assert.throws(() => makeConnectionDoctor({ inspectors: [
    { id: 'same', label: 'A', category: 'workspace', inspect: async () => ({ state: 'connected' }) },
    { id: 'same', label: 'B', category: 'workspace', inspect: async () => ({ state: 'connected' }) },
  ] }), /duplicate/u);
  await assert.rejects(() => makeConnectionDoctor({ inspectors: [{
    id: 'bad', label: 'Bad', category: 'workspace', inspect: async () => ({ state: 'oauth_pending_internal' }),
  }] }).inspect(), /invalid connection state/u);
});
