import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runAgent } from '../src/agent-loop.js';
import { makeStoredModelCredentialCatalog } from '../src/chatgpt-oauth-credential.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeExecTool } from '../src/exec-tool.js';
import { makeGitHubCliRegistration } from '../src/github-cli-broker.js';
import { makeModelContinuity, modelContinuityFailure } from '../src/model-continuity.js';
import { makeTerminalCredentialBroker } from '../src/terminal-credential-broker.js';

const manifest = (provider, values = {}) => ({ schema: 't5.model-capabilities.v1', provider,
  modelId: `${provider}-model`, wire: `${provider}-wire`, capabilities: {
    text: 'supported', tools: 'supported', visionInput: 'supported', ...values,
  } });

test('transport 장애 뒤 canonical ToolReceipt로 전환하고 이미 성공한 Tool은 재실행하지 않는다', async () => {
  let primaryCalls = 0; let fallbackCalls = 0; let toolExecutions = 0; const events = [];
  const model = makeModelContinuity({ connections: [{
    id: 'primary', provider: 'openai', modelId: 'gpt-primary', capabilityManifest: manifest('openai'),
    async create() { return { async respond() {
      primaryCalls += 1;
      if (primaryCalls === 1) return { text: '', toolCalls: [{ id: 'first', name: 'observe_once', args: { value: 7 } }] };
      throw Object.assign(new Error('OpenAI request failed: network offline'), { code: 'network_error' });
    } }; },
  }, {
    id: 'fallback', provider: 'anthropic', modelId: 'claude-fallback', capabilityManifest: manifest('anthropic'),
    async create() { return { async respond({ messages }) {
      fallbackCalls += 1;
      if (fallbackCalls === 1) return { text: '', toolCalls: [{ id: 'duplicate', name: 'observe_once', args: { value: 7 } }] };
      const last = JSON.parse(messages.at(-1).content);
      assert.equal(last.result.reason, 'already_executed_before_model_fallback');
      return { text: '기존 결과를 이어서 마쳤어요.', toolCalls: [] };
    } }; },
  }] });
  const result = await runAgent({ request: '계속해', model, tools: [{
    name: 'observe_once', description: 'Observe one exact value.',
    parameters: { type: 'object', additionalProperties: false, properties: { value: { type: 'number' } }, required: ['value'] },
    async execute() { toolExecutions += 1; return { value: 7 }; },
  }], onEvent: async (event) => events.push(event) });
  assert.equal(result.answer, '기존 결과를 이어서 마쳤어요.');
  assert.equal(toolExecutions, 1);
  assert.equal(result.receipts.filter((receipt) => receipt.actualCall).length, 1);
  assert.equal(result.receipts.at(-1).outcome, 'not_executed');
  const transition = events.find((event) => event.type === 'model_continuity');
  assert.equal(transition.receipt.reason, 'transport_failure');
  assert.equal(transition.receipt.providerRawTranscriptUsed, false);
  assert.equal(transition.receipt.priorToolEffectsReexecutionAuthorized, false);
});

test('한 번의 실제 모델 전환은 후속 fallback 응답마다 새 transition Receipt로 반복되지 않는다', async () => {
  let primaryCalls = 0; let fallbackCalls = 0;
  const model = makeModelContinuity({ connections: [{
    id: 'primary', provider: 'openai', modelId: 'gpt-primary', capabilityManifest: manifest('openai'),
    create: async () => ({ async respond() { primaryCalls += 1;
      throw Object.assign(new Error('network offline'), { code: 'network_error' }); } }),
  }, {
    id: 'fallback', provider: 'anthropic', modelId: 'claude-fallback', capabilityManifest: manifest('anthropic'),
    create: async () => ({ async respond() { fallbackCalls += 1;
      return { text: `fallback-${fallbackCalls}`, toolCalls: [] }; } }),
  }] });
  const first = await model.respond({ messages: [], tools: [] });
  const second = await model.respond({ messages: [], tools: [] });
  assert.equal(first.continuityReceipts.length, 1);
  assert.equal(first.continuityReceipt.reason, 'transport_failure');
  assert.equal(first.continuityGuardActive, true);
  assert.equal(second.continuityReceipt, undefined);
  assert.deepEqual(second.continuityReceipts, undefined);
  assert.equal(second.continuityGuardActive, true);
  assert.equal(primaryCalls, 1); assert.equal(fallbackCalls, 2);
});

test('필수 이미지 능력이 없는 주 모델은 호출하지 않고 허용된 다음 모델로 admission한다', async () => {
  let primaryCalls = 0; let fallbackCalls = 0;
  const model = makeModelContinuity({ connections: [{
    id: 'primary', provider: 'upstage', modelId: 'text-only',
    capabilityManifest: manifest('upstage', { visionInput: 'unsupported' }),
    create: async () => ({ async respond() { primaryCalls += 1; return { text: 'wrong', toolCalls: [] }; } }),
  }, {
    id: 'fallback', provider: 'openai', modelId: 'vision', capabilityManifest: manifest('openai'),
    create: async () => ({ async respond() { fallbackCalls += 1; return { text: 'image handled', toolCalls: [] }; } }),
  }] });
  const response = await model.respond({ messages: [{ role: 'user', content: '이미지', modelAttachments: [{
    type: 'input_image', image_url: 'data:image/png;base64,AA==', detail: 'auto',
  }] }], tools: [] });
  assert.equal(response.text, 'image handled'); assert.equal(primaryCalls, 0); assert.equal(fallbackCalls, 1);
  assert.equal(response.continuityReceipt.reason, 'required_capability_absent');
});

