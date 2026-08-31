#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { makeStoredChatGptCredentialSource } from '../src/chatgpt-oauth-credential.js';
import { makeChatGptResponsesModel } from '../src/chatgpt-responses-model.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';

const sourceFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const source = JSON.parse(await readFile(sourceFile, 'utf8'));
const selected = source.connections?.find((item) => item.id === 'chatgpt_oauth:gpt-5.5')
  ?? source.connections?.find((item) => item.id === source.activeId && item.kind === 'chatgpt_oauth');
if (!selected?.secretRef || selected.modelId !== 'gpt-5.5') {
  throw new Error('exact secret-backed gpt-5.5 ChatGPT OAuth connection is required');
}

const room = await mkdtemp(join(tmpdir(), 't5-perf2a-'));
const stateDir = join(room, 'state'); await mkdir(stateDir, { recursive: true });
const connectionFile = join(stateDir, 'model-connection.json');
await writeFile(connectionFile, JSON.stringify({
  version: source.version, activeId: selected.id, roleBindings: {}, connections: [selected],
}), { mode: 0o600 });
const credentials = makeStoredChatGptCredentialSource({
  file: connectionFile, secretStore: makePlatformSecretStore({ platform: process.platform }),
});

const tools = ['north', 'south', 'west'].map((name) => ({
  name: `observe_${name}`,
  description: `Read the current numeric value from the ${name} read-only source.`,
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
}));
const values = { observe_north: 4, observe_south: 9, observe_west: 6 };
const prompt = [
  '세 개의 현재 read-only source를 모두 실제로 확인한 뒤 가장 큰 값의 방향과 숫자만 답해줘.',
  '어느 source도 추측하지 말고 반드시 해당 Tool 결과를 사용해.',
].join(' ');
const variants = [
  { id: 'current_default', parallelToolCalls: null, guidance: '' },
  { id: 'provider_flag', parallelToolCalls: true, guidance: '' },
  { id: 'flag_plus_cross_tool_guidance', parallelToolCalls: true, guidance: [
    'When multiple observations are independent and none needs an earlier result, request them in one response.',
    'Never batch dependent or effectful calls.',
  ].join(' ') },
];

async function runVariant(variant) {
  const fetchImpl = variant.parallelToolCalls === true
    ? (url, init) => globalThis.fetch(url, { ...init, body: JSON.stringify({
      ...JSON.parse(init.body), parallel_tool_calls: true,
    }) })
    : globalThis.fetch;
  const model = makeChatGptResponsesModel({
    credentials, model: selected.modelId, instructions: variant.guidance,
    fetchImpl, maxAttempts: 1,
  });
  const messages = [{ role: 'user', content: prompt }];
  const groups = []; const seen = new Set(); let final = ''; let tokens = 0; let requestBytes = 0;
  const started = performance.now();
  for (let turn = 1; turn <= 5; turn += 1) {
    const response = await model.respond({ messages, tools });
    tokens += Number(response.usage?.total_tokens ?? 0);
    requestBytes += Number(response.contextReceipt?.requestBytes ?? 0);
    const calls = response.toolCalls ?? [];
    groups.push(calls.map((call) => call.name));
    messages.push({ role: 'assistant', content: response.text ?? '', toolCalls: calls });
    if (!calls.length) { final = response.text ?? ''; break; }
    for (const call of calls) {
      if (!Object.hasOwn(values, call.name)) throw new Error(`unexpected Tool ${call.name}`);
      seen.add(call.name);
      messages.push({ role: 'tool', toolCallId: call.id, name: call.name,
        content: JSON.stringify({ state: 'observed', value: values[call.name] }) });
    }
  }
  const allObserved = Object.keys(values).every((name) => seen.has(name));
  return {
    id: variant.id,
    passed: allObserved && /south|남|9/iu.test(final),
    firstToolBatchSize: groups[0]?.length ?? 0,
    toolCallGroups: groups,
    uniqueToolsObserved: seen.size,
    modelCalls: groups.length,
    tokens,
    requestBytes,
    wallMs: Number((performance.now() - started).toFixed(3)),
    finalAnswerPresent: Boolean(final),
  };
}

try {
  const results = [];
  for (const variant of variants) results.push(await runVariant(variant));
  process.stdout.write(`${JSON.stringify({
    schema: 't5.s6-perf2a-parallel-selection-qualification.v1',
    model: selected.modelId, provider: 'chatgpt_oauth', actualUserData: false,
    externalWrites: 0, productDefaultChanged: false, results,
  }, null, 2)}\n`);
} finally {
  await rm(room, { recursive: true, force: true });
}
