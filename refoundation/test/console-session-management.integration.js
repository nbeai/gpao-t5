import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}
async function post(base, path, body) {
  return fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body) });
}

test('전체 대화 검색은 active·archived 원문을 찾고 deleted와 기억 변경을 제외한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-global-session-search-'));
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace: room,
    modelFactory: async () => ({ respond: async () => ({ text: 'unused', toolCalls: [] }) }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }) });
  const base = await listen(server);
  try {
    const active = await post(base, '/sessions', {}).then((response) => response.json());
    const archived = await post(base, '/sessions', {}).then((response) => response.json());
    const deleted = await post(base, '/sessions', {}).then((response) => response.json());
    await server.sessionStore.append(active.id, { role: 'user', text: '부오상회 견적을 검토했어요' });
    await server.sessionStore.append(archived.id, { role: 'assistant', result: { kind: 'reply', reply: '부오상회 견적 결과' } });
    await server.sessionStore.append(deleted.id, { role: 'user', text: '부오상회 삭제된 대화' });
    await server.sessionStore.setArchived(archived.id, true);
    await server.sessionStore.softDelete(deleted.id);
    const before = await server.sessionStore.read();
    const response = await post(base, '/search', { query: '부오상회' });
    assert.equal(response.status, 200);
    const found = await response.json();
    assert.deepEqual(new Set(found.results.map((result) => result.sessionId)), new Set([active.id, archived.id]));
    assert.equal(found.results.some((result) => result.sessionId === deleted.id), false);
    assert.deepEqual(await server.sessionStore.read(), before);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('다중 숨기기·삭제·복원은 HTTP 한 요청에서 전부 적용되며 잘못된 묶음은 변경 0이다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-bulk-session-http-'));
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace: room,
    modelFactory: async () => ({ respond: async () => ({ text: 'unused', toolCalls: [] }) }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }) });
  const base = await listen(server);
  try {
    const first = await post(base, '/sessions', {}).then((response) => response.json());
    const second = await post(base, '/sessions', {}).then((response) => response.json());
    let response = await post(base, '/sessions/bulk', { ids: [first.id, second.id], action: 'archive' });
    assert.equal(response.status, 200); assert.equal((await response.json()).count, 2);
    assert.deepEqual((await fetch(`${base}/sessions?archived=1`).then((value) => value.json())).sessions
      .map((session) => session.id).sort(), [first.id, second.id].sort());
    const before = await server.sessionStore.read();
    response = await post(base, '/sessions/bulk', { ids: [first.id, '00000000-0000-4000-8000-000000000000'], action: 'delete' });
    assert.equal(response.status, 404); assert.deepEqual(await server.sessionStore.read(), before);
    response = await post(base, '/sessions/bulk', { ids: [first.id, second.id], action: 'delete' });
    assert.equal(response.status, 200);
    response = await post(base, '/sessions/bulk', { ids: [first.id, second.id], action: 'restore' });
    assert.equal(response.status, 200); assert.equal((await response.json()).count, 2);
    assert.deepEqual((await fetch(`${base}/sessions`).then((value) => value.json())).sessions
      .map((session) => session.id).sort(), [first.id, second.id].sort());
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
