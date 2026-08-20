import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

async function app() {
  const room = await mkdtemp(join(tmpdir(), 't5-conversation-recovery-'));
  const modelFactory = () => ({
    async respond() {
      return {
        text: '앞선 미완료 작업과 지금 요청이 함께 잡혔어요. 지금 할 일만 한 번 더 말씀해 주세요.',
        toolCalls: [], responseId: 'stalled', responseModel: 'fixture',
      };
    },
  });
  const server = makeConsoleServer({
    stateDir: join(room, 'state'), workspace: room, modelFactory,
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  return {
    room, server, base: `http://127.0.0.1:${server.address().port}`,
    async close() {
      server.closeWakeStreams(); await server.closeMessengers();
      await new Promise((resolve) => server.close(resolve));
      await rm(room, { recursive: true, force: true });
    },
  };
}

const post = (base, path, body) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then(async (response) => ({ status: response.status, body: await response.json() }));

test('두 번째 무진전 답은 모델 답을 바꾸지 않고 회복 선택을 지속한다', async () => {
  const testApp = await app();
  try {
    const created = (await post(testApp.base, '/sessions', {})).body;
    const first = (await post(testApp.base, '/turn', {
      sessionId: created.id, text: '구글 연결은 어떻게 해?',
    })).body;
    assert.equal(first.recovery, undefined);
    const second = (await post(testApp.base, '/turn', {
      sessionId: created.id, text: '그럼 지금 연결을 시작해줘',
    })).body;
    assert.equal(second.reply, first.reply);
    assert.equal(second.recovery?.kind, 'repeated_no_progress');
    assert.equal(second.recovery?.recoveryId, second.runId);

    const detail = await fetch(`${testApp.base}/sessions/${created.id}`).then((response) => response.json());
    assert.deepEqual(detail.activeRecoveryIds, [second.runId]);
  } finally { await testApp.close(); }
});

test('대화 상태 다시 준비는 모델 없이 임시 작업·승인을 정리하고 기록을 보존한다', async () => {
  const testApp = await app();
  try {
    const created = (await post(testApp.base, '/sessions', {})).body;
    await post(testApp.base, '/turn', { sessionId: created.id, text: '노션 연결 방법 알려줘' });
    const stalled = (await post(testApp.base, '/turn', {
      sessionId: created.id, text: '그대로 진행해',
    })).body;
    const recovered = await post(testApp.base, '/sessions/recover', {
      sessionId: created.id, mode: 'reset', recoveryId: stalled.runId,
    });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.ready, true);
    assert.match(recovered.body.userSafeSummary, /다시 준비/u);

    const detail = await fetch(`${testApp.base}/sessions/${created.id}`).then((response) => response.json());
    assert.equal(detail.transcript.filter((entry) => entry.role === 'user').length, 2);
    assert.equal(detail.transcript.some((entry) => (
      entry.role === 'system_event' && entry.event?.kind === 'session_recovered'
    )), true);
    assert.deepEqual(detail.activeRecoveryIds, []);
    const runs = await fetch(`${testApp.base}/runs?sessionId=${created.id}`).then((response) => response.json());
    const recoveryRun = runs.runs.find((run) => run.request === 'conversation recovery');
    assert.equal(recoveryRun?.status, 'completed');
  } finally { await testApp.close(); }
});

test('새 대화에서 이어가기는 미완료 호출을 복사하지 않고 원본 연결만 남긴다', async () => {
  const testApp = await app();
  try {
    const created = (await post(testApp.base, '/sessions', {})).body;
    await post(testApp.base, '/turn', { sessionId: created.id, text: '구글 자료를 읽어줘' });
    const stalled = (await post(testApp.base, '/turn', {
      sessionId: created.id, text: '연결부터 시작해줘',
    })).body;
    const continued = await post(testApp.base, '/sessions/recover', {
      sessionId: created.id, mode: 'continue', recoveryId: stalled.runId,
    });
    assert.equal(continued.status, 200);
    assert.notEqual(continued.body.newSessionId, created.id);
    const next = await fetch(`${testApp.base}/sessions/${continued.body.newSessionId}`)
      .then((response) => response.json());
    assert.equal(next.continuationOf, created.id);
    assert.equal(next.transcript.some((entry) => entry.role === 'user'), false);
    assert.equal(next.transcript.some((entry) => entry.role === 'assistant'), false);
    assert.equal(next.transcript.some((entry) => (
      entry.role === 'system_event' && entry.event?.kind === 'continued_from_session'
    )), true);
  } finally { await testApp.close(); }
});

test('실행 중인 모델을 거치지 않고도 대화 메뉴에서 현재 작업을 멈추고 다시 준비한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-conversation-recovery-running-'));
  const modelFactory = () => ({
    respond({ signal }) {
      return new Promise((resolve, reject) => {
        const aborted = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (signal?.aborted) aborted(); else signal?.addEventListener('abort', aborted, { once: true });
      });
    },
  });
  const server = makeConsoleServer({
    stateDir: join(room, 'state'), workspace: room, modelFactory,
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = (await post(base, '/sessions', {})).body;
    const pendingTurn = post(base, '/turn', { sessionId: created.id, text: '오래 걸리는 일을 시작해' });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const detail = await fetch(`${base}/sessions/${created.id}`).then((response) => response.json());
      if (detail.activity?.status === 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const recovered = await post(base, '/sessions/recover', {
      sessionId: created.id, mode: 'reset', recoveryId: null,
    });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.ready, true);
    await pendingTurn;
    const detail = await fetch(`${base}/sessions/${created.id}`).then((response) => response.json());
    assert.equal(detail.activity, null);
    const runs = await fetch(`${base}/runs?sessionId=${created.id}`).then((response) => response.json());
    assert.equal(runs.runs.some((run) => run.status === 'cancelled'), true);
    assert.equal(runs.runs.some((run) => run.request === 'conversation recovery' && run.status === 'completed'), true);
  } finally {
    server.closeWakeStreams(); await server.closeMessengers();
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
