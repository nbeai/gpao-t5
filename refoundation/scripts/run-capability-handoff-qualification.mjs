#!/usr/bin/env node
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';

const room = await mkdtemp(join(tmpdir(), 't5-r9-capability-live-'));
const stateDir = join(room, 'state');
const workspace = join(room, 'workspace');
await mkdir(workspace, { recursive: true });
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const access = makeConsoleModelAccess({ connectionFile, stateDir: join(room, 'model-state') });
const modelStatus = await access.status();
if (!modelStatus.connected) throw new Error('actual model connection is required');

let ready = false;
let preparationStarts = 0;
let workspaceReads = 0;
const service = {
  id: 'meeting-workspace', label: '회의 업무공간', category: 'workspace', toolName: 'meeting_workspace',
  async inspect() {
    return {
      state: ready ? 'ready' : 'needs_connection',
      reason: ready ? 'verified_fixture_ready' : 'fixture_login_required',
      userSafeSummary: ready ? '회의 업무공간을 사용할 수 있어요.' : '회의 업무 앱에서 연결 준비가 필요해요.',
      capabilities: { read: ready }, routes: [], actions: ready ? [] : [{
        id: 'open_meeting_app', label: '회의 업무 앱 열기', kind: 'user_action',
        endpoint: '/connections/meeting-workspace/action',
      }],
    };
  },
  async performAction(actionId) {
    if (actionId !== 'open_meeting_app') throw new Error('unexpected fixture action');
    preparationStarts += 1;
    return { performed: true, userSafeSummary: '회의 업무 앱을 열었어요.' };
  },
  async makeTool() {
    if (!ready) return null;
    return {
      name: 'meeting_workspace',
      description: 'Read the verified meeting workspace after its connection state is ready.',
      parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
      async execute() {
        workspaceReads += 1;
        return {
          state: 'observed', date: '2026-08-20',
          topPriority: '거래처 A 견적 확인', deadline: '17:00',
        };
      },
    };
  },
};

const errors = [];
const server = makeConsoleServer({
  stateDir, workspace, workspaceConnectionServices: [service],
  connectionPollIntervalMs: 25, connectionPollTimeoutMs: 5_000,
  modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
  onError: (error) => errors.push(error?.message ?? String(error)),
});
await new Promise((resolveListen, reject) => {
  server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen);
});
const base = `http://127.0.0.1:${server.address().port}`;
const post = async (path, input = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
};

let evidence;
try {
  const session = await post('/sessions');
  const request = '내 회의 업무공간을 연결해서 오늘 해야 할 가장 중요한 일을 확인해줘. 연결 준비가 필요하면 시작하고, 끝나면 내가 다시 말하지 않아도 이어서 알려줘.';
  const first = await post('/turn', { sessionId: session.id, text: request });
  const beforeReadyRuns = await server.runLedger.list({ sessionId: session.id });
  await new Promise((resolveWait) => setTimeout(resolveWait, 75));
  const stillWaiting = (await server.capabilityHandoffLedger.read()).handoffs
    .find((handoff) => handoff.handoffId === first.runId);
  const runsWhileWaiting = await server.runLedger.list({ sessionId: session.id });
  ready = true;

  const deadline = Date.now() + 30_000;
  let finalSession = null;
  while (Date.now() < deadline) {
    finalSession = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
    if ((finalSession.transcript ?? []).some((entry) => (
      entry.role === 'assistant' && /거래처 A 견적 확인/u.test(entry.result?.reply ?? '')
      && /17:00/u.test(entry.result?.reply ?? '')
    ))) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  const finalReply = [...(finalSession?.transcript ?? [])].reverse()
    .find((entry) => entry.role === 'assistant')?.result?.reply ?? '';
  const handoff = (await server.capabilityHandoffLedger.read()).handoffs
    .find((entry) => entry.handoffId === first.runId);
  const runs = await server.runLedger.list({ sessionId: session.id });
  const details = await Promise.all(runs.map((run) => server.runLedger.read(run.runId)));
  const resumeRuns = details.filter((run) => run.metadata?.trigger === 'connection_ready');
  const actualMeetingCalls = details.flatMap((run) => run.events).filter((event) => (
    event.type === 'tool_completed'
    && event.payload?.receipt?.actualCall?.name === 'meeting_workspace'
  ));
  evidence = {
    schema: 't5.r9-capability-handoff-live.v1',
    model: { provider: modelStatus.provider, modelId: modelStatus.modelId },
    userRequest: request,
    checks: {
      initialHandoff: first.connectionHandoff?.mode === 'user_action',
      preparationStartedOnce: preparationStarts === 1,
      waitingUsedNoModelWake: stillWaiting?.state === 'waiting'
        && runsWhileWaiting.length === beforeReadyRuns.length,
      readinessResumedOnce: handoff?.state === 'resumed' && resumeRuns.length === 1,
      capabilityReadOnce: workspaceReads === 1 && actualMeetingCalls.length === 1,
      originalGoalCompleted: /거래처 A 견적 확인/u.test(finalReply) && /17:00/u.test(finalReply),
      noRuntimeErrors: errors.length === 0,
    },
    counts: {
      runs: runs.length, resumeRuns: resumeRuns.length,
      preparationStarts, workspaceReads, runtimeErrors: errors.length,
    },
    finalReply,
    passed: false,
  };
  evidence.passed = Object.values(evidence.checks).every(Boolean);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (!evidence.passed) process.exitCode = 1;
} finally {
  server.closeWakeStreams(); await server.closeMessengers(); await server.closeWorkspaceConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(room, { recursive: true, force: true });
}
