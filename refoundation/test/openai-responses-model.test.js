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
