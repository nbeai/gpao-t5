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
const checkpointIndex = process.argv.indexOf('--checkpoint');
const conversationCheckpointMode = checkpointIndex >= 0 ? process.argv[checkpointIndex + 1] : 'off';
if (!['off', 'in-place-v0'].includes(conversationCheckpointMode)) {
  throw new TypeError('--checkpoint must be off or in-place-v0');
}
const room = await mkdtemp(join(tmpdir(), 't5-conversation-pressure-'));
const stateDir = join(room, 'state');
const workspace = join(room, 'workspace');
const isolatedHome = join(room, 'home');
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));

const tiers = [
  { id: 'small', pairs: 20, charsPerMessage: 250 },
  { id: 'medium', pairs: 60, charsPerMessage: 500 },
  { id: 'large', pairs: 150, charsPerMessage: 600 },
  { id: 'stress', pairs: 450, charsPerMessage: 600 },
  { id: 'edge', pairs: 500, charsPerMessage: 600 },
  { id: 'overflow', pairs: 550, charsPerMessage: 600 },
  { id: 'extreme', pairs: 650, charsPerMessage: 600 },
  { id: 'limit', pairs: 750, charsPerMessage: 600 },
  { id: 'overlimit', pairs: 850, charsPerMessage: 600 },
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
    value += `${prefix}${index.toString(36).padStart(4, '0')} `;
    index += 1;
  }
  return value.slice(0, chars);
}

function needlesFor(tier) {
  return {
    early: `${tier.id.toUpperCase()}-EARLY-7391`,
    middle: `${tier.id.toUpperCase()}-MIDDLE-7391`,
    recent: `${tier.id.toUpperCase()}-RECENT-7391`,
  };
}

function messageContent(tier, pair, role, needleText = '') {
  const prefix = needleText ? `${needleText}\n` : `${tier.id} ${role} turn ${pair + 1}\n`;
  return `${prefix}${filler(Math.max(0, tier.charsPerMessage - prefix.length), `${tier.id}-${role}-${pair}-`)}`;
}

async function seedTier(server, tier) {
  const sessions = new ConsoleSessionStore(stateDir);
  const session = await sessions.create();
  await server.conversationLedger.ensure({ sessionId: session.id });
  const needles = needlesFor(tier);
  const middlePair = Math.floor(tier.pairs / 2);
  let sequence = 0;
  for (let pair = 0; pair < tier.pairs; pair += 1) {
    const userNeedle = pair === 0
      ? `OWNER FACT early_code=${needles.early}`
      : pair === tier.pairs - 1 ? `OPEN WORK recent_todo=${needles.recent}` : '';
    const assistantNeedle = pair === middlePair
      ? `DECISION middle_decision=${needles.middle}` : '';
    for (const message of [
      { role: 'user', content: messageContent(tier, pair, 'user', userNeedle) },
      { role: 'assistant', content: messageContent(tier, pair, 'assistant', assistantNeedle) },
    ]) {
      sequence += 1;
      await server.conversationLedger.appendMessage({
        sessionId: session.id, messageId: `${tier.id}:seed:${sequence}`,
        runId: `${tier.id}-seed`, message,
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
        '도구나 스킬을 사용하지 말고 이전 대화만 읽어.',
        'early_code, middle_decision, recent_todo 값을 EARLY / MIDDLE / RECENT 순서로 정확히 한 줄에 써.',
        '추측하거나 바꾸지 마.',
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
  const contextCall = context?.calls?.find((call) => Number(call.turn) > 0) ?? context?.calls?.at(-1);
  const checkpointCalls = context?.calls?.filter((call) => Number(call.turn) < 0).length ?? 0;
  const checkpointEvents = run?.events?.filter((event) => event.type === 'checkpoint_completed') ?? [];
  return {
    tier: tier.id,
    sessionId: seeded.sessionId,
    runId,
    httpStatus: response.status,
    runStatus: run?.status ?? 'unknown',
    passed: response.ok && Object.values(seeded.needles).every((needle) => answer.includes(needle))
      && toolCalls === 0,
    answer,
    expectedNeedles: seeded.needles,
    seededPairs: tier.pairs,
    seededConversationChars: tier.pairs * tier.charsPerMessage * 2,
    sourceMessages: contextCall?.context?.source?.messages ?? null,
    requestBytes: contextCall?.context?.requestBytes ?? null,
    totalRequestBytes: context?.aggregate?.requestBytes ?? null,
    inputBytes: contextCall?.context?.input?.bytes ?? null,
    providerInputTokens: contextCall?.providerUsage?.inputTokens ?? null,
    totalProviderInputTokens: context?.aggregate?.providerInputTokens ?? null,
    wallMs: speed?.wallMs ?? (Date.now() - startedAt),
    modelCalls: speed?.model?.calls ?? null,
    checkpointModelCalls: checkpointCalls,
    checkpointCompleted: checkpointEvents.length === 1,
    checkpoint: checkpointEvents[0]?.payload ?? null,
    toolCalls,
    error: response.ok ? null : (surface.error ?? 'turn failed'),
  };
}

await Promise.all([stateDir, workspace, isolatedHome].map((path) => mkdir(path, { recursive: true })));
const previousHome = process.env.T5_REFOUNDATION_HOME;
process.env.T5_REFOUNDATION_HOME = isolatedHome;
const access = makeConsoleModelAccess({ connectionFile, stateDir });
const server = makeConsoleServer({
  stateDir, workspace, conversationCheckpointMode,
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
    schema: 't5.conversation-pressure-qualification.v1', recordedAt: new Date().toISOString(),
    model: (await access.status()).modelId, actualUserData: false,
    toolOutputsSeeded: false, conversationCheckpointMode, results,
    firstFailureTier: results.find((result) => !result.passed)?.tier ?? null,
    room: keep ? room : null,
  }, null, 2));
  if (results.some((result) => !result.passed)) process.exitCode = 1;
} finally {
  server.closeWakeStreams();
  await server.managedProcesses.stopAll('conversation_pressure_shutdown');
  await new Promise((resolveClose) => server.close(resolveClose));
  if (previousHome == null) delete process.env.T5_REFOUNDATION_HOME;
  else process.env.T5_REFOUNDATION_HOME = previousHome;
  if (!keep) await rm(room, { recursive: true, force: true });
}
