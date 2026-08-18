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
const room = await mkdtemp(join(tmpdir(), 't5-memory-flush-'));
const stateDir = join(room, 'state');
const workspace = join(room, 'workspace');
const isolatedHome = join(room, 'home');
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const originalCode = 'MEMORY-PREF-7391';
const replacementCode = 'MEMORY-PREF-8426';

function filler(chars, prefix) {
  let value = '';
  let index = 0;
  while (value.length < chars) {
    value += `${prefix}${index.toString(36).padStart(4, '0')} `;
    index += 1;
  }
  return value.slice(0, chars);
}

async function seedLongConversation(ledger, sessionId) {
  for (let pair = 0; pair < 650; pair += 1) {
    const userMarker = pair === 0
      ? `DURABLE USER PREFERENCE: 사용자는 답변 첫 줄에 ${originalCode}을 먼저 쓰는 방식을 장기 선호로 정했다.\n`
      : '';
    const messages = [
      {
        role: 'user',
        content: `${userMarker}${filler(Math.max(0, 600 - userMarker.length), `memory-user-${pair}-`)}`,
      },
      { role: 'assistant', content: filler(600, `memory-assistant-${pair}-`) },
    ];
    for (const [offset, message] of messages.entries()) {
      await ledger.appendMessage({
        sessionId, messageId: `memory:seed:${pair * 2 + offset + 1}`,
        runId: 'memory-seed', message,
      });
    }
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

async function turn(base, sessionId, text) {
  const response = await fetch(`${base}/turn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, text }),
  });
  const surface = await response.json();
  const run = surface.runId
    ? await fetch(`${base}/runs/${surface.runId}`).then((result) => result.json()) : null;
  return {
    httpStatus: response.status, runId: surface.runId ?? null,
    runStatus: run?.status ?? 'unknown', answer: String(surface.reply ?? ''),
    memoryToolCalls: run?.events?.filter((event) => (
      event.type === 'tool_completed' && event.payload?.receipt?.requestedCall?.name === 'memory'
    )).length ?? null,
    maintenanceMemoryCalls: run?.events?.filter((event) => (
      event.type === 'tool_completed' && event.payload?.purpose === 'memory_flush'
    )).length ?? null,
    checkpointCompleted: run?.events?.some((event) => event.type === 'checkpoint_completed') ?? false,
    memoryFlushCompleted: run?.events?.some((event) => event.type === 'memory_flush_completed') ?? false,
    error: response.ok ? null : (surface.error ?? 'turn failed'),
  };
}

async function memoryState(base) {
  return fetch(`${base}/memory/state`).then((response) => response.json());
}

await Promise.all([stateDir, workspace, isolatedHome].map((path) => mkdir(path, { recursive: true })));
const previousHome = process.env.T5_REFOUNDATION_HOME;
process.env.T5_REFOUNDATION_HOME = isolatedHome;
const access = makeConsoleModelAccess({ connectionFile, stateDir });
const computerEnvironment = discoverComputerEnvironment({ userHome: workspace });
const makeServer = () => makeConsoleServer({
  stateDir, workspace, memoryFlushMode: 'pre-checkpoint-v0',
  modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
  computerEnvironment,
});
const sessions = new ConsoleSessionStore(stateDir);
const sourceSession = await sessions.create();
const conversation = new ConversationLedger(join(stateDir, 'conversations'));
await conversation.ensure({ sessionId: sourceSession.id });
await seedLongConversation(conversation, sourceSession.id);

let firstServer;
let secondServer;
try {
  firstServer = makeServer();
  const firstBase = await listen(firstServer);
  const automatic = await turn(firstBase, sourceSession.id, [
    '도구나 스킬을 사용하지 말고 이전 대화만 읽어.',
    '내가 장기 선호로 정한 답변 코드만 정확히 말해.',
  ].join(' '));
  const afterAutomatic = await memoryState(firstBase);
  automatic.passed = automatic.httpStatus === 200 && automatic.runStatus === 'completed'
    && automatic.answer.includes(originalCode)
    && automatic.checkpointCompleted && automatic.memoryFlushCompleted
    && afterAutomatic.items.some((item) => (
      item.kind === 'user' && item.content.includes(originalCode)
      && item.source?.origin === 'pre_checkpoint'
    ));
  await close(firstServer, 'memory_qualification_restart');
  firstServer = null;

  secondServer = makeServer();
  const secondBase = await listen(secondServer);
  const recallSession = await sessions.create();
  const recall = await turn(secondBase, recallSession.id, '내가 기억해달라고 했던 답변 선호 코드를 알려줘.');
  recall.passed = recall.httpStatus === 200 && recall.runStatus === 'completed'
    && recall.answer.includes(originalCode);

  const replace = await turn(secondBase, recallSession.id, [
    `기억 속 ${originalCode} 답변 선호를 ${replacementCode}으로 바꿔 기억해.`,
    '이전 값은 남기지 마.',
  ].join(' '));
  const afterReplace = await memoryState(secondBase);
  replace.passed = replace.httpStatus === 200 && replace.runStatus === 'completed'
    && replace.memoryToolCalls > 0
    && afterReplace.items.some((item) => item.content.includes(replacementCode))
    && !afterReplace.items.some((item) => item.content.includes(originalCode));

  const remove = await turn(secondBase, recallSession.id, `${replacementCode} 답변 선호를 기억에서 지워줘.`);
  const afterRemove = await memoryState(secondBase);
  remove.passed = remove.httpStatus === 200 && remove.runStatus === 'completed'
    && remove.memoryToolCalls > 0
    && !afterRemove.items.some((item) => item.content.includes(replacementCode));

  const emptySession = await sessions.create();
  const forgotten = await turn(secondBase, emptySession.id, [
    '내 답변 선호 코드가 현재 기억에 없다면 NONE-7391만 답해.',
    '추측하지 마.',
  ].join(' '));
  forgotten.passed = forgotten.httpStatus === 200 && forgotten.runStatus === 'completed'
    && forgotten.answer.includes('NONE-7391')
    && !forgotten.answer.includes(originalCode) && !forgotten.answer.includes(replacementCode);

  const memoryLedger = await fetch(`${secondBase}/memory/ledger`).then((response) => response.json());
  const result = {
    schema: 't5.memory-flush-qualification.v1', recordedAt: new Date().toISOString(),
    model: (await access.status()).modelId, actualUserData: false,
    sourceSessionId: sourceSession.id, serverRestartedAfterFlush: true,
    seededConversationChars: 780000,
    automatic, recall, replace, remove, forgotten,
    activeItemsAfterRemoval: afterRemove.items.length,
    memoryEventTypes: memoryLedger.entries.map((entry) => entry.type),
    passed: [automatic, recall, replace, remove, forgotten].every((step) => step.passed),
    room: keep ? room : null,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} finally {
  if (firstServer) await close(firstServer, 'memory_qualification_shutdown');
  if (secondServer) await close(secondServer, 'memory_qualification_shutdown');
  if (previousHome == null) delete process.env.T5_REFOUNDATION_HOME;
  else process.env.T5_REFOUNDATION_HOME = previousHome;
  if (!keep) await rm(room, { recursive: true, force: true });
}
