import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  makeStoredChatGptCredentialSource, makeStoredModelCredentialCatalog,
  migrateStoredModelCredentials,
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

function secretStore() {
  const values = new Map();
  return {
    values,
    async get(name) { return structuredClone(values.get(name) ?? null); },
    async set(name, value) { values.set(name, structuredClone(value)); },
    async clear(name) { values.delete(name); },
  };
}

test('기존 모델 API key와 OAuth token은 Keychain 검증 뒤 파일에서 제거된다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-model-secret-migration-'));
  const file = join(dir, 'model-connection.json'); const secrets = secretStore();
  const state = savedConnection({
    access: ACCESS, refresh: REFRESH, expiresAt: Date.now() + 600_000, accountId: 'acct-1',
  });
  state.connections.push({ id: 'api_key:openai:gpt-5.6-terra', kind: 'api_key',
    provider: 'openai', modelId: 'gpt-5.6-terra', key: 'sk-file-secret' });
  await writeFile(file, JSON.stringify(state), { mode: 0o600 });
  try {
    assert.deepEqual(await migrateStoredModelCredentials({ file, secretStore: secrets }), { migrated: 2 });
    const raw = await readFile(file, 'utf8');
    assert.doesNotMatch(raw, /oauth-access-must-stay-secret|oauth-refresh-must-stay-secret|sk-file-secret/u);
    const stored = JSON.parse(raw);
    assert.ok(stored.connections.every((connection) => connection.secretRef));
    const catalog = makeStoredModelCredentialCatalog({ file, secretStore: secrets });
    assert.equal((await catalog.select('api_key:openai:gpt-5.6-terra')).apiKey, 'sk-file-secret');
    assert.equal((await makeStoredChatGptCredentialSource({ file, secretStore: secrets }).get()).access, ACCESS);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Keychain 검증 실패는 기존 평문 자격 파일을 먼저 지우지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-model-secret-migration-failure-'));
  const file = join(dir, 'model-connection.json');
  await writeFile(file, JSON.stringify(savedConnection({
    access: ACCESS, refresh: REFRESH, expiresAt: Date.now() + 600_000,
  })), { mode: 0o600 });
  const broken = { async set() {}, async get() { return { credential: { access: 'wrong' } }; },
    async clear() {} };
  try {
    await assert.rejects(migrateStoredModelCredentials({ file, secretStore: broken }),
      /verification failed/u);
    assert.match(await readFile(file, 'utf8'), /oauth-access-must-stay-secret/u);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

function sseResponse(lines, status = 200) {
  return new Response(`${lines.map((line) => `data: ${JSON.stringify(line)}\n\n`).join('')}data: [DONE]\n\n`, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

test('ChatGPT OAuth adapter는 현재 사용자 이미지 첨부를 input_image로 보낸다', async () => {
  const requests = [];
  const model = makeChatGptResponsesModel({
    credentials: { async get() { return { access: ACCESS, modelId: 'gpt-account-model' }; } },
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return sseResponse([{ type: 'response.completed', response: {
        id: 'image-oauth', model: 'gpt-account-model',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '보입니다.' }] }],
      } }]);
    },
  });
  await model.respond({
    messages: [{
      role: 'user', content: '무엇이 보여?',
      modelAttachments: [{ type: 'input_image', detail: 'low', image_url: 'data:image/jpeg;base64,aW1hZ2U=' }],
    }],
    tools: [],
  });
  assert.deepEqual(requests[0].input, [{
    type: 'message', role: 'user',
    content: [
      { type: 'input_text', text: '무엇이 보여?' },
      { type: 'input_image', detail: 'low', image_url: 'data:image/jpeg;base64,aW1hZ2U=' },
    ],
  }]);
});

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

test('모델 연결 제거는 metadata commit 실패 시 OAuth·API secret을 건드리지 않는다', async () => {
  for (const kind of ['chatgpt_oauth', 'api_key']) {
    const dir = await mkdtemp(join(tmpdir(), `t5-model-remove-commit-fault-${kind}-`));
    const file = join(dir, 'model-connection.json'); const secrets = secretStore();
    const id = kind === 'chatgpt_oauth' ? 'chatgpt_oauth:gpt-5.5' : 'api_key:openai:gpt-5.6-terra';
    const secretRef = kind === 'chatgpt_oauth' ? 'model-credential-oauth-fault' : 'model-credential-api-fault';
    const secret = kind === 'chatgpt_oauth'
      ? { credential: { access: ACCESS, refresh: REFRESH, expiresAt: Date.now() + 600_000 } }
      : { key: 'sk-remove-fault-secret' };
    const state = { version: 2, activeId: id, roleBindings: {}, connections: [{
      id, kind, provider: kind === 'chatgpt_oauth' ? 'chatgpt_oauth' : 'openai',
      modelId: kind === 'chatgpt_oauth' ? 'gpt-5.5' : 'gpt-5.6-terra', secretRef,
    }] };
    await writeFile(file, JSON.stringify(state), { mode: 0o600 });
    await secrets.set(secretRef, secret);
    let clearCalls = 0; const originalClear = secrets.clear.bind(secrets);
    secrets.clear = async (name) => { clearCalls += 1; return originalClear(name); };
    try {
      const catalog = makeStoredModelCredentialCatalog({
        file, secretStore: secrets,
        saveState: async () => { throw new Error('injected metadata commit failure'); },
      });
      await assert.rejects(catalog.remove(id), /metadata commit failure/u);
      assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), state);
      assert.deepEqual(await secrets.get(secretRef), secret);
      assert.equal(clearCalls, 0);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
});