test('품질·형식 오류와 사용자 취소는 자동 provider 순회 사유가 아니다', () => {
  assert.equal(modelContinuityFailure(new Error('invalid function arguments for tool')), null);
  assert.equal(modelContinuityFailure(Object.assign(new Error('cancelled'), { name: 'AbortError' })), null);
  assert.equal(modelContinuityFailure(Object.assign(new Error('bad request'), { status: 400 })), null);
  assert.equal(modelContinuityFailure(Object.assign(new Error('unauthorized'), { status: 401 })), 'credential_failure');
  assert.equal(modelContinuityFailure(Object.assign(new Error('unavailable'), { status: 503 })), 'provider_health_failure');
});

test('저장된 사용자 정책만 실제 Console model factory의 provider fallback을 연다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-alpha5-factory-'));
  const file = join(room, 'model.json');
  const state = { version: 2, activeId: 'openai-primary', roleBindings: {}, connections: [
    { id: 'openai-primary', kind: 'api_key', provider: 'openai', modelId: 'gpt-5.6-terra', key: 'OPENAI-SECRET' },
    { id: 'claude-fallback', kind: 'api_key', provider: 'anthropic', modelId: 'claude-sonnet-5', key: 'CLAUDE-SECRET' },
  ] };
  await writeFile(file, JSON.stringify(state), { mode: 0o600 });
  const catalog = makeStoredModelCredentialCatalog({ file });
  await catalog.setContinuityPolicy({ enabled: true,
    allowedConnectionIds: ['openai-primary', 'claude-fallback'] });
  const calls = [];
  const access = makeConsoleModelAccess({ connectionFile: file, stateDir: room,
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes('openai.com')) throw new Error('network offline');
      return new Response(JSON.stringify({ id: 'msg-1', model: 'claude-sonnet-5',
        content: [{ type: 'text', text: 'fallback answer' }], usage: { input_tokens: 1, output_tokens: 1 } }),
      { status: 200, headers: { 'content-type': 'application/json' } });
    } });
  try {
    const model = await access.model({ sessionId: 'session', workspace: room,
      computer: { platform: 'darwin', architecture: 'arm64', commandFamily: 'posix', commandProgram: '/bin/sh' },
      instructionsOverride: 'T5 fixture' });
    const response = await model.respond({ messages: [{ role: 'user', content: 'continue' }], tools: [] });
    assert.equal(response.text, 'fallback answer');
    assert.equal(response.continuityReceipt.from.provider, 'openai');
    assert.equal(response.continuityReceipt.to.provider, 'anthropic');
    assert.equal(calls.length, 2);
    assert.doesNotMatch(JSON.stringify(response), /OPENAI-SECRET|CLAUDE-SECRET/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('기존 인증 CLI 실행 뒤 모델 transport가 죽어도 CLI와 효과를 반복하지 않고 같은 Work를 끝낸다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-alpha5-cli-')); const bin = join(room, 'bin');
  await mkdir(bin); const gh = join(bin, 'gh');
  await writeFile(gh, '#!/bin/sh\nprintf "OPEN-PR-3"\n', { mode: 0o700 }); await chmod(gh, 0o700);
  let primaryCalls = 0; let fallbackCalls = 0;
  const model = makeModelContinuity({ connections: [{ id: 'primary', provider: 'openai', modelId: 'gpt',
    capabilityManifest: manifest('openai'), create: async () => ({ async respond() {
      primaryCalls += 1;
      if (primaryCalls === 1) return { text: '', toolCalls: [{ id: 'gh-read', name: 'exec', args: {
        command: 'gh pr list', cwd: null,
        effect: { kind: 'observe', targets: [], confirmation: 'not_applicable', rollbackOfToolCallId: null },
      } }] };
      throw Object.assign(new Error('transport disconnected'), { code: 'network_error' });
    } }) }, { id: 'fallback', provider: 'anthropic', modelId: 'claude', capabilityManifest: manifest('anthropic'),
    create: async () => ({ async respond({ messages }) { fallbackCalls += 1;
      const prior = messages.findLast((message) => message.role === 'tool');
      assert.equal(JSON.parse(prior.content).result.credentialBroker.capabilityId, 'github-cli-read');
      return { text: '기존 GitHub 조회 결과로 작업을 마쳤어요.', toolCalls: [] }; } }) }] });
  const broker = makeTerminalCredentialBroker({ generalTerminalIsolationQualified: true,
    registrations: [makeGitHubCliRegistration(gh, { execute: async (_program, args) => args[0] === 'api'
      ? { code: 0, stdout: '{"id":7,"login":"owner"}', stderr: '' }
      : { code: 0, stdout: '{"hosts":{"github.com":[{"login":"owner","active":true,"scopes":"repo"}]}}', stderr: '' } })] });
  try {
    const result = await runAgent({ request: 'PR을 확인하고 계속해', model,
      tools: [makeExecTool({ workspace: room, pathPrepend: bin, terminalCredentialBroker: broker })] });
    assert.equal(result.answer, '기존 GitHub 조회 결과로 작업을 마쳤어요.');
    assert.equal(result.receipts.length, 1); assert.equal(result.receipts[0].actualCall.name, 'exec');
    assert.equal(fallbackCalls, 1);
  } finally { await rm(room, { recursive: true, force: true }); }
});
