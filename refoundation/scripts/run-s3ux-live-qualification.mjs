#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { loadReadOnlyConnectionCredential, makeInMemoryProviderObserver,
  normalizeProviderUsage } from './run-s3m6-reflection-shadow-qualification.mjs';
import { makeOpenAIResponsesModel } from '../src/openai-responses-model.js';
import { makeChatGptResponsesModel } from '../src/chatgpt-responses-model.js';

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/responses';
const CHATGPT_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const INSTRUCTIONS = 'Synthetic canonical UX projection만 읽고 ux_qualification_answer 도구를 정확히 한 번 호출한다. 도구 밖 prose를 쓰지 않고 보지 못한 사실은 unknown으로 보존한다.';
const ARG_KEYS = ['artifactIdentity', 'executionStatus', 'message', 'queuedInputStatus',
  'rollbackStatus', 'unknownPreserved'];
export function safeOutput(value, canaries = []) {
  const text = String(value ?? '');
  return !canaries.some((item) => item && text.includes(item))
    && !/(?:\/Users\/|\/private\/|\/Volumes\/|[A-Za-z]:\\|\\\\[^\s]+\\|\b[0-9a-f]{8}-[0-9a-f-]{27}\b|\b[0-9a-f]{64}\b|\b(?:sk-|xox[baprs]-|ghp_)[A-Za-z0-9_-]+)/iu.test(text);
}
const tool = { name: 'ux_qualification_answer', strict: true,
  description: 'Return only the user-facing claims supported by the supplied synthetic canonical UX projection.',
  parameters: { type: 'object', additionalProperties: false, properties: {
    message: { type: 'string', maxLength: 600 },
    queuedInputStatus: { type: 'string', enum: ['not_applicable', 'queued', 'consumed'] },
    artifactIdentity: { type: 'string', enum: ['not_applicable', 'unchanged_existing', 'generated', 'unknown'] },
    executionStatus: { type: 'string', enum: ['not_applicable', 'succeeded', 'failed', 'unknown'] },
    rollbackStatus: { type: 'string', enum: ['not_applicable', 'not_executed', 'restored', 'unknown'] },
    unknownPreserved: { type: 'boolean' },
  }, required: ['message', 'queuedInputStatus', 'artifactIdentity', 'executionStatus',
    'rollbackStatus', 'unknownPreserved'] } };
const journeys = [
  ['UX-C1-terra', 'api_key:openai:gpt-5.6-terra',
    { queuedInputStatus: 'queued', artifactIdentity: 'not_applicable', executionStatus: 'not_applicable', rollbackStatus: 'not_applicable', unknownPreserved: false },
    { schema: 't5.public-work-reality.v1', activity: '작업 중', input: '현재 작업에 반영할 내용을 받았어요.', consumed: false }],
  ['UX-C1-gpt55', 'chatgpt_oauth:gpt-5.5',
    { queuedInputStatus: 'queued', artifactIdentity: 'not_applicable', executionStatus: 'not_applicable', rollbackStatus: 'not_applicable', unknownPreserved: false },
    { schema: 't5.public-work-reality.v1', activity: '작업 중', input: '현재 작업에 반영할 내용을 받았어요.', consumed: false }],
  ['UX-A1-terra', 'api_key:openai:gpt-5.6-terra',
    { queuedInputStatus: 'not_applicable', artifactIdentity: 'unchanged_existing', executionStatus: 'succeeded', rollbackStatus: 'not_applicable', unknownPreserved: true },
    { schema: 't5.human-artifact-receipt.v1', title: '기존 파일 그대로 준비했어요.', exactReadback: true,
      userWorkspaceCopiesCreated: 0, openability: 'unmeasured', temporaryCleanup: 'unknown' }],
  ['UX-E1-gpt55', 'chatgpt_oauth:gpt-5.5',
    { queuedInputStatus: 'not_applicable', artifactIdentity: 'not_applicable', executionStatus: 'failed', rollbackStatus: 'not_executed', unknownPreserved: true },
    { schema: 't5.human-effect-forensic-receipt.v1', execution: 'failed', observedChanges: 1,
      acl: 'unmeasured', flags: 'unmeasured', undeclaredCause: 'unknown', rollback: 'not_executed' }],
].map(([id, connection, expected, projection]) => ({ id, connection, expected, projection }));