test('모델 연결 제거 성공은 metadata atomic commit 뒤 exact secret을 정리한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-model-remove-order-'));
  const file = join(dir, 'model-connection.json'); const secrets = secretStore();
  const removedId = 'chatgpt_oauth:gpt-5.5'; const retainedId = 'api_key:openai:gpt-5.6-terra';
  const removedRef = 'model-credential-remove-order'; const retainedRef = 'model-credential-retained';
  const state = { version: 2, activeId: removedId, roleBindings: {}, connections: [
    { id: removedId, kind: 'chatgpt_oauth', provider: 'chatgpt_oauth', modelId: 'gpt-5.5', secretRef: removedRef },
    { id: retainedId, kind: 'api_key', provider: 'openai', modelId: 'gpt-5.6-terra', secretRef: retainedRef },
  ] };
  await writeFile(file, JSON.stringify(state), { mode: 0o600 });
  await secrets.set(removedRef, { credential: { access: ACCESS } });
  await secrets.set(retainedRef, { key: 'sk-retained' });
  const events = []; const originalClear = secrets.clear.bind(secrets);
  secrets.clear = async (name) => {
    const committed = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(committed.connections.some((connection) => connection.id === removedId), false);
    events.push('metadata'); events.push(`secret:${name}`); return originalClear(name);
  };
  try {
    const catalog = makeStoredModelCredentialCatalog({ file, secretStore: secrets });
    assert.deepEqual(await catalog.remove(removedId), { removed: true, activeId: retainedId });
    assert.deepEqual(events, ['metadata', `secret:${removedRef}`]);
    const persisted = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(persisted.connections.map((connection) => connection.id), [retainedId]);
    assert.equal(persisted.activeId, retainedId);
    assert.equal(await secrets.get(removedRef), null);
    assert.deepEqual(await secrets.get(retainedRef), { key: 'sk-retained' });
  } finally { await rm(dir, { recursive: true, force: true }); }
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

test('ChatGPT OAuth adapter는 response.failed를 빈 정상 답으로 바꾸지 않는다', async () => {
  const credentials = { async get() { return {
    access: ACCESS, accountId: 'acct-7', modelId: 'gpt-account-model', expiresAt: Date.now() + 600_000,
  }; } };
  const model = makeChatGptResponsesModel({
    credentials,
    maxAttempts: 1,
    fetchImpl: async () => sseResponse([
      {
        type: 'error',
        error: { type: 'service_unavailable_error', code: 'server_is_overloaded', message: 'overloaded' },
      },
      {
        type: 'response.failed',
        response: { status: 'failed', error: { code: 'server_is_overloaded', message: 'overloaded' }, output: [] },
      },
    ]),
  });
  await assert.rejects(
    () => model.respond({ messages: [{ role: 'user', content: 'work' }], tools: [execDefinition] }),
    (error) => error.code === 'server_is_overloaded' && error.retriable === true,
  );
});

test('ChatGPT OAuth adapter는 transient provider 실패만 제한적으로 재시도한다', async () => {
  const credentials = { async get() { return {
    access: ACCESS, accountId: 'acct-7', modelId: 'gpt-account-model', expiresAt: Date.now() + 600_000,
  }; } };
  let calls = 0;
  const waits = [];
  const model = makeChatGptResponsesModel({
    credentials,
    maxAttempts: 3,
    retryDelayMs: 10,
    wait: async (ms) => { waits.push(ms); },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return sseResponse([{
        type: 'response.failed',
        response: { status: 'failed', error: { code: 'server_error', message: 'try again' }, output: [] },
      }]);
      return sseResponse([
        { type: 'response.output_text.delta', delta: '복구됐습니다.' },
        {
          type: 'response.completed',
          response: {
            id: 'recovered', model: 'gpt-account-model',
            output: [{
              type: 'message', role: 'assistant', status: 'completed',
              content: [{ type: 'output_text', text: '복구됐습니다.' }],
            }],
          },
        },
      ]);
    },
  });
  const result = await model.respond({ messages: [{ role: 'user', content: 'work' }], tools: [] });
  assert.equal(result.text, '복구됐습니다.');
  assert.equal(calls, 2);
  assert.deepEqual(waits, [10]);
});

