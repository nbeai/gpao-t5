import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { RunLedger } from '../src/run-ledger.js';
import { WorkStore } from '../src/work-store.js';

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

test('재시작은 과거 버전의 terminal failed Run이 남긴 active claim만 자동 해제한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-restart-failed-claim-'));
  const stateDir = join(room, 'state');
  const workStore = new WorkStore(join(stateDir, 'work'));
  const runLedger = new RunLedger(join(stateDir, 'runs'));
  const work = await workStore.create({ sessionId: 'legacy-session', sourceMessageId: 'legacy:user' });
  const run = await runLedger.start({ sessionId: 'legacy-session', request: 'legacy failed turn' });
  await workStore.claimExecution({ workId: work.workId, revision: 1, runId: run.runId });
  await run.finish('failed', { reason: 'provider_error' });
  const server = makeConsoleServer({ stateDir, workspace: room,
    modelFactory: () => ({ async respond() { return { text: 'unused', toolCalls: [] }; } }) });
  try {
    assert.deepEqual(await server.recoverFailedWorkClaimsReady, [run.runId]);
    assert.equal((await workStore.read()).claims.find((claim) => claim.runId === run.runId)?.state, 'released');
  } finally { await server.closeWorkspaceConnections(); await server.closeMessengers(); await rm(room, { recursive: true, force: true }); }
});

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

test('중간에 다른 일을 실제로 마친 뒤 연결 막힘이 재등장해도 회복 선택을 지속한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-conversation-recovery-returned-'));
  const blocked = '앞선 미완료 작업과 지금 요청이 함께 잡혔어요. 지금 할 일만 한 번 더 말씀해 주세요.';
  let call = 0;
  const server = makeConsoleServer({
    stateDir: join(room, 'state'), workspace: room,
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond() {
      call += 1;
      if (call === 1 || call === 4) return { text: blocked, toolCalls: [] };
      if (call === 2) return { text: '', toolCalls: [{
        id: 'unrelated-work', name: 'exec', args: {
          command: "printf '관련 파일을 확인했습니다\\n'", cwd: null, effect: null,
        },
      }] };
      return { text: '관련 파일을 확인했어요.', toolCalls: [] };
    } }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = (await post(base, '/sessions', {})).body;
    await post(base, '/turn', { sessionId: session.id, text: '구글 연결을 시작해줘' });
    const worked = await post(base, '/turn', {
      sessionId: session.id, text: '그 전에 관련 파일이 있는지 확인해줘',
    });
    assert.match(worked.body.reply, /확인했어요/u);
    const returned = await post(base, '/turn', {
      sessionId: session.id, text: '이제 노션 연결을 그대로 진행해',
    });
    assert.equal(returned.body.reply, blocked);
    assert.equal(returned.body.recovery?.kind, 'repeated_no_progress');
  } finally {
    server.closeWakeStreams(); await server.closeMessengers();
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
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

test('대화 상태 다시 준비는 terminal failed Run이 남긴 durable Work claim도 해제한다', async () => {
  const testApp = await app();
  try {
    const session = (await post(testApp.base, '/sessions', {})).body;
    const work = await testApp.server.workStore.create({ sessionId: session.id, sourceMessageId: 'failed:user' });
    const failedRun = await testApp.server.runLedger.start({ sessionId: session.id, request: 'failed turn' });
    await testApp.server.workStore.claimExecution({ workId: work.workId, revision: 1, runId: failedRun.runId });
    await failedRun.finish('failed', { reason: 'provider_error' });
    const recovered = await post(testApp.base, '/sessions/recover', { sessionId: session.id, mode: 'reset' });
    assert.equal(recovered.status, 200);
    const state = await testApp.server.workStore.read();
    assert.equal(state.claims.find((claim) => claim.runId === failedRun.runId)?.state, 'released');
    const runs = await testApp.server.runLedger.list({ sessionId: session.id });
    const recovery = await testApp.server.runLedger.read(runs.find((run) => run.request === 'conversation recovery').runId);
    assert.equal(recovery.events.find((event) => event.type === 'conversation_recovered')
      .payload.releasedWorkClaims, 1);
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

test('대화 상태 다시 준비는 계정 연결 대기도 즉시 취소하고 다시 시작 가능한 상태로 돌린다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-conversation-recovery-connection-'));
  let pending = false;
  let cancelCalls = 0;
  const service = {
    id: 'notion', label: 'Notion', category: 'workspace',
    inspect: async () => ({
      state: 'needs_connection', userSafeSummary: '연결 필요', capabilities: {}, routes: [],
      actions: pending ? [{ kind: 'cancel' }] : [{ kind: 'oauth' }],
    }),
    async start() { pending = true; return { authorizeUrl: 'https://notion.example/authorize' }; },
    async cancelPending() {
      cancelCalls += 1; const cancelled = pending; pending = false;
      return { cancelled, userSafeSummary: 'Notion 연결을 취소했어요.' };
    },
  };
  let turn = 0;
  const server = makeConsoleServer({
    stateDir: join(room, 'state'), workspace: room, workspaceConnectionServices: [service],
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond() {
      turn += 1;
      return turn === 1
        ? { text: '', toolCalls: [{ id: 'start-notion', name: 'connection', args: { action: 'start', id: 'notion', actionId: null } }] }
        : { text: 'Notion 연결 화면을 준비했어요.', toolCalls: [] };
    } }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = (await post(base, '/sessions', {})).body;
    const started = await post(base, '/turn', { sessionId: session.id, text: '노션 연결해줘' });
    assert.equal(started.body.connectionHandoff?.active, true);
    const recovered = await post(base, '/sessions/recover', { sessionId: session.id, mode: 'reset' });
    assert.equal(recovered.status, 200);
    assert.equal(cancelCalls, 1);
    assert.equal(pending, false);
    const detail = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
    assert.deepEqual(detail.activeConnectionHandoffIds, []);
    const runs = await fetch(`${base}/runs?sessionId=${session.id}`).then((response) => response.json());
    const recoveryRun = runs.runs.find((run) => run.request === 'conversation recovery');
    const run = await fetch(`${base}/runs/${recoveryRun.runId}`).then((response) => response.json());
    assert.equal(run.events.find((event) => event.type === 'conversation_recovered')
      .payload.connectionHandoffsCancelled, 1);
  } finally {
    server.closeWakeStreams(); await server.closeMessengers(); await server.closeWorkspaceConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
