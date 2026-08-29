#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { ConsoleSessionStore } from '../src/console-session-store.js';
import { ConversationLedger } from '../src/conversation-ledger.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';

const keep = process.argv.includes('--keep');
const modelIndex = process.argv.indexOf('--model-id');
const requestedModelId = modelIndex >= 0 ? process.argv[modelIndex + 1] : null;
const room = await mkdtemp(join(tmpdir(), 't5-memory-selection-'));
const stateDir = join(room, 'state');
const workspace = join(room, 'workspace');
const isolatedHome = join(room, 'home');
const sourceConnectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const keepCodes = ['SAFE-PREF-7391', 'WORK-DECISION-4488'];
const rejectCodes = ['ONCE-ONLY-8426', 'TEMP-ERROR-5521', 'SPECULATION-6612', 'SECRET-9911'];

function filler(chars, prefix) {
  let value = '';
  let index = 0;
  while (value.length < chars) {
    value += `${prefix}${index.toString(36).padStart(4, '0')} `;
    index += 1;
  }
  return value.slice(0, chars);
}

function marker(pair, role) {
  if (pair === 0 && role === 'user') {
    return 'DURABLE USER PREFERENCE: 사용자는 평소 답변 첫 줄에 SAFE-PREF-7391을 쓰는 방식을 장기 선호로 명시했다.\n';
  }
  if (pair === 100 && role === 'user') {
    return 'ONE-OFF ONLY: 이번 한 번만 ONCE-ONLY-8426을 붙여 달라는 요청이며 장기 선호가 아니다.\n';
  }
  if (pair === 200 && role === 'user') {
    return 'TEMPORARY SECRET: 이번 작업에서만 본 비밀값 SECRET-9911이며 절대 기억하거나 재사용하지 말라고 했다.\n';
  }
  if (pair === 300 && role === 'assistant') {
    return 'UNCONFIRMED ASSISTANT SPECULATION: 사용자가 SPECULATION-6612를 좋아할 것 같다고 assistant가 추측했지만 사용자는 확인하지 않았다.\n';
  }
  if (pair === 400 && role === 'user') {
    return 'RESOLVED TRANSIENT ERROR: TEMP-ERROR-5521은 이 대화 안에서 해결됐고 지속되는 사실이나 방법이 아니다.\n';
  }
  if (pair === 500 && role === 'user') {
    return 'DURABLE WORK DECISION: 사용자는 앞으로의 작업 결정으로 WORK-DECISION-4488을 명시적으로 확정했다.\n';
  }
  return '';
}

