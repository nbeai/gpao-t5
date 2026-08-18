#!/usr/bin/env node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { ConsoleSessionStore } from '../src/console-session-store.js';
import { ConversationLedger } from '../src/conversation-ledger.js';

const keep = process.argv.includes('--keep');
const room = await mkdtemp(join(tmpdir(), 't5-session-search-'));
const stateDir = join(room, 'state');
const workspace = join(room, 'workspace');
const isolatedHome = join(room, 'home');
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const expectedPath = '/Users/test/Downloads/비아이5.txt';
const expectedValue = 'SOURCE-VALUE-7391';
const currentSourcePath = join(workspace, 'current-source.txt');
const oldSourceValue = 'OLD-SOURCE-5533';
const currentSourceValue = 'CURRENT-SOURCE-8426';

async function append(ledger, sessionId, messageId, role, content, extra = {}) {
  await ledger.appendMessage({
    sessionId, messageId, runId: 'seed-run', message: { role, content, ...extra },
  });
}

async function seedSource(sessions, ledger) {
  const session = await sessions.create();
  await sessions.append(session.id, { role: 'user', text: '다운로드 폴더의 비아이5 문서 찾기' });
  await ledger.ensure({ sessionId: session.id });
  await append(ledger, session.id, 'source-user', 'user', '다운로드 폴더에서 비아이5 문서를 찾아줘.');
  await append(ledger, session.id, 'source-call', 'assistant', '', {
    toolCalls: [{
      id: 'source-exec-call', name: 'exec',
      args: { command: 'find Downloads -name 비아이5.txt', cwd: null, effect: { kind: 'observe' } },
    }],
  });
  const stdout = `${expectedPath}\n${'context-line '.repeat(80)}\n${expectedValue}\n`;
  await append(ledger, session.id, 'source-tool', 'tool', JSON.stringify({
    toolCallId: 'source-exec-call',
    requestedCall: {
      id: 'source-exec-call', name: 'exec',
      args: { command: 'find Downloads -name 비아이5.txt', cwd: null, effect: { kind: 'observe' } },
    },
    actualCall: {
      name: 'exec', args: { command: 'find Downloads -name 비아이5.txt', cwd: null, effect: { kind: 'observe' } },
    },
    outcome: 'succeeded', result: { stdout, stderr: '', exitCode: 0 },
  }), { toolCallId: 'source-exec-call', name: 'exec' });
  await append(ledger, session.id, 'source-final', 'assistant', '찾아서 확인했습니다.');
  await append(ledger, session.id, 'old-source-user', 'user',
    `과거 기록: ${currentSourcePath} 파일 값은 ${oldSourceValue}였다.`);
  await append(ledger, session.id, 'old-source-answer', 'assistant',
    `${currentSourcePath}의 과거 값 ${oldSourceValue}를 기록했다.`);
  await ledger.appendCheckpoint({
    sessionId: session.id, checkpointId: 'source-checkpoint',
    coversThroughMessageId: 'old-source-answer', summary: '과거 파일 관측을 확인했다.',
    sourceMessageCount: 6, sourceBytes: 2_400, tailMessageCount: 0,
  });
  await sessions.setArchived(session.id, true);
  return session;
}

async function seedDistractors(sessions, ledger, count) {
  for (let index = 0; index < count; index += 1) {
    const session = await sessions.create();
    await sessions.append(session.id, { role: 'user', text: `프로젝트 기록 ${index}` });
    await ledger.ensure({ sessionId: session.id });
    await append(ledger, session.id, `d-${index}-user`, 'user', `프로젝트 ${index}의 일반 작업 기록`);
    await append(ledger, session.id, `d-${index}-assistant`, 'assistant', `일반 결과 ${index}`);
  }
}

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server, reason) {
  server.closeWakeStreams();
  await server.managedProcesses.stopAll(reason);
  await new Promise((resolveClose) => server.close(resolveClose));
}

function toolDurations(events, name) {
  const starts = new Map(events.filter((event) => (
    event.type === 'tool_started' && event.payload?.name === name
  )).map((event) => [event.payload.toolCallId, Date.parse(event.recordedAt)]));
  return events.filter((event) => (
    event.type === 'tool_completed' && event.payload?.receipt?.requestedCall?.name === name
  )).map((event) => ({
    action: event.payload.receipt.requestedCall.args.action,
    wallMs: Date.parse(event.recordedAt) - starts.get(event.payload.receipt.toolCallId),
  }));
}

