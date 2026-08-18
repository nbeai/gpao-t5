#!/usr/bin/env node
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { ConsoleSessionStore } from '../src/console-session-store.js';

const keep = process.argv.includes('--keep');
const fromIndex = process.argv.indexOf('--from');
const fromTier = fromIndex >= 0 ? process.argv[fromIndex + 1] : null;
const room = await mkdtemp(join(tmpdir(), 't5-context-pressure-'));
const stateDir = join(room, 'state');
const workspace = join(room, 'workspace');
const isolatedHome = join(room, 'home');
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const tiers = [
  { id: 'small', outputs: 3, charsPerOutput: 4_000, needleIndexes: [0, 1, 2] },
  { id: 'medium', outputs: 3, charsPerOutput: 20_000, needleIndexes: [0, 1, 2] },
  { id: 'large', outputs: 3, charsPerOutput: 60_000, needleIndexes: [0, 1, 2] },
  { id: 'stress', outputs: 9, charsPerOutput: 60_000, needleIndexes: [0, 4, 8] },
  { id: 'edge', outputs: 10, charsPerOutput: 60_000, needleIndexes: [0, 4, 9] },
  { id: 'overflow', outputs: 11, charsPerOutput: 60_000, needleIndexes: [0, 5, 10] },
];
const selectedTiers = fromTier
  ? tiers.slice(tiers.findIndex((tier) => tier.id === fromTier))
  : tiers;
if (!selectedTiers.length || (fromTier && selectedTiers[0]?.id !== fromTier)) {
  throw new TypeError(`unknown --from tier: ${fromTier}`);
}

function filler(chars, prefix) {
  let value = '';
  let index = 0;
  while (value.length < chars) {
    value += `${prefix}-${index.toString(36).padStart(5, '0')} `;
    index += 1;
  }
  return value.slice(0, chars);
}

function needlesFor(tier) {
  return ['EARLY', 'MIDDLE', 'RECENT'].map((position) => `${tier.id.toUpperCase()}-${position}-7391`);
}

function outputFor(tier, outputIndex, needle) {
  const marker = needle ? `\nNEEDLE=${needle}\n` : '\nNO_NEEDLE\n';
  const remaining = Math.max(0, tier.charsPerOutput - marker.length);
  const left = Math.floor(remaining / 2);
  return `${filler(left, `${tier.id}-${outputIndex}-a`)}${marker}${filler(remaining - left, `${tier.id}-${outputIndex}-b`)}`;
}

function receiptFor(tier, outputIndex, stdout) {
  const callId = `${tier.id}-call-${outputIndex}`;
  const args = {
    command: `emit ${tier.id} ${outputIndex}`, cwd: null,
    effect: {
      kind: 'observe', summary: 'seed pressure output', targets: [], reversible: true,
      backupAvailable: false, recipientNew: false, approvalToken: null,
    },
  };
  return {
    toolCallId: callId,
    requestedCall: { id: callId, name: 'exec', args },
    actualCall: { name: 'exec', args },
    outcome: 'succeeded',
    result: {
      state: 'completed', cwd: workspace, stdout, stderr: '', truncated: false,
      omittedChars: 0, exitCode: 0, signal: null, durationMs: 1,
      startedAt: '2026-08-19T00:00:00.000Z', endedAt: '2026-08-19T00:00:00.001Z',
      effectObservation: { declared: { kind: 'observe', summary: 'seed pressure output', targets: [] }, changed: false },
      commandExplanation: { ok: true, source: `emit ${tier.id} ${outputIndex}`, steps: [{ executable: 'emit' }] },
    },
  };
}

async function seedTier(server, tier) {
  const sessions = new ConsoleSessionStore(stateDir);
  const session = await sessions.create();
  await server.conversationLedger.ensure({ sessionId: session.id });
  const needles = needlesFor(tier);
  const needleByIndex = new Map(tier.needleIndexes.map((index, position) => [index, needles[position]]));
  let sequence = 0;
  for (let index = 0; index < tier.outputs; index += 1) {
    const callId = `${tier.id}-call-${index}`;
    const callArgs = {
      command: `emit ${tier.id} ${index}`, cwd: null,
      effect: {
        kind: 'observe', summary: 'seed pressure output', targets: [], reversible: true,
        backupAvailable: false, recipientNew: false, approvalToken: null,
      },
    };
    const messages = [
      { role: 'user', content: `${tier.id} 기록 구간 ${index + 1}을 관측해.` },
      { role: 'assistant', content: '', toolCalls: [{ id: callId, name: 'exec', args: callArgs }] },
      { role: 'tool', toolCallId: callId, name: 'exec', content: JSON.stringify(
        receiptFor(tier, index, outputFor(tier, index, needleByIndex.get(index))),
      ) },
      { role: 'assistant', content: `${tier.id} 구간 ${index + 1} 확인 완료.` },
    ];
    for (const message of messages) {
      sequence += 1;
      await server.conversationLedger.appendMessage({
        sessionId: session.id, messageId: `${tier.id}:seed:${sequence}`, runId: `${tier.id}-seed`, message,
      });
    }
  }
  return { sessionId: session.id, needles };
}