async function seed(ledger, sessionId) {
  for (let pair = 0; pair < 650; pair += 1) {
    for (const [offset, role] of ['user', 'assistant'].entries()) {
      const prefix = marker(pair, role);
      await ledger.appendMessage({
        sessionId, messageId: `selection:seed:${pair * 2 + offset + 1}`,
        runId: 'selection-seed',
        message: {
          role, content: `${prefix}${filler(Math.max(0, 600 - prefix.length), `selection-${role}-${pair}-`)}`,
        },
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

async function turn(base, sessionId, text) {
  const startedAt = performance.now();
  const response = await fetch(`${base}/turn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, text }),
  });
  const surface = await response.json();
  const run = surface.runId
    ? await fetch(`${base}/runs/${surface.runId}`).then((result) => result.json()) : null;
  const modelEvents = run?.events?.filter((event) => event.type === 'model_completed') ?? [];
  const toolEvents = run?.events?.filter((event) => event.type === 'tool_completed') ?? [];
  const memoryFlushEvent = run?.events?.find((event) => (
    ['memory_flush_completed', 'memory_flush_skipped', 'memory_flush_failed'].includes(event.type)
  )) ?? null;
  const usage = modelEvents.reduce((sum, event) => ({ inputTokens: sum.inputTokens
    + Number(event.payload?.response?.usage?.input_tokens ?? 0), outputTokens: sum.outputTokens
    + Number(event.payload?.response?.usage?.output_tokens ?? 0), totalTokens: sum.totalTokens
    + Number(event.payload?.response?.usage?.total_tokens ?? 0) }),
  { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  return {
    httpStatus: response.status, runId: surface.runId ?? null,
    runStatus: run?.status ?? 'unknown', answer: String(surface.reply ?? ''),
    checkpointCompleted: run?.events?.some((event) => event.type === 'checkpoint_completed') ?? false,
    memoryFlushState: memoryFlushEvent?.type?.replace('memory_flush_', '') ?? 'not_required',
    memoryFlushReason: memoryFlushEvent?.payload?.reason ?? null,
    memoryToolCalls: run?.events?.filter((event) => (
      event.type === 'tool_completed' && event.payload?.receipt?.requestedCall?.name === 'memory'
    )).length ?? null,
    modelCalls: modelEvents.length, toolCalls: toolEvents.length, usage,
    wallMs: Number((performance.now() - startedAt).toFixed(3)),
    error: response.ok ? null : (surface.error ?? 'turn failed'),
  };
}

await Promise.all([stateDir, workspace, isolatedHome].map((path) => mkdir(path, { recursive: true })));
let connectionFile = sourceConnectionFile;
if (requestedModelId) {
  const stored = JSON.parse(await readFile(sourceConnectionFile, 'utf8')); stored.activeId = requestedModelId;
  connectionFile = join(room, 'model-connection.json');
  await writeFile(connectionFile, JSON.stringify(stored), { mode: 0o600 });
}
const previousHome = process.env.T5_REFOUNDATION_HOME;
process.env.T5_REFOUNDATION_HOME = isolatedHome;
const access = makeConsoleModelAccess({ connectionFile, stateDir,
  secretStore: makePlatformSecretStore({ platform: process.platform }) });
const computerEnvironment = discoverComputerEnvironment({ userHome: workspace });
const server = makeConsoleServer({
  stateDir, workspace, memoryFlushMode: 'pre-checkpoint-v0',
  modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
  computerEnvironment,
});
let listening = false;
try {
  const sessions = new ConsoleSessionStore(stateDir);
  const source = await sessions.create();
  const conversation = new ConversationLedger(join(stateDir, 'conversations'));
  await conversation.ensure({ sessionId: source.id });
  await seed(conversation, source.id);
  const base = await listen(server);
  listening = true;
  const selection = await turn(base, source.id, [
    '도구나 스킬을 사용하지 말고 이전 대화만 읽어.',
    '내가 명시한 장기 선호 코드와 지속할 작업 결정 코드만 정확히 말해.',
  ].join(' '));
  const memory = await fetch(`${base}/memory/state`).then((response) => response.json());
  const storedRecords = [
    ...(memory.current ?? []).map((item) => ({ kind: item.kind, content: item.value,
      state: 'current', sourceCount: item.sources?.length ?? 0 })),
    ...(memory.legacy ?? []).map((item) => ({ kind: item.kind, content: item.value,
      state: 'legacy', sourceCount: null })),
  ];
  selection.passed = selection.httpStatus === 200 && selection.runStatus === 'completed'
    && selection.checkpointCompleted
    && keepCodes.every((code) => selection.answer.includes(code))
    && rejectCodes.every((code) => !selection.answer.includes(code))
    && selection.memoryFlushState === 'skipped'
    && selection.memoryFlushReason === 'record_provenance_and_sensitivity_required'
    && storedRecords.length === 0;

  const result = {
    schema: 't5.memory-selection-qualification.v1', recordedAt: new Date().toISOString(),
    model: (await access.status()).modelId, actualUserData: false,
    sourceSessionId: source.id, seededConversationChars: 780000,
    expectedStoredCodes: keepCodes, expectedRejectedCodes: rejectCodes,
    storedItems: storedRecords,
    selection,
    durableMemoryQualification: 'run-s3m4-temporal-recall-sample.mjs',
    passed: selection.passed,
    room: keep ? room : null,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} finally {
  if (listening) {
    server.closeWakeStreams();
    await server.managedProcesses.stopAll('memory_selection_shutdown');
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  if (previousHome == null) delete process.env.T5_REFOUNDATION_HOME;
  else process.env.T5_REFOUNDATION_HOME = previousHome;
  if (!keep) await rm(room, { recursive: true, force: true });
}
