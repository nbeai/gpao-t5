import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { ConsoleSessionStore } from '../src/console-session-store.js';
import { CapabilityHandoffLedger } from '../src/capability-handoff-ledger.js';
import { RunLedger } from '../src/run-ledger.js';

async function post(base, path, input = {}) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  });
  return { status: response.status, body: await response.json() };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeWakeStreams(); await server.closeMessengers();
  await server.closeWorkspaceConnections();
  await new Promise((resolve) => server.close(resolve));
}

async function waitForReply(base, sessionId, pattern, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const session = await fetch(`${base}/sessions/${sessionId}`).then((response) => response.json());
    const replies = (session.transcript ?? []).flatMap((entry) => (
      entry.role === 'assistant' && entry.result?.reply ? [entry.result.reply] : []
    ));
    if (replies.some((reply) => pattern.test(reply))) return { session, replies };
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${pattern}`);
}

async function waitForHandoffs(ledger, predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await ledger.read();
    if (predicate(state.handoffs)) return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for capability handoff terminal state');
}

function connectedTool() {
  return {
    name: 'workspace_fixture', description: 'Read the verified connected workspace fixture.',
    parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
    async execute() { return { state: 'observed', value: 'CAPABILITY-READY-731' }; },
  };
}

test('OAuth 준비가 끝나면 사용자가 원래 부탁을 반복하지 않아도 같은 대화가 실제 능력으로 자동 재개된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-capability-oauth-resume-'));
  let connected = false;
  let modelTurn = 0;
  const service = {
    id: 'workspace-fixture', label: '업무공간', category: 'workspace', toolName: 'workspace_fixture',
    async inspect() {
      return {
        state: connected ? 'connected' : 'needs_connection',
        userSafeSummary: connected ? '업무공간을 사용할 수 있어요.' : '계정 연결이 필요해요.',
        capabilities: { read: connected }, routes: [],
        actions: connected ? [] : [{
          id: 'connect', label: '계정 연결', kind: 'oauth',
          startEndpoint: '/connections/workspace-fixture/start',
          awaitEndpoint: '/connections/workspace-fixture/await',
        }],
      };
    },
    async start() { return { authorizeUrl: 'https://example.com/authorize' }; },
    async awaitConnection() {
      connected = true;
      return { connected: true, userSafeSummary: '업무공간을 연결했어요.' };
    },
    async makeTool() { return connected ? connectedTool() : null; },
  };
  const server = makeConsoleServer({
    stateDir: join(room, 'state'), workspace: room, workspaceConnectionServices: [service],
    connectionPollIntervalMs: 5,
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond(input) {
      if (modelTurn >= 2 && !input.tools.some((tool) => tool.name === 'workspace_fixture')) {
        assert.match(JSON.stringify(input.messages), /continue the unfinished user goal/iu);
        return { text: '', toolCalls: [{
          id: 'find-workspace-fixture', name: 'tool_search', args: { query: 'workspace_fixture' },
        }] };
      }
      modelTurn += 1;
      if (modelTurn === 1) return { text: '', toolCalls: [{
        id: 'connect', name: 'connection',
        args: { action: 'start', id: 'workspace-fixture', actionId: null },
      }] };
      if (modelTurn === 2) return { text: '계정 연결 화면을 준비했어요.', toolCalls: [] };
      assert.match(JSON.stringify(input.messages), /continue the unfinished user goal/iu);
      if (modelTurn === 3) return {
        text: '', toolCalls: [{ id: 'read-after-connect', name: 'workspace_fixture', args: {} }],
      };
      const receipt = JSON.parse(input.messages.at(-1).content);
      assert.equal(receipt.result.value, 'CAPABILITY-READY-731');
      return { text: '연결을 마친 뒤 원래 부탁을 이어서 CAPABILITY-READY-731을 확인했어요.', toolCalls: [] };
    } }),
  });
  const base = await listen(server);
  try {
    const session = (await post(base, '/sessions')).body;
    const started = await post(base, '/turn', {
      sessionId: session.id, text: '내 업무공간을 연결해서 안의 확인 값을 읽어줘.',
    });
    assert.equal(started.body.connectionHandoff?.mode, 'oauth');
    const stale = await server.authorityStore.propose({
      sessionId: session.id, toolName: 'workspace_fixture', args: {
        action: 'send', effect: {
          kind: 'external_send', summary: '과거 승인', targets: ['old-recipient'],
          reversible: false, backupAvailable: false, recipientNew: true, approvalToken: null,
        },
      },
    });
    await server.authorityStore.approve(stale.pendingId);
    const finished = await post(base, '/connections/workspace-fixture/await', {
      sessionId: session.id, handoffId: started.body.runId,
    });
    assert.equal(finished.status, 200);
    const observed = await waitForReply(base, session.id, /CAPABILITY-READY-731/u);
    assert.equal(observed.replies.filter((reply) => /CAPABILITY-READY-731/u.test(reply)).length, 1);
    assert.equal((await server.authorityStore.read(stale.pendingId)).status, 'withdrawn');
  } finally {
    await close(server); await rm(room, { recursive: true, force: true });
  }
});

test('준비 대기는 저비용 inspector만 bounded 호출하고 timeout 전후 모델을 반복 호출하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-capability-timeout-'));
  let inspectCalls = 0;
  let modelTurns = 0;
  const service = {
    id: 'slow-fixture', label: '느린 업무 앱', category: 'workspace',
    async inspect() {
      inspectCalls += 1;
      return {
        state: 'needs_connection', userSafeSummary: '아직 사용자 준비를 기다리고 있어요.',
        capabilities: {}, routes: [], actions: [{
          id: 'open_app', label: '앱 열기', kind: 'user_action',
          endpoint: '/connections/slow-fixture/action',
        }],
      };
    },
    async performAction() { return { performed: true, userSafeSummary: '앱을 열었어요.' }; },
  };
  const server = makeConsoleServer({
    stateDir: join(room, 'state'), workspace: room, workspaceConnectionServices: [service],
    connectionPollIntervalMs: 5, connectionPollTimeoutMs: 20,
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond() {
      modelTurns += 1;
      return modelTurns === 1 ? { text: '', toolCalls: [{
        id: 'prepare', name: 'connection',
        args: { action: 'perform', id: 'slow-fixture', actionId: 'open_app' },
      }] } : { text: '준비가 끝나면 이어서 확인할게요.', toolCalls: [] };
    } }),
  });
  const base = await listen(server);
  try {
    const session = (await post(base, '/sessions')).body;
    const started = await post(base, '/turn', { sessionId: session.id, text: '느린 업무 앱 자료를 읽어줘.' });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const ledger = await server.capabilityHandoffLedger.read();
    const handoff = ledger.handoffs.find((entry) => entry.handoffId === started.body.runId);
    assert.equal(handoff.state, 'needs_attention');
    assert.equal(handoff.reason, 'readiness_timeout');
    assert.equal(modelTurns, 2);
    assert.ok(inspectCalls >= 2 && inspectCalls <= 8, `bounded inspector calls: ${inspectCalls}`);
  } finally {
    await close(server); await rm(room, { recursive: true, force: true });
  }
});

test('같은 연결을 기다리는 두 대화는 준비 행동을 한 번만 열고 목적·handoff를 섞지 않고 각각 한 번 재개한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-capability-multisession-'));
  let ready = false;
  let performed = 0;
  const turns = new Map();
  const labels = new Map();
  const service = {
    id: 'shared-fixture', label: '공유 업무 앱', category: 'workspace', toolName: 'workspace_fixture',
    async inspect() {
      return {
        state: ready ? 'ready' : 'needs_connection',
        userSafeSummary: ready ? '공유 업무 앱을 사용할 수 있어요.' : '앱 준비가 필요해요.',
        capabilities: { read: ready }, routes: [], actions: ready ? [] : [{
          id: 'open_shared', label: '공유 앱 열기', kind: 'user_action',
          endpoint: '/connections/shared-fixture/action',
        }],
      };
    },
    async performAction() { performed += 1; return { performed: true, userSafeSummary: '공유 앱을 열었어요.' }; },
    async makeTool() { return ready ? connectedTool() : null; },
  };
  const server = makeConsoleServer({
    stateDir: join(room, 'state'), workspace: room, workspaceConnectionServices: [service],
    connectionPollIntervalMs: 5,
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: ({ sessionId }) => ({ async respond(input) {
      const turn = (turns.get(sessionId) ?? 0) + 1; turns.set(sessionId, turn);
      if (turn === 1) return { text: '', toolCalls: [{
        id: `prepare-${sessionId}`, name: 'connection',
        args: { action: 'perform', id: 'shared-fixture', actionId: 'open_shared' },
      }] };
      if (turn === 2) return { text: '준비되면 이 대화의 부탁을 이어갈게요.', toolCalls: [] };
      if (turn === 3) return {
        text: '', toolCalls: [{ id: `read-${sessionId}`, name: 'workspace_fixture', args: {} }],
      };
      return { text: `${labels.get(sessionId)} 목적을 이어서 CAPABILITY-READY-731을 확인했어요.`, toolCalls: [] };
    } }),
  });
  const base = await listen(server);
  try {
    const a = (await post(base, '/sessions')).body; labels.set(a.id, 'A');
    const b = (await post(base, '/sessions')).body; labels.set(b.id, 'B');
    const startedA = await post(base, '/turn', { sessionId: a.id, text: 'A 자료를 연결 뒤 읽어줘.' });
    const startedB = await post(base, '/turn', { sessionId: b.id, text: 'B 자료를 연결 뒤 읽어줘.' });
    assert.equal(startedA.body.connectionHandoff?.connectionId, 'shared-fixture');
    assert.equal(startedB.body.connectionHandoff?.connectionId, 'shared-fixture');
    assert.notEqual(startedA.body.runId, startedB.body.runId);
    assert.equal(performed, 1);
    ready = true;
    const [observedA, observedB] = await Promise.all([
      waitForReply(base, a.id, /A 목적.*CAPABILITY-READY-731/u),
      waitForReply(base, b.id, /B 목적.*CAPABILITY-READY-731/u),
    ]);
    assert.equal(observedA.replies.filter((reply) => /A 목적.*CAPABILITY-READY-731/u.test(reply)).length, 1);
    assert.equal(observedB.replies.filter((reply) => /B 목적.*CAPABILITY-READY-731/u.test(reply)).length, 1);
    const ledger = await waitForHandoffs(server.capabilityHandoffLedger, (handoffs) => (
      handoffs.filter((handoff) => handoff.connectionId === 'shared-fixture'
        && handoff.state === 'resumed').length === 2
    ));
    assert.equal(ledger.handoffs.filter((handoff) => (
      handoff.connectionId === 'shared-fixture' && handoff.state === 'resumed'
    )).length, 2);
  } finally {
    await close(server); await rm(room, { recursive: true, force: true });
  }
});

test('로컬 앱 준비 handoff는 서버 재시작 뒤 준비 완료를 실측하고 원래 부탁을 정확히 한 번 재개한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-capability-local-resume-'));
  const stateDir = join(room, 'state');
  let ready = false;
  let performed = 0;
  let resumeModelTurns = 0;
  const service = {
    id: 'local-fixture', label: '로컬 업무 앱', category: 'workspace', toolName: 'workspace_fixture',
    async inspect() {
      return {
        state: ready ? 'ready' : 'needs_connection',
        userSafeSummary: ready ? '로컬 업무 앱을 사용할 수 있어요.' : '앱에서 로그인이 필요해요.',
        capabilities: { read: ready }, routes: [],
        actions: ready ? [] : [{
          id: 'open_local_app', label: '업무 앱 열기', kind: 'user_action',
          endpoint: '/connections/local-fixture/action',
        }],
      };
    },
    async performAction(actionId) {
      assert.equal(actionId, 'open_local_app'); performed += 1;
      return { performed: true, userSafeSummary: '업무 앱을 열었어요.' };
    },
    async makeTool() { return ready ? connectedTool() : null; },
  };
  const first = makeConsoleServer({
    stateDir, workspace: room, workspaceConnectionServices: [service], connectionPollIntervalMs: 5,
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => {
      let turn = 0;
      return { async respond() {
        turn += 1;
        return turn === 1 ? { text: '', toolCalls: [{
          id: 'prepare-local', name: 'connection',
          args: { action: 'perform', id: 'local-fixture', actionId: 'open_local_app' },
        }] } : { text: '열린 앱에서 로그인을 마치면 제가 이어서 확인할게요.', toolCalls: [] };
      } };
    },
  });
  const firstBase = await listen(first);
  let sessionId;
  try {
    const session = (await post(firstBase, '/sessions')).body; sessionId = session.id;
    const started = await post(firstBase, '/turn', {
      sessionId, text: '로컬 업무 앱을 준비해서 안의 확인 값을 읽어줘.',
    });
    assert.equal(started.body.connectionHandoff?.mode, 'user_action');
    assert.equal(performed, 1);
  } finally { await close(first); }

  ready = true;
  const second = makeConsoleServer({
    stateDir, workspace: room, workspaceConnectionServices: [service], connectionPollIntervalMs: 5,
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond(input) {
      resumeModelTurns += 1;
      assert.match(JSON.stringify(input.messages), /continue the unfinished user goal/iu);
      if (resumeModelTurns === 1) return {
        text: '', toolCalls: [{ id: 'read-after-restart', name: 'workspace_fixture', args: {} }],
      };
      return { text: '재시작 뒤 원래 부탁을 이어서 CAPABILITY-READY-731을 확인했어요.', toolCalls: [] };
    } }),
  });
  const secondBase = await listen(second);
  try {
    const observed = await waitForReply(secondBase, sessionId, /재시작 뒤.*CAPABILITY-READY-731/u);
    assert.equal(observed.replies.filter((reply) => /재시작 뒤.*CAPABILITY-READY-731/u.test(reply)).length, 1);
    assert.equal(performed, 1, '준비 행동 자체를 재시작 뒤 반복하면 안 된다');
  } finally {
    await close(second); await rm(room, { recursive: true, force: true });
  }
});

test('resume claim 뒤 crash로 실행 사실이 모호하면 재시작이 모델과 과거 효과를 자동 재실행하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-capability-ambiguous-restart-'));
  const stateDir = join(room, 'state');
  const sessions = new ConsoleSessionStore(stateDir);
  const session = await sessions.create();
  const originRunId = '11111111-2222-4333-8444-555555555555';
  await sessions.append(session.id, { role: 'user', text: '연결 뒤 외부 작업을 해줘.', runId: originRunId });
  await sessions.append(session.id, { role: 'assistant', result: {
    kind: 'reply', reply: '준비되면 이어갈게요.', runId: originRunId,
    connectionHandoff: {
      active: true, mode: 'user_action', handoffId: originRunId,
      connectionId: 'ambiguous-fixture', label: '모호한 업무 앱',
      checkEndpoint: '/connections/ambiguous-fixture/check',
      cancelEndpoint: '/connections/ambiguous-fixture/cancel',
    },
  } });
  const ledger = new CapabilityHandoffLedger(join(stateDir, 'capability-handoffs'));
  await ledger.ensure();
  await ledger.start({
    handoffId: originRunId, sessionId: session.id, connectionId: 'ambiguous-fixture',
    mode: 'user_action', originRunId,
  });
  await ledger.observeReady(originRunId, 'ready'); await ledger.recordCompletion(originRunId);
  const claimed = await ledger.claimResume(originRunId);
  const interruptedRuns = new RunLedger(join(stateDir, 'runs'));
  const interrupted = await interruptedRuns.start({
    sessionId: session.id, request: 'capability preparation completed',
    metadata: { connectionResumeClaimId: claimed.claimId, handoffId: originRunId },
  });
  await interrupted.append({ type: 'model_started', payload: { turn: 1 } });

  let modelCalls = 0;
  const service = {
    id: 'ambiguous-fixture', label: '모호한 업무 앱', category: 'workspace',
    inspect: async () => ({
      state: 'ready', userSafeSummary: '준비됨', capabilities: {}, routes: [], actions: [],
    }),
  };
  const server = makeConsoleServer({
    stateDir, workspace: room, workspaceConnectionServices: [service], connectionPollIntervalMs: 5,
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond() { modelCalls += 1; return { text: '재실행됨', toolCalls: [] }; } }),
  });
  await listen(server);
  try {
    await new Promise((resolve) => setTimeout(resolve, 40));
    const current = (await server.capabilityHandoffLedger.read()).handoffs
      .find((handoff) => handoff.handoffId === originRunId);
    assert.equal(current.state, 'needs_attention');
    assert.equal(current.reason, 'resume_interrupted');
    assert.equal(modelCalls, 0);
  } finally {
    await close(server); await rm(room, { recursive: true, force: true });
  }
});

test('resume 결과 뒤 surface crash는 pending으로 남고 재시작이 exact surface 후 resumed만 commit한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-capability-pending-surface-')); const stateDir = join(room, 'state');
  let ready = false; let performed = 0; let modelCalls = 0;
  const service = {
    id: 'pending-surface-fixture', label: '결과 대기 업무 앱', category: 'workspace', toolName: 'workspace_fixture',
    async inspect() { return { state: ready ? 'ready' : 'needs_connection',
      userSafeSummary: ready ? '준비됨' : '준비 필요', capabilities: { read: ready }, routes: [],
      actions: ready ? [] : [{ id: 'open', label: '열기', kind: 'user_action',
        endpoint: '/connections/pending-surface-fixture/action' }] }; },
    async performAction() { performed += 1; return { performed: true, userSafeSummary: '열었어요.' }; },
    async makeTool() { return ready ? connectedTool() : null; },
  };
  const modelFactory = () => ({ async respond() {
    modelCalls += 1;
    if (modelCalls === 1) return { text: '', toolCalls: [{ id: 'prepare', name: 'connection', args: {
      action: 'perform', id: 'pending-surface-fixture', actionId: 'open',
    } }] };
    if (modelCalls === 2) return { text: '준비되면 이어갈게요.', toolCalls: [] };
    return { text: 'RESUME-PENDING-731', toolCalls: [] };
  } });
  const first = makeConsoleServer({ stateDir, workspace: room, workspaceConnectionServices: [service],
    connectionPollIntervalMs: 50, modelFactory,
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }) });
  const firstBase = await listen(first); const session = (await post(firstBase, '/sessions')).body;
  const started = await post(firstBase, '/turn', { sessionId: session.id, text: '준비 뒤 값을 알려줘' });
  const handoffId = started.body.runId; let failedAppend;
  const appendFailed = new Promise((resolve) => { failedAppend = resolve; });
  const originalAppend = first.sessionStore.append.bind(first.sessionStore);
  first.sessionStore.append = async (sessionId, entry) => {
    if (entry?.role === 'assistant' && entry.result?.reply === 'RESUME-PENDING-731') {
      failedAppend(); throw new Error('injected resume surface failure');
    }
    return originalAppend(sessionId, entry);
  };
  ready = true; await appendFailed;
  let handoff = (await first.capabilityHandoffLedger.read()).handoffs.find((item) => item.handoffId === handoffId);
  assert.equal(handoff.state, 'resume_completed_pending_surface');
  assert.ok(handoff.resumeRunId); assert.ok(handoff.resumeResultDigest); assert.ok(handoff.resumeResultPointer);
  assert.equal((await first.sessionStore.load(session.id)).transcript.some(
    (entry) => entry.role === 'assistant' && entry.result?.reply === 'RESUME-PENDING-731'), false);
  await close(first);

  const callsBeforeRestart = modelCalls;
  const second = makeConsoleServer({ stateDir, workspace: room, workspaceConnectionServices: [service],
    connectionPollIntervalMs: 5, modelFactory,
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }) });
  const secondBase = await listen(second);
  try {
    const observed = await waitForReply(secondBase, session.id, /RESUME-PENDING-731/u);
    assert.equal(observed.replies.filter((reply) => /RESUME-PENDING-731/u.test(reply)).length, 1);
    handoff = (await second.capabilityHandoffLedger.read()).handoffs.find((item) => item.handoffId === handoffId);
    assert.equal(handoff.state, 'resumed'); assert.equal(handoff.surfaceReceipt.runId, handoff.resumeRunId);
    assert.equal(handoff.surfaceReceipt.resultDigest, handoff.resumeResultDigest);
    assert.equal(modelCalls, callsBeforeRestart); assert.equal(performed, 1);
  } finally { await close(second); await rm(room, { recursive: true, force: true }); }
});
