import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeChatGptResponsesModel } from '../src/chatgpt-responses-model.js';
import { makeConsoleServer } from '../src/console-server.js';
import { consoleInstructions } from '../src/console-model-factory.js';
import { makeOpenAIResponsesModel } from '../src/openai-responses-model.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { makeS3aPerformanceObserver } from '../test/helpers/s3a-performance-observer.js';
import { loadReadOnlyConnectionCredential } from './run-s3m6-reflection-shadow-qualification.mjs';

const ENDPOINTS = { api_key: 'https://api.openai.com/v1/responses',
  chatgpt_oauth: 'https://chatgpt.com/backend-api/codex/responses' };
const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const MODES = ['O0_off', 'O2_full_shadow'];
const OBSERVER_IDENTITY = /t5\.s3a|s3a|O2_full_shadow|state_read_replay|provider_wait_combined_unknown|droppedSpans/iu;

function differingPaths(left, right, path = '$', result = []) {
  if (Object.is(left, right)) return result;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) result.push(`${path}.length`);
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      differingPaths(left[index], right[index], `${path}[${index}]`, result);
    }
    return result;
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) differingPaths(left[key], right[key], `${path}.${key}`, result);
    return result;
  }
  result.push(path); return result;
}

function deterministicIds() {
  let sequence = 0;
  return () => { sequence += 1; return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`; };
}

function modelFor(credential, workspace, observer, requests) {
  const endpoint = ENDPOINTS[credential.kind];
  const secrets = [credential.secret.key, credential.secret.access, credential.secret.accountId].filter(Boolean);
  const fetchImpl = async (url, options = {}) => {
    if (String(url) !== endpoint || options.method !== 'POST') throw new Error('provider_endpoint_boundary');
    const bodyText = String(options.body ?? '');
    if (secrets.some((secret) => bodyText.includes(secret))) throw new Error('provider_body_secret');
    const body = JSON.parse(bodyText);
    if (body.store !== false || body.model !== credential.modelId || !Array.isArray(body.tools)) {
      throw new Error('provider_request_boundary');
    }
    requests.push({ bodyDigest: hash(bodyText), body, bytes: Buffer.byteLength(bodyText),
      toolsDigest: hash(body.tools.map((tool) => tool.name)), toolCount: body.tools.length,
      observerFieldsInBody: OBSERVER_IDENTITY.test(bodyText) });
    return fetch(url, { ...options, signal: AbortSignal.any([
      ...(options.signal ? [options.signal] : []), AbortSignal.timeout(30_000),
    ]) });
  };
  const instructions = consoleInstructions(workspace,
    { platform: process.platform, architecture: process.arch, commandFamily: 'posix', commandProgram: '/bin/zsh' });
  const raw = credential.kind === 'api_key'
    ? makeOpenAIResponsesModel({ apiKey: credential.secret.key, model: credential.modelId,
      endpoint, fetchImpl, instructions, reasoningEffort: 'medium' })
    : makeChatGptResponsesModel({ model: credential.modelId, endpoint, fetchImpl, maxAttempts: 1,
      instructions, credentials: { async get() { return { access: credential.secret.access,
        accountId: credential.secret.accountId, expiresAt: credential.secret.expiresAt,
        modelId: credential.modelId }; } } });
  return { async respond(input) {
    return observer.measure('provider_wait_combined_unknown', () => raw.respond(input), {
      bytesOut: requests.at(-1)?.bytes ?? null, itemCount: 1,
    });
  } };
}

async function runMode(credential, mode, workspace, fixedNow) {
  const room = await mkdtemp(join(tmpdir(), `t5-product-live-${mode === 'O0_off' ? 'off' : 'on'}-`));
  const stateDir = join(room, 'state'); await mkdir(stateDir);
  const observer = makeS3aPerformanceObserver({ mode }); const requests = []; let server;
  try {
    server = makeConsoleServer({ stateDir, workspace, learningReviewMode: 'off',
      runtimeNow: () => new Date(fixedNow),
      workStoreMakeId: deterministicIds(),
      modelFactory: () => modelFor(credential, workspace, observer, requests),
      modelStatus: () => ({ connected: true, provider: credential.provider, modelId: credential.modelId }) });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const response = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id,
        text: '현재 제품이 준비됐는지 확인하는 짧은 대화야. 컴퓨터나 외부 자원을 쓰지 말고 준비됐다고만 답해.' }) });
    const result = await response.json(); const runs = await server.runLedger.list({ sessionId: session.id });
    const run = runs.at(-1); const tools = run?.events.filter((event) => event.type === 'tool_completed') ?? [];
    const snapshot = observer.snapshot(); await observer.flush(async () => {});
    const request = requests[0] == null ? null : { ...requests[0], body: undefined };
    return { mode, httpStatus: response.status, kind: result.kind ?? null,
      request, requestBody: requests[0]?.body ?? null, providerRequests: requests.length,
      runStatus: run?.status ?? null, toolCalls: tools.length,
      toolNames: tools.map((event) => event.payload?.receipt?.requestedCall?.name ?? null),
      replyPresent: Boolean(result.reply), replyChars: String(result.reply ?? '').length,
      internalObserverInReply: OBSERVER_IDENTITY.test(String(result.reply ?? '')),
      observerSpanCount: snapshot.spans.length, diagnostics: snapshot.diagnostics,
      passed: response.status === 200 && requests.length >= 1 && run?.status === 'completed'
        && Boolean(result.reply) && requests[0]?.observerFieldsInBody === false
        && !OBSERVER_IDENTITY.test(String(result.reply ?? '')) };
  } finally {
    if (server) { server.closeWakeStreams(); await server.managedProcesses.stopAll('s3a_shutdown');
      await new Promise((resolve) => server.close(resolve)); }
    await rm(room, { recursive: true, force: true });
  }
}

async function main() {
  if (!process.argv.includes('--human-controlled')) throw new Error('human_control_required');
  const connectionFile = process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
    ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json');
  const state = JSON.parse(await (await import('node:fs/promises')).readFile(connectionFile, 'utf8'));
  const secretStore = makePlatformSecretStore({ platform: process.platform });
  const ids = ['api_key:openai:gpt-5.6-terra', 'chatgpt_oauth:gpt-5.5']; const models = [];
  for (const id of ids) {
    const connection = state.connections?.find((item) => item.id === id);
    if (!connection) throw new Error('connection_boundary');
    const credential = await loadReadOnlyConnectionCredential({ connection, secretStore });
    const pairRoom = await mkdtemp(join(tmpdir(), 't5-product-live-pair-'));
    const workspace = join(pairRoom, 'workspace'); await mkdir(workspace);
    const fixedNow = '2026-08-27T00:00:00.000Z'; const results = [];
    try {
      for (const mode of MODES) results.push(await runMode(credential, mode, workspace, fixedNow));
    } finally { await rm(pairRoom, { recursive: true, force: true }); }
    const [off, on] = results;
    const bodyDiffPaths = differingPaths(off.requestBody, on.requestBody).slice(0, 30);
    for (const result of results) delete result.requestBody;
    const effectiveRoutes = results.map((result) => result.toolNames.filter((name) => name !== 'work_completion'));
    models.push({ model: credential.modelId, results, bodyDiffPaths,
      pairedRequestBodyEqual: off.request?.bodyDigest === on.request?.bodyDigest,
      pairedToolSurfaceEqual: off.request?.toolsDigest === on.request?.toolsDigest,
      pairedRequestBytesEqual: off.request?.bytes === on.request?.bytes,
      pairedEffectiveRouteEqual: JSON.stringify(effectiveRoutes[0]) === JSON.stringify(effectiveRoutes[1]),
      settlementProposalVaried: JSON.stringify(off.toolNames) !== JSON.stringify(on.toolNames),
      passed: results.every((item) => item.passed)
        && off.request?.bodyDigest === on.request?.bodyDigest
        && off.request?.toolsDigest === on.request?.toolsDigest
        && off.request?.bytes === on.request?.bytes
        && JSON.stringify(effectiveRoutes[0]) === JSON.stringify(effectiveRoutes[1]) });
  }
  const report = { schema: 't5.s3a.live-observer-pairs.v1', models,
    providerRequests: models.reduce((sum, model) => sum + model.results.reduce((n, item) => n + item.providerRequests, 0), 0),
    externalWrites: 0, credentialWrites: 0, passed: models.length === 2 && models.every((item) => item.passed) };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); if (!report.passed) process.exitCode = 1;
}
main().catch((error) => { process.stdout.write(`${JSON.stringify({ schema: 't5.s3a.live-observer-pairs.v1',
  passed: false, failure: /credential|connection/u.test(error?.message ?? '') ? 'credential_boundary' : 'product_or_provider_boundary' })}\n`); process.exitCode = 1; });
