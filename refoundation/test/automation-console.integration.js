import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { AutomationStore } from '../src/automation-store.js';
import { ConsoleSessionStore } from '../src/console-session-store.js';
import { makeAutomationTool } from '../src/automation-tool.js';

const effect = {
  kind: 'local_change', targets: ['T5 자동화 원장'], confirmation: 'not_applicable',
  rollbackOfToolCallId: null,
};

test('문자 그대로 알림은 bare text가 아니라 exact output 실행 문장으로 저장하도록 계약한다', () => {
  const tool = makeAutomationTool({ store: {}, scheduler: {}, sessionId: 'session' });
  assert.match(tool.parameters.properties.prompt.description, /Return exactly this text and nothing else/u);
  assert.match(tool.parameters.properties.prompt.description, /never store the bare reminder text as a research task/u);
});

test('자연어 반복 요청은 실제 Job이 되고 수동 실행·Run 기록·멈춤·재개가 같은 콘솔에서 이어진다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-automation-console-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); await mkdir(workspace, { recursive: true });
  const server = makeConsoleServer({
    stateDir, workspace,
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'automation-model' }),
    modelFactory: () => ({ async respond({ messages, tools }) {
      const last = messages.at(-1);
      if (last.role === 'tool') {
        const receipt = JSON.parse(last.content);
        if (receipt.requestedCall.name === 'tool_search') {
          assert.ok(tools.some((tool) => tool.name === 'automation'));
          return { text: '', toolCalls: [{
            id: 'automation-create', name: 'automation', args: {
              action: 'create', jobId: null, name: '아침 파일 확인',
              prompt: '작업공간의 audit-result.md를 읽고 한 줄로 요약해줘.',
              scheduleKind: 'cron', schedule: '0 9 * * *', timezone: 'Asia/Seoul',
              requiredTools: [], requiredEffect: null, requireResultUrl: false,
              delivery: 'origin_session', preparationToolCallIds: [],
              delegatedTool: null, delegatedEffect: null, effect,
            },
          }] };
        }
        if (receipt.requestedCall.name === 'automation_outcome') {
          return { text: '자동 실행 결과를 만들었어요.', toolCalls: [] };
        }
        return { text: '매일 확인하도록 예약했어요.', toolCalls: [] };
      }
      if (String(last.content).includes('매일 오전 9시')) {
        assert.ok(tools.some((tool) => tool.name === 'automation'));
        return { text: '', toolCalls: [{
          id: 'automation-create', name: 'automation', args: {
            action: 'create', jobId: null, name: '아침 파일 확인',
            prompt: '작업공간의 audit-result.md를 읽고 한 줄로 요약해줘.',
            scheduleKind: 'cron', schedule: '0 9 * * *', timezone: 'Asia/Seoul',
            requiredTools: [], requiredEffect: null, requireResultUrl: false,
            delivery: 'origin_session', preparationToolCallIds: [],
            delegatedTool: null, delegatedEffect: null, effect,
          },
        }] };
      }
      if (tools.some((tool) => tool.name === 'automation_outcome')) {
        assert.equal(tools.some((tool) => tool.name === 'automation'), false);
        assert.equal(tools.some((tool) => tool.name === 'work_completion'), false);
        assert.ok(messages.some((message) => String(message.content).includes('T5 CURRENT SCHEDULED EXECUTION')
          && String(message.content).includes('audit-result.md')));
        return { text: '', toolCalls: [{ id: 'automation-finish', name: 'automation_outcome', args: {
          status: 'achieved', summary: '요약 결과를 만들었습니다.', remaining: null,
          evidenceToolCallIds: [], resultUrls: [],
        } }] };
      }
      return { text: '자동 실행 결과를 만들었어요.', toolCalls: [] };
    } }),
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  await server.startAutomations(); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const reply = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '매일 오전 9시에 audit-result를 확인해줘.' }) }).then((response) => response.json());
    assert.equal(reply.reply, '매일 확인하도록 예약했어요.');
    let state = await fetch(`${base}/automation`).then((response) => response.json());
    assert.equal(state.jobs.length, 1); assert.equal(state.jobs[0].state, 'scheduled');
    assert.ok(state.jobs[0].sourceWorkId); assert.equal(state.jobs[0].sourceWorkRevision, 1);
    const jobId = state.jobs[0].id;
    const queued = await fetch(`${base}/automation/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId }) }).then((response) => response.json());
    assert.equal(queued.enqueued, true);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      state = await fetch(`${base}/automation`).then((response) => response.json());
      if (state.runs[0]?.status === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(state.runs[0].status, 'succeeded');
    assert.doesNotMatch(JSON.stringify(state.runs[0]), /fenceToken|platformIdentity|resourceScopeId/u);
    const internalState = await server.automationStore.list();
    assert.ok(internalState.runs[0].sourceRunId);
    assert.ok(internalState.runs[0].executionWorkId); assert.equal(internalState.runs[0].executionWorkRevision, 1);
    assert.equal(internalState.runs[0].executionStatus, 'completed');
    assert.equal(internalState.runs[0].objectiveStatus, 'achieved');
    assert.equal(internalState.runs[0].surfaceStatus, 'persisted');
    const origin = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
    assert.ok(origin.transcript.some((entry) => entry.result?.trigger === 'automation'
      && entry.result?.reply === '자동 실행 결과를 만들었어요.'));
    const archived = await fetch(`${base}/sessions?archived=1`).then((response) => response.json());
    const executionSession = archived.sessions.find((item) => item.continuationOf === session.id);
    assert.ok(executionSession);
    const executionConversation = await server.conversationLedger.read(executionSession.id);
    assert.equal(executionConversation.messages.some((message) => message.role === 'user'
      && message.content === '작업공간의 audit-result.md를 읽고 한 줄로 요약해줘.'), true);
    assert.equal(JSON.stringify(executionConversation.messages).includes('T5 CURRENT SCHEDULED EXECUTION'), false);
    const resources = await server.resourceLedger.read();
    const occurrenceScope = resources.find((event) => event.type === 'ScopeCreated'
      && event.scopeId === internalState.runs[0].resourceScopeId);
    const runScope = resources.find((event) => event.type === 'ScopeCreated'
      && event.payload.kind === 'run' && event.payload.occurrenceId === internalState.runs[0].occurrenceId);
    assert.equal(occurrenceScope.payload.workId, internalState.jobs[0].sourceWorkId);
    assert.equal(runScope.parentScopeId, occurrenceScope.scopeId);
    const workState = await server.workStore.read();
    assert.equal(workState.works.find((work) => work.workId === internalState.runs[0].executionWorkId).status,
      'completed');
    await fetch(`${base}/automation/pause`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId }) });
    assert.equal((await fetch(`${base}/automation`).then((response) => response.json())).jobs[0].state, 'paused');
    await fetch(`${base}/automation/resume`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId }) });
    assert.equal((await fetch(`${base}/automation`).then((response) => response.json())).jobs[0].state, 'scheduled');
  } finally {
    await server.closeAutomations(); server.closeWakeStreams(); await server.closeMessengers(); await server.closeBrowsers();
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});

test('automation result 뒤 surface crash는 모델 재실행 없이 exact occurrence를 한 번 복구한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-automation-surface-recovery-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true }); let modelCalls = 0;
  const sessions = new ConsoleSessionStore(stateDir); const origin = await sessions.create();
  const store = new AutomationStore(join(stateDir, 'automation', 'state.json'));
  const job = await store.create({ name: '복구 결과', prompt: '정확한 결과를 만들어', sessionId: origin.id,
    scheduleKind: 'at', schedule: new Date(Date.now() + 60_000).toISOString(), timezone: 'Asia/Seoul',
    delivery: { kind: 'origin_session', sessionId: null } });
  const modelFactory = () => ({ async respond({ tools, messages }) {
    modelCalls += 1;
    if (messages.at(-1)?.role === 'tool') return { text: 'AUTOMATION-RECOVERED-731', toolCalls: [] };
    if (tools.some((tool) => tool.name === 'automation_outcome')) return { text: '', toolCalls: [{
      id: 'outcome', name: 'automation_outcome', args: { status: 'achieved',
        summary: '복구할 결과를 만들었습니다.', remaining: null, evidenceToolCallIds: [], resultUrls: [] },
    }] };
    return { text: 'AUTOMATION-RECOVERED-731', toolCalls: [] };
  } });
  const first = makeConsoleServer({ stateDir, workspace, modelFactory,
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }) });
  await first.startAutomations();
  const originalAppend = first.sessionStore.append.bind(first.sessionStore); let failed = false;
  first.sessionStore.append = async (sessionId, entry) => {
    if (!failed && entry?.result?.automation?.automationRunId) {
      failed = true; throw new Error('injected automation origin surface failure');
    }
    return originalAppend(sessionId, entry);
  };
  await first.automationScheduler.runNow(job.id);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const occurrence = (await first.automationStore.list()).runs[0];
    if (occurrence?.surfaceStatus === 'pending') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  let occurrence = (await first.automationStore.list()).runs[0];
  assert.equal(occurrence.status, 'running'); assert.equal(occurrence.surfaceStatus, 'pending');
  assert.equal((await first.sessionStore.load(origin.id)).transcript.some(
    (entry) => entry.result?.automation?.automationRunId === occurrence.occurrenceId), false);
  await first.closeAutomations();

  const callsBeforeRestart = modelCalls;
  const second = makeConsoleServer({ stateDir, workspace, modelFactory,
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }) });
  try {
    await second.startAutomations();
    occurrence = (await second.automationStore.list()).runs[0];
    assert.equal(occurrence.status, 'succeeded'); assert.equal(occurrence.surfaceStatus, 'persisted');
    assert.equal(occurrence.deliveryStatus, 'succeeded'); assert.equal(modelCalls, callsBeforeRestart);
    const recovered = await second.sessionStore.load(origin.id);
    assert.equal(recovered.transcript.filter((entry) => entry.result?.automation?.automationRunId
      === occurrence.occurrenceId).length, 1);
    assert.equal(recovered.transcript.find((entry) => entry.result?.automation?.automationRunId
      === occurrence.occurrenceId).result.reply, 'AUTOMATION-RECOVERED-731');
  } finally {
    await second.closeAutomations(); await rm(room, { recursive: true, force: true });
  }
});

test('Telegram dispatch acknowledgement가 unknown이면 같은 occurrence를 재시작에서 다시 보내지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-automation-telegram-unknown-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true }); let sends = 0; let modelCalls = 0;
  const sessions = new ConsoleSessionStore(stateDir); const origin = await sessions.create();
  const telegram = await sessions.create({ origin: { channel: 'telegram', chatId: '555' } });
  const provider = {
    id: 'telegram', inboundMode: 'long_polling',
    async validate() { return { id: 'bot-1', username: 'fixture_bot' }; },
    async poll({ signal }) { await new Promise((resolve) => signal?.addEventListener('abort', resolve, { once: true })); return []; },
    startTyping() { return { stop() {} }; },
    async sendReply() { sends += 1; throw Object.assign(new Error('ack lost'), { code: 'ACK_LOST' }); },
  };
  const modelFactory = () => ({ async respond({ tools, messages }) {
    modelCalls += 1;
    if (messages.at(-1)?.role === 'tool') return { text: 'TELEGRAM-UNKNOWN-731', toolCalls: [] };
    if (tools.some((tool) => tool.name === 'automation_outcome')) return { text: '', toolCalls: [{
      id: 'outcome', name: 'automation_outcome', args: { status: 'achieved', summary: '결과 완성',
        remaining: null, evidenceToolCallIds: [], resultUrls: [] },
    }] };
    return { text: 'TELEGRAM-UNKNOWN-731', toolCalls: [] };
  } });
  const prepare = async (server) => {
    await server.messengerCredentialStore.setVerified('telegram', {
      token: 'fixture-token', bot: { id: 'bot-1', username: 'fixture_bot' },
    });
    await server.messengerStateStore.bind('telegram', '555', telegram.id);
    await server.messengerGateway.start();
  };
  const first = makeConsoleServer({ stateDir, workspace, modelFactory,
    messengerProviderFactory: () => provider,
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }) });
  await prepare(first);
  const store = first.automationStore;
  const job = await store.create({ name: '텔레그램 전달', prompt: '결과를 작성해', sessionId: origin.id,
    scheduleKind: 'at', schedule: new Date(Date.now() + 60_000).toISOString(), timezone: 'Asia/Seoul',
    delivery: { kind: 'telegram', sessionId: telegram.id } });
  await first.startAutomations(); await first.automationScheduler.runNow(job.id);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await store.list()).runs[0]?.status === 'unknown') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  let occurrence = (await store.list()).runs[0]; assert.equal(occurrence.objectiveStatus, 'achieved');
  assert.equal(occurrence.deliveryStatus, 'unknown'); assert.equal(occurrence.status, 'unknown');
  assert.equal(sends, 1); await first.closeAutomations(); await first.closeMessengers();

  const callsBeforeRestart = modelCalls;
  const second = makeConsoleServer({ stateDir, workspace, modelFactory,
    messengerProviderFactory: () => provider,
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }) });
  try {
    await prepare(second); await second.startAutomations();
    occurrence = (await second.automationStore.list()).runs[0];
    assert.equal(occurrence.deliveryStatus, 'unknown'); assert.equal(sends, 1);
    assert.equal(modelCalls, callsBeforeRestart);
  } finally {
    await second.closeAutomations(); await second.closeMessengers();
    await rm(room, { recursive: true, force: true });
  }
});