async function runTier(server, base, tier) {
  const seeded = await seedTier(server, tier);
  const startedAt = Date.now();
  const response = await fetch(`${base}/turn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: seeded.sessionId,
      text: [
        '터미널이나 스킬을 사용하지 말고 이전 도구 결과만 읽어.',
        '앞·중간·최근 구간의 NEEDLE 코드 세 개를 EARLY / MIDDLE / RECENT 순서로 정확히 한 줄에 써.',
        '추측하거나 생략하지 마.',
      ].join(' '),
    }),
  });
  const surface = await response.json();
  const runs = await fetch(`${base}/runs?sessionId=${seeded.sessionId}`).then((result) => result.json());
  const runId = surface.runId ?? runs.runs?.[0]?.runId ?? null;
  let run = null;
  let context = null;
  let speed = null;
  if (runId) {
    [run, context, speed] = await Promise.all([
      fetch(`${base}/runs/${runId}`).then((result) => result.json()),
      fetch(`${base}/runs/${runId}/context`).then((result) => result.json()),
      fetch(`${base}/runs/${runId}/speed`).then((result) => result.json()),
    ]);
  }
  const answer = String(surface.reply ?? '');
  const toolCalls = run?.events?.filter((event) => event.type === 'tool_completed').length ?? null;
  const contextCall = context?.calls?.[0];
  return {
    tier: tier.id,
    sessionId: seeded.sessionId,
    runId,
    httpStatus: response.status,
    runStatus: run?.status ?? 'unknown',
    passed: response.ok && seeded.needles.every((needle) => answer.includes(needle)) && toolCalls === 0,
    answer,
    expectedNeedles: seeded.needles,
    seededOutputs: tier.outputs,
    seededStdoutChars: tier.outputs * tier.charsPerOutput,
    sourceMessages: contextCall?.context?.source?.messages ?? null,
    requestBytes: contextCall?.context?.requestBytes ?? null,
    inputBytes: contextCall?.context?.input?.bytes ?? null,
    functionOutputBytes: contextCall?.context?.input?.byKind?.function_call_output?.bytes ?? null,
    providerInputTokens: contextCall?.providerUsage?.inputTokens ?? null,
    wallMs: speed?.wallMs ?? (Date.now() - startedAt),
    modelCalls: speed?.model?.calls ?? null,
    toolCalls,
    error: response.ok ? null : (surface.error ?? 'turn failed'),
  };
}

await Promise.all([stateDir, workspace, isolatedHome].map((path) => mkdir(path, { recursive: true })));
const previousHome = process.env.T5_REFOUNDATION_HOME;
process.env.T5_REFOUNDATION_HOME = isolatedHome;
const access = makeConsoleModelAccess({ connectionFile, stateDir });
const server = makeConsoleServer({
  stateDir, workspace,
  modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
  computerEnvironment: discoverComputerEnvironment({ userHome: workspace }),
});
await new Promise((resolveListen, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolveListen);
});
const base = `http://127.0.0.1:${server.address().port}`;
const results = [];
try {
  for (const tier of selectedTiers) {
    const result = await runTier(server, base, tier);
    results.push(result);
    if (!result.passed) break;
  }
  console.log(JSON.stringify({
    schema: 't5.context-pressure-qualification.v1', recordedAt: new Date().toISOString(),
    model: (await access.status()).modelId, actualUserData: false,
    projection: 'historical-tool-receipt-v1', skillCatalog: 'on-demand', results,
    firstFailureTier: results.find((result) => !result.passed)?.tier ?? null,
    room: keep ? room : null,
  }, null, 2));
  if (results.some((result) => !result.passed)) process.exitCode = 1;
} finally {
  server.closeWakeStreams();
  await server.managedProcesses.stopAll('context_pressure_shutdown');
  await new Promise((resolveClose) => server.close(resolveClose));
  if (previousHome == null) delete process.env.T5_REFOUNDATION_HOME;
  else process.env.T5_REFOUNDATION_HOME = previousHome;
  if (!keep) await rm(room, { recursive: true, force: true });
}
