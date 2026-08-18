#!/usr/bin/env node
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { ConsoleSessionStore } from '../src/console-session-store.js';
import { ConversationLedger } from '../src/conversation-ledger.js';

const keep = process.argv.includes('--keep');
const room = await mkdtemp(join(tmpdir(), 't5-checkpoint-continuity-'));
const stateDir = join(room, 'state');
const workspace = join(room, 'workspace');
const isolatedHome = join(room, 'home');
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));

function filler(chars, prefix) {
  let value = '';
  let index = 0;
  while (value.length < chars) {
    value += `${prefix}${index.toString(36).padStart(4, '0')} `;
    index += 1;
  }
  return value.slice(0, chars);
}

async function appendPhase(ledger, sessionId, {
  phase, pairs, charsPerMessage = 600, early, middle, recent, sequenceStart = 0,
}) {
  let sequence = sequenceStart;
  for (let pair = 0; pair < pairs; pair += 1) {
    const userMarker = pair === 0 ? `OWNER FACT ${phase}_early=${early}\n` : '';
    const assistantMarker = [
      pair === Math.floor(pairs / 2) ? `DECISION ${phase}_middle=${middle}\n` : '',
      pair === pairs - 1 ? `OPEN WORK ${phase}_recent=${recent}\n` : '',
    ].join('');
    const messages = [
      {
        role: 'user',
        content: `${userMarker}${filler(Math.max(0, charsPerMessage - userMarker.length), `${phase}-user-${pair}-`)}`,
      },
      {
        role: 'assistant',
        content: `${assistantMarker}${filler(Math.max(0, charsPerMessage - assistantMarker.length), `${phase}-assistant-${pair}-`)}`,
      },
    ];
    for (const message of messages) {
      sequence += 1;
      await ledger.appendMessage({
        sessionId, messageId: `${phase}:seed:${sequence}`, runId: `${phase}-seed`, message,
      });
    }
  }
  return sequence;
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

async function requestTurn(base, sessionId, text) {
  const response = await fetch(`${base}/turn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, text }),
  });
  const surface = await response.json();
  const runId = surface.runId;
  const [run, context, speed] = runId ? await Promise.all([
    fetch(`${base}/runs/${runId}`).then((result) => result.json()),
    fetch(`${base}/runs/${runId}/context`).then((result) => result.json()),
    fetch(`${base}/runs/${runId}/speed`).then((result) => result.json()),
  ]) : [null, null, null];
  const mainCall = context?.calls?.find((call) => Number(call.turn) > 0) ?? null;
  return {
    httpStatus: response.status,
    runId,
    runStatus: run?.status ?? 'unknown',
    answer: String(surface.reply ?? ''),
    toolCalls: run?.events?.filter((event) => event.type === 'tool_completed').length ?? null,
    checkpoint: run?.events?.find((event) => event.type === 'checkpoint_completed')?.payload ?? null,
    checkpointModelCalls: context?.calls?.filter((call) => Number(call.turn) < 0).length ?? null,
    mainRequestBytes: mainCall?.context?.requestBytes ?? null,
    totalRequestBytes: context?.aggregate?.requestBytes ?? null,
    mainProviderInputTokens: mainCall?.providerUsage?.inputTokens ?? null,
    totalProviderInputTokens: context?.aggregate?.providerInputTokens ?? null,
    wallMs: speed?.wallMs ?? null,
    error: response.ok ? null : (surface.error ?? 'turn failed'),
  };
}

await Promise.all([stateDir, workspace, isolatedHome].map((path) => mkdir(path, { recursive: true })));
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
const session = await sessions.create();
const ledger = new ConversationLedger(join(stateDir, 'conversations'));
await ledger.ensure({ sessionId: session.id });
const firstNeedles = {
  early: 'FIRST-EARLY-7391', middle: 'FIRST-MIDDLE-7391', recent: 'FIRST-RECENT-7391',
};
const secondNeedles = { middle: 'SECOND-MIDDLE-7391', recent: 'SECOND-RECENT-7391' };
let firstServer;
let secondServer;
try {
  await appendPhase(ledger, session.id, {
    phase: 'first', pairs: 650, ...firstNeedles,
  });
  firstServer = makeServer();
  const firstBase = await listen(firstServer);
  const first = await requestTurn(firstBase, session.id, [
    '도구나 스킬을 사용하지 말고 이전 대화만 읽어.',
    'first_early, first_middle, first_recent 값을 정확히 한 줄에 써.',
  ].join(' '));
  first.passed = first.httpStatus === 200 && first.runStatus === 'completed'
    && Object.values(firstNeedles).every((needle) => first.answer.includes(needle))
    && first.toolCalls === 0 && Boolean(first.checkpoint);
  await close(firstServer, 'checkpoint_continuity_restart');
  firstServer = null;

  await appendPhase(ledger, session.id, {
    phase: 'second', pairs: 600, early: 'SECOND-EARLY-UNASKED-7391',
    middle: secondNeedles.middle, recent: secondNeedles.recent,
  });
  secondServer = makeServer();
  const secondBase = await listen(secondServer);
  const second = await requestTurn(secondBase, session.id, [
    '도구나 스킬을 사용하지 말고 이전 대화만 읽어.',
    'first_early, first_middle, first_recent, second_middle, second_recent 값을 순서대로 정확히 한 줄에 써.',
  ].join(' '));
  const expectedSecond = [...Object.values(firstNeedles), ...Object.values(secondNeedles)];
  const conversation = await ledger.read(session.id);
  second.passed = second.httpStatus === 200 && second.runStatus === 'completed'
    && expectedSecond.every((needle) => second.answer.includes(needle))
    && second.toolCalls === 0 && Boolean(second.checkpoint)
    && conversation.checkpoints.length === 2
    && conversation.checkpoints[0].checkpointId !== conversation.checkpoints[1].checkpointId;

  const result = {
    schema: 't5.checkpoint-continuity-qualification.v1',
    recordedAt: new Date().toISOString(), model: (await access.status()).modelId,
    actualUserData: false, toolOutputsSeeded: false, defaultCheckpointMode: true,
    sessionId: session.id, serverRestartedBetweenTurns: true,
    seededConversationChars: { first: 780000, second: 720000 },
    first, second,
    canonicalMessageCount: conversation.entries.length,
    checkpointCount: conversation.checkpoints.length,
    checkpointCoverage: conversation.checkpoints.map((checkpoint) => checkpoint.coversThroughMessageId),
    passed: first.passed && second.passed,
    room: keep ? room : null,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} finally {
  if (firstServer) await close(firstServer, 'checkpoint_continuity_shutdown');
  if (secondServer) await close(secondServer, 'checkpoint_continuity_shutdown');
  if (previousHome == null) delete process.env.T5_REFOUNDATION_HOME;
  else process.env.T5_REFOUNDATION_HOME = previousHome;
  if (!keep) await rm(room, { recursive: true, force: true });
}
