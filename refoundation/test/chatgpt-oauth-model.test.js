import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  makeStoredChatGptCredentialSource, makeStoredModelCredentialCatalog,
} from '../src/chatgpt-oauth-credential.js';
import { makeChatGptResponsesModel } from '../src/chatgpt-responses-model.js';

const ACCESS = 'oauth-access-must-stay-secret';
const REFRESH = 'oauth-refresh-must-stay-secret';
const execDefinition = {
  name: 'exec', description: 'Run a shell command.',
  parameters: {
    type: 'object',
    properties: { command: { type: 'string' }, cwd: { type: ['string', 'null'] } },
    required: ['command', 'cwd'], additionalProperties: false,
  },
};

function savedConnection(credential, modelId = 'gpt-account-model') {
  return {
    version: 2,
    activeId: `chatgpt_oauth:${modelId}`,
    roleBindings: {},
    connections: [{
      id: `chatgpt_oauth:${modelId}`, kind: 'chatgpt_oauth', provider: 'chatgpt_oauth',
      modelId, credential,
    }],
  };
}

function sseResponse(lines, status = 200) {
  return new Response(`${lines.map((line) => `data: ${JSON.stringify(line)}\n\n`).join('')}data: [DONE]\n\n`, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

test('OAuth credential source는 활성 연결을 읽되 공개 상태에 토큰을 내지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-oauth-source-'));
  const file = join(dir, 'model-connection.json');
  await writeFile(file, JSON.stringify(savedConnection({
    access: ACCESS, refresh: REFRESH, expiresAt: Date.now() + 600_000, accountId: 'acct-1',
  })), { mode: 0o600 });
  try {
    const source = makeStoredChatGptCredentialSource({ file });
    const status = await source.inspect();
    assert.deepEqual(status, {
      available: true, provider: 'chatgpt_oauth', modelId: 'gpt-account-model', accountIdPresent: true,
    });
    assert.doesNotMatch(JSON.stringify(status), /oauth-access|oauth-refresh/);
    const credential = await source.get();
    assert.equal(credential.access, ACCESS);
    assert.equal(credential.modelId, 'gpt-account-model');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('콘솔 credential catalog는 API 키와 OAuth를 함께 보이되 목록에는 비밀을 내지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-model-catalog-'));
  const file = join(dir, 'model-connection.json');
  const state = savedConnection({
    access: ACCESS, refresh: REFRESH, expiresAt: Date.now() + 600_000, accountId: 'acct-1',
  });
  state.connections.push({
    id: 'openai:gpt-api-model', kind: 'api_key', provider: 'openai', modelId: 'gpt-api-model',
    baseUrl: 'https://api.openai.com/v1', key: 'sk-api-secret',
  });
  await writeFile(file, JSON.stringify(state), { mode: 0o600 });
  try {
    const catalog = makeStoredModelCredentialCatalog({ file });
    const list = await catalog.list();
    assert.equal(list.length, 2);
    assert.doesNotMatch(JSON.stringify(list), /oauth-access|oauth-refresh|sk-api-secret/);
    const oauth = await catalog.select();
    assert.equal(oauth.kind, 'chatgpt_oauth');
    const api = await catalog.select('openai:gpt-api-model');
    assert.equal(api.kind, 'api_key');
    assert.equal(api.apiKey, 'sk-api-secret');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('만료된 OAuth 자격은 refresh하고 같은 0600 저장 파일에 원자적으로 갱신한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-oauth-refresh-'));
  const file = join(dir, 'model-connection.json');
  await writeFile(file, JSON.stringify(savedConnection({
    access: 'expired', refresh: REFRESH, expiresAt: 0, accountId: 'acct-1',
  })), { mode: 0o600 });
  await chmod(file, 0o644);
  const calls = [];
  try {
    const source = makeStoredChatGptCredentialSource({
      file,
      now: () => 1_000_000,
      fetchImpl: async (url, init) => {
        calls.push({ url, body: String(init.body) });
        return new Response(JSON.stringify({ access_token: 'renewed', expires_in: 3600 }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      },
    });
    const credential = await source.get();
    assert.equal(credential.access, 'renewed');
    assert.equal(credential.refresh, REFRESH);
    assert.equal(credential.accountId, 'acct-1');
    assert.match(calls[0].body, /grant_type=refresh_token/);
    assert.match(calls[0].body, /oauth-refresh-must-stay-secret/);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(saved.connections[0].credential.access, 'renewed');
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ChatGPT OAuth adapter는 SSE function call과 결과를 같은 call_id로 이어 최종 답을 받는다', async () => {
  const requests = [];
  let turn = 0;
  const credentials = {
    async get() {
      return {
        access: ACCESS, accountId: 'acct-7', modelId: 'gpt-account-model',
        expiresAt: Date.now() + 600_000,
      };
    },
  };
  const fetchImpl = async (_url, init) => {
    requests.push({ headers: init.headers, body: JSON.parse(init.body) });
    turn += 1;
    if (turn === 1) {
      return sseResponse([
        {
          type: 'response.output_item.done',
          item: {
            type: 'function_call', call_id: 'oauth-call-1', name: 'exec',
            arguments: JSON.stringify({ command: "printf '42'", cwd: null }),
          },
        },
        {
          type: 'response.completed',
          response: {
            id: 'oauth-response-1', model: 'gpt-account-model',
            // 실제 ChatGPT backend는 output_item.done에 호출을 주고 completed.output은 비울 수 있다.
            output: [],
          },
        },
      ]);
    }
    return sseResponse([
      { type: 'response.output_text.delta', delta: '합계는 ' },
      { type: 'response.output_text.delta', delta: '42입니다.' },
      {
        type: 'response.completed',
        response: {
          id: 'oauth-response-2', model: 'gpt-account-model-newer',
          output: [{
            type: 'message', role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text: '합계는 42입니다.' }],
          }],
        },
      },
    ]);
  };

  const model = makeChatGptResponsesModel({ credentials, fetchImpl });
  const first = await model.respond({
    messages: [{ role: 'user', content: '합계를 구해줘' }], tools: [execDefinition],
  });
  assert.deepEqual(first.toolCalls, [{
    id: 'oauth-call-1', name: 'exec', args: { command: "printf '42'", cwd: null },
  }]);
  assert.equal(first.responseModel, 'gpt-account-model');

  const observation = JSON.stringify({ outcome: 'succeeded', result: { exitCode: 0, stdout: '42' } });
  const second = await model.respond({
    messages: [
      { role: 'user', content: '합계를 구해줘' },
      { role: 'assistant', content: '', toolCalls: first.toolCalls },
      { role: 'tool', toolCallId: 'oauth-call-1', name: 'exec', content: observation },
    ],
    tools: [execDefinition],
  });
  assert.equal(second.text, '합계는 42입니다.');
  assert.equal(second.responseModel, 'gpt-account-model-newer');
  assert.equal(requests[0].headers.authorization, `Bearer ${ACCESS}`);
  assert.equal(requests[0].headers['chatgpt-account-id'], 'acct-7');
  assert.equal(requests[0].body.stream, true);
  assert.equal(requests[0].body.store, false);
  assert.deepEqual(requests[1].body.input.at(-1), {
    type: 'function_call_output', call_id: 'oauth-call-1', output: observation,
  });
  assert.ok(requests.every((request) => !JSON.stringify(request.body).includes(ACCESS)));
});
