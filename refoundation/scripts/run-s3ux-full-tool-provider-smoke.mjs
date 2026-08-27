import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeChatGptResponsesModel } from '../src/chatgpt-responses-model.js';
import { makeConsoleServer } from '../src/console-server.js';
import { consoleInstructions } from '../src/console-model-factory.js';
import { makeOpenAIResponsesModel } from '../src/openai-responses-model.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { loadReadOnlyConnectionCredential } from './run-s3m6-reflection-shadow-qualification.mjs';

const ENDPOINTS = { api_key: 'https://api.openai.com/v1/responses',
  chatgpt_oauth: 'https://chatgpt.com/backend-api/codex/responses' };
const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
function assertStrict(schema, path = 'parameters') {
  if (!schema || typeof schema !== 'object') return;
  for (const [index, item] of (schema.anyOf ?? []).entries()) assertStrict(item, `${path}.anyOf[${index}]`);
  const object = schema.type === 'object' || (Array.isArray(schema.type) && schema.type.includes('object'));
  if (object && schema.additionalProperties === false) {
    const properties = Object.keys(schema.properties ?? {}).sort(); const required = [...(schema.required ?? [])].sort();
    if (JSON.stringify(properties) !== JSON.stringify(required)) throw new Error(`strict_schema_required_mismatch:${path}`);
  }
  for (const [name, child] of Object.entries(schema.properties ?? {})) assertStrict(child, `${path}.${name}`);
  if (schema.items) assertStrict(schema.items, `${path}.items`);
}
function auditedFetch({ credential, observations }) {
  const endpoint = ENDPOINTS[credential.kind]; const secrets = [credential.secret.key,
    credential.secret.access, credential.secret.accountId].filter(Boolean);
  return async (url, options = {}) => {
    if (String(url) !== endpoint || options.method !== 'POST') throw new Error('provider_endpoint_boundary');
    const bodyText = String(options.body ?? ''); if (secrets.some((secret) => bodyText.includes(secret))) throw new Error('provider_body_secret');
    const body = JSON.parse(bodyText); if (body.store !== false || body.model !== credential.modelId
      || !options.headers?.authorization || !Array.isArray(body.tools) || body.tools.length < 4) {
      throw new Error('full_tool_request_boundary');
    }
    for (const tool of body.tools) { if (tool.type !== 'function' || tool.strict !== true) throw new Error('provider_tool_not_strict');
      assertStrict(tool.parameters, tool.name); }
    observations.push({ requestDigest: hash(bodyText), requestBytes: Buffer.byteLength(bodyText),
      toolCount: body.tools.length, toolNames: body.tools.map((item) => item.name).sort(), storeFalse: true });
    return fetch(url, options);
  };
}
function modelFor(credential, workspace, observations) {
  const fetchImpl = auditedFetch({ credential, observations }); const instructions = consoleInstructions(workspace,
    { platform: process.platform, architecture: process.arch, commandFamily: 'posix', commandProgram: '/bin/zsh' });
  const model = credential.kind === 'api_key'
    ? makeOpenAIResponsesModel({ apiKey: credential.secret.key, model: credential.modelId,
      endpoint: ENDPOINTS.api_key, fetchImpl, instructions, reasoningEffort: 'medium' })
    : makeChatGptResponsesModel({ model: credential.modelId, endpoint: ENDPOINTS.chatgpt_oauth,
      fetchImpl, maxAttempts: 1, instructions, credentials: { async get() { return {
        access: credential.secret.access, accountId: credential.secret.accountId,
        expiresAt: credential.secret.expiresAt, modelId: credential.modelId }; } } });
  return { id: credential.modelId, async respond(input) {
    const response = await model.respond(input);
    if ((response.toolCalls ?? []).some((call) => call.name !== 'work_completion')) {
      throw Object.assign(new Error('unexpected_tool_requested_in_smoke'), { code: 'unexpected_tool' });
    }
    return response;
  } };
}

async function one(connection, credential) {
  const room = await mkdtemp(join(tmpdir(), 't5-s3ux-full-tools-')); const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace'); await mkdir(workspace); const observations = []; let server;
  try {
    server = makeConsoleServer({ stateDir, workspace, learningReviewMode: 'off',
      modelFactory: () => modelFor(credential, workspace, observations),
      modelStatus: () => ({ connected: true, provider: credential.provider, modelId: credential.modelId }) });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const response = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id,
        text: '현재 제품 전체 도구 schema 연결 확인이 목적이야. 컴퓨터나 외부 자원을 쓰지 말고 짧게 준비됐다고 답해.' }) });
    const result = await response.json(); const run = result.runId
      ? await fetch(`${base}/runs/${result.runId}`).then((item) => item.json()) : null;
    const modelEvents = run?.events?.filter((event) => ['model_started', 'model_completed'].includes(event.type)) ?? [];
    return { connection: connection.id, model: credential.modelId, httpStatus: response.status,
      kind: result.kind ?? null, providerRequests: observations.length,
      toolCounts: observations.map((item) => item.toolCount),
      toolSetDigests: observations.map((item) => hash(item.toolNames)),
      modelEvents: modelEvents.length, runStatus: run?.status ?? null,
      replyDigest: result.reply ? hash(result.reply) : null,
      internalPathOrSecretInPublicResult: /(?:\/Users\/|\/private\/|\bsk-)/u.test(String(result.reply ?? '')),
      passed: response.status === 200 && observations.length >= 1 && modelEvents.length >= 2
        && run?.status === 'completed' && Boolean(result.reply)
        && !/(?:\/Users\/|\/private\/|\bsk-)/u.test(String(result.reply ?? '')) };
  } finally {
    if (server) { server.closeWakeStreams(); await server.managedProcesses.stopAll('test_shutdown');
      await new Promise((resolve) => server.close(resolve)); }
    await rm(room, { recursive: true, force: true });
  }
}

async function main() {
  if (!process.argv.includes('--human-controlled')) throw new Error('human_control_required');
  const file = process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
    ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json');
  const state = JSON.parse(await (await import('node:fs/promises')).readFile(file, 'utf8'));
  const secretStore = makePlatformSecretStore({ platform: process.platform }); const ids = [
    'api_key:openai:gpt-5.6-terra', 'chatgpt_oauth:gpt-5.5']; const results = [];
  for (const id of ids) {
    const connection = state.connections?.find((item) => item.id === id);
    if (!connection) throw new Error('connection_boundary');
    const credential = await loadReadOnlyConnectionCredential({ connection, secretStore });
    results.push(await one(connection, credential));
  }
  const report = { schema: 't5.s3ux.full-tool-provider-smoke.v1', results,
    providerRequests: results.reduce((sum, item) => sum + item.providerRequests, 0),
    externalWrites: 0, credentialWrites: 0, passed: results.length === 2 && results.every((item) => item.passed) };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); if (!report.passed) process.exitCode = 1;
}
main().catch((error) => { process.stdout.write(`${JSON.stringify({ schema: 't5.s3ux.full-tool-provider-smoke.v1',
  passed: false, failure: /credential|connection/u.test(error?.message ?? '') ? 'credential_boundary' : 'product_or_provider_boundary' })}\n`); process.exitCode = 1; });