await Promise.all([stateDir, workspace, isolatedHome].map((path) => mkdir(path, { recursive: true })));
await writeFile(currentSourcePath, `${currentSourceValue}\n`, 'utf8');
const previousHome = process.env.T5_REFOUNDATION_HOME;
process.env.T5_REFOUNDATION_HOME = isolatedHome;
const access = makeConsoleModelAccess({ connectionFile, stateDir });
const computerEnvironment = discoverComputerEnvironment({ userHome: workspace });
const makeServer = () => makeConsoleServer({
  stateDir, workspace,
  modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
  computerEnvironment,
});
const sessions = new ConsoleSessionStore(stateDir);
const ledger = new ConversationLedger(join(stateDir, 'conversations'));
const source = await seedSource(sessions, ledger);
await seedDistractors(sessions, ledger, 120);
let firstServer;
let secondServer;
try {
  firstServer = makeServer();
  await listen(firstServer);
  await close(firstServer, 'session_search_restart');
  firstServer = null;

  secondServer = makeServer();
  const base = await listen(secondServer);
  const current = await sessions.create();
  const response = await fetch(`${base}/turn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: current.id,
      text: [
        '예전에 다운로드 폴더에서 찾았던 비아이5 문서의 정확한 경로와 파일 안에서 확인한 값을 알려줘.',
        '터미널을 다시 실행하지 말고 과거 Session을 검색한 뒤 tool 관측이 필요하면 주변 canonical 원문까지 읽어.',
      ].join(' '),
    }),
  });
  const surface = await response.json();
  const run = surface.runId
    ? await fetch(`${base}/runs/${surface.runId}`).then((result) => result.json()) : null;
  const answer = String(surface.reply ?? '');
  const sessionSearch = toolDurations(run?.events ?? [], 'session_search');
  const terminalCalls = run?.events?.filter((event) => (
    event.type === 'tool_completed'
    && ['exec', 'process_start', 'pty_start', 'process_control'].includes(
      event.payload?.receipt?.requestedCall?.name,
    )
  )).length ?? null;
  const result = {
    schema: 't5.session-search-qualification.v1', recordedAt: new Date().toISOString(),
    model: (await access.status()).modelId, actualUserData: false,
    sourceSessionId: source.id, sourceArchived: true, sourceCheckpointed: true,
    distractorSessions: 120, totalSearchableSessions: 122,
    serverRestartedBeforeRecall: true,
    recall: {
      httpStatus: response.status, runId: surface.runId ?? null,
      runStatus: run?.status ?? 'unknown', answer,
      sessionSearchCalls: sessionSearch,
      terminalCalls,
      passed: response.ok && run?.status === 'completed'
        && answer.includes(expectedPath) && answer.includes(expectedValue)
        && sessionSearch.length >= 2
        && sessionSearch.some((call) => call.action === 'search')
        && sessionSearch.some((call) => call.action === 'read')
        && terminalCalls === 0,
    },
    sourceFirst: null,
    passed: false,
    room: keep ? room : null,
  };
  const sourceFirstSession = await sessions.create();
  const sourceResponse = await fetch(`${base}/turn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: sourceFirstSession.id,
      text: `현재 ${currentSourcePath} 파일의 실제 내용을 직접 확인해서 알려줘. 과거 기록보다 현재 파일이 우선이야.`,
    }),
  });
  const sourceSurface = await sourceResponse.json();
  const sourceRun = sourceSurface.runId
    ? await fetch(`${base}/runs/${sourceSurface.runId}`).then((item) => item.json()) : null;
  const sourceAnswer = String(sourceSurface.reply ?? '');
  const sourceTerminal = (sourceRun?.events ?? []).filter((event) => (
    event.type === 'tool_completed'
    && ['exec', 'process_start', 'pty_start', 'process_control'].includes(
      event.payload?.receipt?.requestedCall?.name,
    )
  )).length;
  result.sourceFirst = {
    httpStatus: sourceResponse.status, runId: sourceSurface.runId ?? null,
    runStatus: sourceRun?.status ?? 'unknown', answer: sourceAnswer,
    terminalCalls: sourceTerminal,
    sessionSearchCalls: toolDurations(sourceRun?.events ?? [], 'session_search').length,
    passed: sourceResponse.ok && sourceRun?.status === 'completed'
      && sourceAnswer.includes(currentSourceValue) && !sourceAnswer.includes(oldSourceValue)
      && sourceTerminal > 0,
  };
  result.passed = result.recall.passed && result.sourceFirst.passed;
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} finally {
  if (firstServer) await close(firstServer, 'session_search_shutdown');
  if (secondServer) await close(secondServer, 'session_search_shutdown');
  if (previousHome == null) delete process.env.T5_REFOUNDATION_HOME;
  else process.env.T5_REFOUNDATION_HOME = previousHome;
  if (!keep) await rm(room, { recursive: true, force: true });
}
