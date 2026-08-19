import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeOpenAIResponsesModel } from '../src/openai-responses-model.js';
import { makePromptDumper } from '../src/prompt-dump.js';

const SECRET = 'sk-test-must-never-be-dumped';
const execDefinition = {
  name: 'exec',
  description: 'Run a shell command and return stdout, stderr, and exit status.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      cwd: { type: ['string', 'null'] },
    },
    required: ['command', 'cwd'],
    additionalProperties: false,
  },
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('Responses adapter는 현재 사용자 이미지 첨부를 input_image data URL로 보낸다', async () => {
  const requests = [];
  const model = makeOpenAIResponsesModel({
    apiKey: SECRET, model: 'gpt-image-input-test',
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return jsonResponse({
        id: 'image-response', model: 'gpt-image-input-test',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '이미지를 확인했습니다.' }] }],
      });
    },
  });
  await model.respond({
    messages: [{
      role: 'user', content: '이 이미지를 설명해줘',
      modelAttachments: [{ type: 'input_image', detail: 'auto', image_url: 'data:image/png;base64,aW1hZ2U=' }],
    }],
    tools: [],
  });
  assert.deepEqual(requests[0].input, [{
    role: 'user',
    content: [
      { type: 'input_text', text: '이 이미지를 설명해줘' },
      { type: 'input_image', detail: 'auto', image_url: 'data:image/png;base64,aW1hZ2U=' },
    ],
  }]);
});

test('Responses adapter는 모델 output 전체와 같은 call_id의 도구 결과를 다음 호출에 보존한다', async () => {
  const dumpDir = await mkdtemp(join(tmpdir(), 't5-prompt-dump-'));
  const requests = [];
  let call = 0;
  const fetchImpl = async (_url, init) => {
    requests.push({ headers: init.headers, body: JSON.parse(init.body) });
    call += 1;
    if (call === 1) {
      return jsonResponse({
        id: 'resp-1',
        output: [
          { type: 'reasoning', id: 'reason-1', encrypted_content: 'opaque-reasoning' },
          {
            type: 'function_call', id: 'fc-1', call_id: 'call-1', name: 'exec',
            arguments: JSON.stringify({ command: "printf '42'", cwd: null }),
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    }
    return jsonResponse({
      id: 'resp-2',
      output: [{
        type: 'message', id: 'msg-1', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: '합계는 42입니다.', annotations: [] }],
      }],
      usage: { input_tokens: 20, output_tokens: 8 },
    });
  };

  try {
    const model = makeOpenAIResponsesModel({
      apiKey: SECRET,
      model: 'gpt-test',
      instructions: 'Use tools when evidence is needed.',
      fetchImpl,
      dump: makePromptDumper({ directory: dumpDir, sensitiveValues: [SECRET] }),
    });

    const first = await model.respond({
      messages: [{ role: 'user', content: '파일 숫자 합계를 확인해줘' }],
      tools: [execDefinition],
    });
    assert.equal(first.text, '');
    assert.deepEqual(first.toolCalls, [{
      id: 'call-1', name: 'exec', args: { command: "printf '42'", cwd: null },
    }]);

    const receipt = {
      toolCallId: 'call-1', outcome: 'succeeded',
      result: { exitCode: 0, stdout: '42', stderr: '' },
    };
    const second = await model.respond({
      messages: [
        { role: 'user', content: '파일 숫자 합계를 확인해줘' },
        { role: 'assistant', content: '', toolCalls: first.toolCalls },
        { role: 'tool', toolCallId: 'call-1', name: 'exec', content: JSON.stringify(receipt) },
      ],
      tools: [execDefinition],
    });

    assert.equal(second.text, '합계는 42입니다.');
    assert.deepEqual(second.toolCalls, []);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].headers.authorization, `Bearer ${SECRET}`);
    assert.equal(requests[0].body.store, false);
    assert.deepEqual(requests[0].body.tools[0], { type: 'function', strict: true, ...execDefinition });
    assert.deepEqual(requests[1].body.input.slice(0, 3), [
      { role: 'user', content: '파일 숫자 합계를 확인해줘' },
      { type: 'reasoning', id: 'reason-1', encrypted_content: 'opaque-reasoning' },
      {
        type: 'function_call', id: 'fc-1', call_id: 'call-1', name: 'exec',
        arguments: JSON.stringify({ command: "printf '42'", cwd: null }),
      },
    ]);
    assert.deepEqual(requests[1].body.input[3], {
      type: 'function_call_output', call_id: 'call-1', output: JSON.stringify(receipt),
    });

    const dumps = await readdir(dumpDir);
    assert.equal(dumps.length, 2);
    for (const file of dumps) {
      const text = await readFile(join(dumpDir, file), 'utf8');
      assert.doesNotMatch(text, /sk-test-must-never-be-dumped/);
      assert.doesNotMatch(text, /authorization/i);
    }
  } finally {
    await rm(dumpDir, { recursive: true, force: true });
  }
});

test('Responses adapter 오류는 API 키를 사용자 오류문에 노출하지 않는다', async () => {
  const model = makeOpenAIResponsesModel({
    apiKey: SECRET,
    model: 'gpt-test',
    fetchImpl: async () => jsonResponse({ error: { message: `invalid ${SECRET}` } }, 401),
  });
  await assert.rejects(
    () => model.respond({ messages: [{ role: 'user', content: 'hello' }], tools: [] }),
    (error) => error.status === 401 && !String(error.message).includes(SECRET),
  );
});

test('새 Responses adapter는 이전 Run의 function call과 output을 첫 요청에 재생한다', async () => {
  const requests = [];
  const observedContexts = [];
  const model = makeOpenAIResponsesModel({
    apiKey: SECRET,
    model: 'gpt-test',
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return jsonResponse({
        id: 'continued', model: 'gpt-test',
        output: [{
          type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: '이전 값은 value-7391입니다.' }],
        }],
        usage: { input_tokens: 30, output_tokens: 8, total_tokens: 38 },
      });
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
    { role: 'user', content: '파일 값을 확인해줘' },
    { type: 'function_call', call_id: 'old-call', name: 'exec', arguments: '{"command":"read-value","cwd":null}' },
    { type: 'function_call_output', call_id: 'old-call', output: '{"stdout":"value-7391"}' },
    { role: 'assistant', content: '확인했습니다.' },
    { role: 'user', content: '아까 값만 알려줘' },
  ]);
  assert.equal(response.contextReceipt.provider, 'openai');
  assert.equal(response.contextReceipt.requestBytes, Buffer.byteLength(JSON.stringify(requests[0])));
  assert.equal(response.contextReceipt.input.byKind.function_call.items, 1);
  assert.equal(response.contextReceipt.input.byKind.function_call_output.items, 1);
  assert.doesNotMatch(JSON.stringify(response.contextReceipt), /value-7391|파일 값을/);
  assert.deepEqual(observedContexts, [response.contextReceipt]);
});