function auditedFetch({ endpoint, model, credentialCanaries, observations }) {
  return async (url, options = {}) => {
    if (String(url) !== endpoint || options.method !== 'POST') throw new Error('provider_request_boundary');
    const text = String(options.body ?? '');
    if (credentialCanaries.some((value) => value && text.includes(value))) throw new Error('request_privacy_boundary');
    const body = JSON.parse(text); const tools = body.tools ?? [];
    const expectedTool = { type: 'function', strict: true, name: tool.name,
      description: tool.description, parameters: tool.parameters };
    if (body.store !== false || body.model !== model || body.tool_choice !== 'required'
      || !options.headers?.authorization || tools.length !== 1 || tools[0]?.name !== tool.name
      || tools[0]?.strict !== true || hash(tools[0]) !== hash(expectedTool)) {
      throw new Error('provider_request_boundary');
    }
    observations.push({ requestDigest: hash(text), requestBytes: Buffer.byteLength(text), storeFalse: true,
      modelMatched: true, strictTool: true, authHeaderPresent: true, forbiddenHits: [] });
    return fetch(url, options);
  };
}

function readOnlyModel(credential, fetchImpl) {
  if (credential.kind === 'api_key') return makeOpenAIResponsesModel({ apiKey: credential.secret.key,
    model: credential.modelId, endpoint: OPENAI_ENDPOINT, fetchImpl, reasoningEffort: 'medium', instructions: INSTRUCTIONS });
  const fixed = credential.secret;
  return makeChatGptResponsesModel({ model: credential.modelId, endpoint: CHATGPT_ENDPOINT,
    fetchImpl, maxAttempts: 1, instructions: INSTRUCTIONS, credentials: { async get() { return {
      access: fixed.access, accountId: fixed.accountId, expiresAt: fixed.expiresAt, modelId: credential.modelId }; } } });
}