test('계정 backend가 내부 prompt_cache_retention 힌트를 간헐적으로 거부할 때만 같은 body를 bounded 재시도한다', async () => {
  const credentials = { async get() { return {
    access: ACCESS, accountId: 'acct-7', modelId: 'gpt-account-model', expiresAt: Date.now() + 600_000,
  }; } };
  const bodies = [];
  let calls = 0;
  const model = makeChatGptResponsesModel({
    credentials, maxAttempts: 2, wait: async () => {},
    fetchImpl: async (_url, init) => {
      calls += 1;
      bodies.push(JSON.parse(init.body));
      if (calls === 1) return new Response(JSON.stringify({
        error: {
          message: 'prompt_cache_retention is not supported on this model',
          type: 'invalid_request_error', param: 'prompt_cache_retention', code: 'invalid_parameter',
        },
      }), { status: 400, headers: { 'content-type': 'application/json' } });
      return sseResponse([
        { type: 'response.output_text.delta', delta: '이어갑니다.' },
        { type: 'response.completed', response: {
          id: 'cache-recovered', model: 'gpt-account-model',
          output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '이어갑니다.' }] }],
        } },
      ]);
    },
  });
  const result = await model.respond({ messages: [{ role: 'user', content: '계속해' }], tools: [] });
  assert.equal(result.text, '이어갑니다.');
  assert.equal(calls, 2);
  assert.deepEqual(bodies[1], bodies[0]);
  assert.equal(Object.hasOwn(bodies[0], 'prompt_cache_retention'), false);
});

test('다른 HTTP 400은 cache 힌트 오류로 넓혀 재시도하지 않는다', async () => {
  const credentials = { async get() { return {
    access: ACCESS, accountId: 'acct-7', modelId: 'gpt-account-model', expiresAt: Date.now() + 600_000,
  }; } };
  let calls = 0;
  const model = makeChatGptResponsesModel({
    credentials, maxAttempts: 3, wait: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return new Response('{"error":{"message":"ordinary invalid request"}}', { status: 400 });
    },
  });
  await assert.rejects(
    () => model.respond({ messages: [{ role: 'user', content: 'work' }], tools: [] }),
    (error) => error.code === 'http_400' && error.retriable === false,
  );
  assert.equal(calls, 1);
});

test('새 OAuth adapter는 이전 Run의 function call과 output을 첫 요청에 재생한다', async () => {
  const requests = [];
  const observedContexts = [];
  const credentials = { async get() { return {
    access: ACCESS, accountId: 'acct-7', modelId: 'gpt-account-model', expiresAt: Date.now() + 600_000,
  }; } };
  const model = makeChatGptResponsesModel({
    credentials,
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return sseResponse([{
        type: 'response.completed',
        response: {
          id: 'continued', model: 'gpt-account-model',
          output: [{
            type: 'message', role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text: '이전 값은 value-7391입니다.' }],
          }],
        },
      }]);
    },
  });
  const response = await model.respond({
    messages: [
      { role: 'user', content: '파일 값을 확인해줘' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'old-call', name: 'exec', args: { command: 'read-value', cwd: null } }] },
      { role: 'tool', toolCallId: 'old-call', name: 'exec', content: '{"stdout":"value-7391"}' },
      { role: 'assistant', content: '확인했습니다.' },
      { role: 'user', content: '아까 값만 알려줘' },
    ],
    tools: [execDefinition],
    onContextReceipt: async (receipt) => observedContexts.push(receipt),
  });
  assert.deepEqual(requests[0].input, [
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: '파일 값을 확인해줘' }] },
    { type: 'function_call', call_id: 'old-call', name: 'exec', arguments: '{"command":"read-value","cwd":null}' },
    { type: 'function_call_output', call_id: 'old-call', output: '{"stdout":"value-7391"}' },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '확인했습니다.' }] },
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: '아까 값만 알려줘' }] },
  ]);
  assert.equal(response.contextReceipt.provider, 'chatgpt_oauth');
  assert.equal(response.contextReceipt.requestBytes, Buffer.byteLength(JSON.stringify(requests[0])));
  assert.equal(response.contextReceipt.input.byKind.function_call.items, 1);
  assert.equal(response.contextReceipt.input.byKind.function_call_output.items, 1);
  assert.doesNotMatch(JSON.stringify(response.contextReceipt), /value-7391|파일 값을/);
  assert.deepEqual(observedContexts, [response.contextReceipt]);
});
