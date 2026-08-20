import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function post(base, path, body) {
  return fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

async function startStream(base, sessionId, text) {
  const started = await post(base, '/turn/stream-start', { sessionId, text }).then((response) => response.json());
  const response = await fetch(`${base}/turn/stream?streamId=${encodeURIComponent(started.streamId)}`);
  return response.text();
}

async function until(check, attempts = 100) {
  for (let index = 0; index < attempts; index += 1) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition not reached');
}

test('두 세션을 동시에 실행해도 목록·재진입 상세가 각 진행 상태를 복원한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-session-activity-'));
  const releases = new Map();
  const server = makeConsoleServer({
    stateDir: room, workspace: room,
    modelFactory: async ({ sessionId }) => ({
      respond: async () => new Promise((resolve) => releases.set(sessionId, resolve)),
    }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
  });
  const base = await listen(server);
  try {
    const a = await post(base, '/sessions', {}).then((response) => response.json());
    const b = await post(base, '/sessions', {}).then((response) => response.json());
    const streamA = startStream(base, a.id, '첫 번째 긴 작업');
    await until(() => releases.has(a.id));
    const streamB = startStream(base, b.id, '두 번째 긴 작업');
    await until(() => releases.has(b.id));

    const list = await fetch(`${base}/sessions`).then((response) => response.json());
    const byId = new Map(list.sessions.map((session) => [session.id, session]));
    assert.equal(byId.get(a.id).activity.status, 'running');
    assert.equal(byId.get(b.id).activity.status, 'running');
    assert.equal((await fetch(`${base}/sessions/${a.id}`).then((response) => response.json())).activity.sessionId, a.id);

    releases.get(b.id)({ text: '두 번째 완료', toolCalls: [] });
    await streamB;
    const afterB = await fetch(`${base}/sessions`).then((response) => response.json());
    assert.equal(afterB.sessions.find((session) => session.id === b.id).activity, null);
    assert.equal(afterB.sessions.find((session) => session.id === a.id).activity.status, 'running');

    releases.get(a.id)({ text: '첫 번째 완료', toolCalls: [] });
    await streamA;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('모델 능력 실패는 세션에 사용자용 원인으로 남아 다시 들어와도 보인다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-session-failure-'));
  const server = makeConsoleServer({
    stateDir: room, workspace: room,
    modelFactory: async () => ({
      respond: async () => { throw Object.assign(new Error('Upstage Chat attachment input is not enabled'), {
        reason: 'image_input_unsupported', provider: 'upstage', modelId: 'solar-pro4',
      }); },
    }),
    modelStatus: () => ({ connected: true, provider: 'upstage', modelId: 'solar-pro4' }),
  });
  const base = await listen(server);
  try {
    const session = await post(base, '/sessions', {}).then((response) => response.json());
    const stream = await startStream(base, session.id, '이 이미지를 설명해줘');
    assert.match(stream, /Upstage · solar-pro4/u);
    assert.doesNotMatch(stream, /모델 또는 터미널/u);
    const restored = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
    const failure = restored.transcript.at(-1).result;
    assert.equal(failure.kind, 'error');
    assert.match(failure.reply, /이미지 입력/u);
    assert.match(failure.nextSafeAction, /다른 모델/u);
    const listed = await fetch(`${base}/sessions`).then((response) => response.json());
    assert.equal(listed.sessions.find((item) => item.id === session.id).lastResultKind, 'error');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