async function main() {
  if (!process.argv.includes('--human-controlled')) throw new Error('human_control_required');
  if (process.env.T5_PROMPT_DUMP || process.env.T5_REFOUNDATION_PROMPT_DUMP) throw new Error('prompt_dump_must_be_disabled');
  const connectionFile = process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
    ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json');
  const state = JSON.parse(await readFile(connectionFile, 'utf8'));
  const secretStore = makePlatformSecretStore({ platform: process.platform }); const credentials = new Map();
  for (const id of [...new Set(journeys.map((item) => item.connection))]) {
    const connection = state.connections?.find((item) => item.id === id);
    if (!connection) throw new Error('connection_boundary');
    credentials.set(id, await loadReadOnlyConnectionCredential({ connection, secretStore }));
  }
  const results = [];
  for (const journey of journeys) {
    const credential = credentials.get(journey.connection); const observations = [];
    const canaries = [credential.secret.key, credential.secret.access, credential.secret.accountId,
      state.connections?.find((item) => item.id === journey.connection)?.secretRef]
      .filter((value) => typeof value === 'string' && value);
    const observer = makeInMemoryProviderObserver(); const endpoint = credential.kind === 'api_key' ? OPENAI_ENDPOINT : CHATGPT_ENDPOINT;
    try {
      const model = readOnlyModel(credential, auditedFetch({ endpoint,
        model: credential.modelId, credentialCanaries: canaries, observations }));
      const started = performance.now(); const response = await model.respond({
        messages: [{ role: 'user', content: `다음 canonical UX projection만 근거로 한국어 사용자 문장을 쓰고 도구를 한 번 호출하세요.\n${JSON.stringify(journey.projection)}` }],
        tools: [tool], toolChoice: { requiredToolName: tool.name }, resourceObserver: observer });
      const calls = response.toolCalls ?? []; const args = calls.length === 1 && calls[0].name === tool.name ? calls[0].args : null;
      const outputText = JSON.stringify({ args, prose: response.text ?? '' });
      const privacyPassed = safeOutput(outputText, canaries);
      const exactSchema = Boolean(args) && JSON.stringify(Object.keys(args).sort()) === JSON.stringify(ARG_KEYS)
        && typeof args.message === 'string' && args.message.trim().length > 0 && args.message.length <= 600
        && typeof args.unknownPreserved === 'boolean';
      const claimsPassed = exactSchema && Object.entries(journey.expected).every(([key, value]) => args[key] === value);
      const usage = normalizeProviderUsage(response.usage); const attempt = observer.attempts;
      results.push({ journeyId: journey.id, model: credential.modelId, wallMs: Math.round(performance.now() - started),
        responseModel: response.responseModel ?? null, modelIdentityMatched: response.responseModel === credential.modelId,
        providerAttempts: attempt.length, usage, costObservationPassed: usage.complete && attempt.length === 1
          && attempt[0].state === 'committed', requestBoundaryPassed: observations.length === 1,
        outputPrivacyPassed: privacyPassed, claimsPassed, proseOutsideTool: Boolean(String(response.text ?? '').trim()),
        messageForHumanReview: privacyPassed ? String(args?.message ?? '').slice(0, 600) : null,
        messageDigest: privacyPassed ? hash(String(args?.message ?? '')) : null,
        machinePassed: claimsPassed && privacyPassed && observations.length === 1 && usage.complete
          && attempt.length === 1 && attempt[0].state === 'committed' && response.responseModel === credential.modelId
          && !String(response.text ?? '').trim() });
    } catch (error) {
      results.push({ journeyId: journey.id, model: credential.modelId, machinePassed: false,
        failure: String(error?.message ?? '').includes('credential') ? 'credential_boundary'
          : String(error?.message ?? '').includes('privacy') ? 'privacy_boundary' : 'provider_or_model_boundary',
        providerAttempts: observer.attempts.length, usage: normalizeProviderUsage(null), messageForHumanReview: null });
    }
  }
  const result = { schema: 't5.s3ux.model-language-shadow.v1', recordedAt: new Date().toISOString(),
    humanControlled: true, scope: 'four_nonfactorial_model_language_shadow_lanes', expectedProviderCalls: 4,
    actualProviderAttempts: results.reduce((sum, item) => sum + item.providerAttempts, 0), results,
    externalWrites: 0, productWrites: 0, credentialStoreWrites: 0, oauthRefreshAllowed: false,
    deterministicProductQualificationSeparate: true, providerRetentionNotClaimed: true,
    humanLanguageReviewPassed: null,
    machineQualificationPassed: results.length === 4 && results.every((item) => item.machinePassed)
      && results.reduce((sum, item) => sum + item.providerAttempts, 0) === 4,
    pass: false, status: 'HUMAN_LANGUAGE_REVIEW_REQUIRED',
    notClaimed: ['physical Windows UI qualification', 'same-Work resume from CH0', 'product behavior from synthetic prompts'] };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.machineQualificationPassed) process.exitCode = 1;
}

export function fixedFailure(error) {
  const value = String(error?.message ?? '');
  if (/human_control|prompt_dump/u.test(value)) return 'human_control_boundary';
  if (/connection|credential|secret|OAuth/u.test(value)) return 'credential_boundary';
  return 'qualification_runtime_boundary';
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ schema: 't5.s3ux.model-language-shadow.v1',
    machineQualificationPassed: false, pass: false, failure: fixedFailure(error) })}\n`); process.exitCode = 1;
});
