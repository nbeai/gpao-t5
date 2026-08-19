import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAgent } from '../src/agent-loop.js';

test('현재 사용자 첨부의 provider input은 agent loop 첫 모델 호출에만 결속된다', async () => {
  const calls = [];
  const model = { async respond(input) {
    calls.push(input.messages);
    return { text: '이미지를 확인했습니다.', toolCalls: [] };
  } };
  const attachments = [{ type: 'input_image', detail: 'auto', image_url: 'data:image/png;base64,aW1hZ2U=' }];
  const result = await runAgent({
    request: '무엇이 보여?', requestAttachments: attachments, model, tools: [],
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(calls[0].at(-1).modelAttachments, attachments);
  assert.deepEqual(result.transcript.at(0).modelAttachments, attachments);
});
import { makeExecTool } from '../src/exec-tool.js';

async function withWorkspace(fn) {
  const workspace = await mkdtemp(join(tmpdir(), 't5-thin-hand-'));
  try { return await fn(workspace); }
  finally { await rm(workspace, { recursive: true, force: true }); }
}

test('모델이 exec 결과를 관측한 뒤 자기 답으로 종료한다', async () => withWorkspace(async (workspace) => {
  let turn = 0;
  const model = {
    async respond(input) {
      if (turn++ === 0) {
        assert.equal(input.messages.at(-1).role, 'user');
        return {
          text: '',
          toolCalls: [{ id: 'call-1', name: 'exec', args: { command: "printf '6'" } }],
        };
      }
      const observation = JSON.parse(input.messages.at(-1).content);
      assert.equal(observation.outcome, 'succeeded');
      assert.equal(observation.result.stdout, '6');
      assert.equal(observation.result.commandExplanation.ok, true);
      assert.equal(observation.result.commandExplanation.steps[0].executable, 'printf');
      return { text: '계산 결과는 6입니다.', toolCalls: [] };
    },
  };

  const result = await runAgent({
    request: '2와 4를 더해줘', model, tools: [makeExecTool({ workspace })],
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.answer, '계산 결과는 6입니다.');
  assert.equal(result.receipts.length, 1);
  assert.equal(result.receipts[0].actualCall.name, 'exec');
  assert.equal(result.modelTurns, 2);
}));

test('첫 명령이 실패하면 원문을 본 모델이 다른 명령으로 전환할 수 있다', async () => withWorkspace(async (workspace) => {
  let turn = 0;
  const model = {
    async respond(input) {
      turn += 1;
      if (turn === 1) {
        return {
          text: '',
          toolCalls: [{ id: 'bad', name: 'exec', args: { command: "printf 'first failed' >&2; exit 7" } }],
        };
      }
      const observation = JSON.parse(input.messages.at(-1).content);
      if (turn === 2) {
        assert.equal(observation.outcome, 'failed');
        assert.equal(observation.result.exitCode, 7);
        assert.match(observation.result.stderr, /first failed/);
        return {
          text: '',
          toolCalls: [{ id: 'recovery', name: 'exec', args: { command: "printf 'recovered'" } }],
        };
      }
      assert.equal(observation.outcome, 'succeeded');
      assert.equal(observation.result.stdout, 'recovered');
      return { text: '다른 방법으로 확인해 해결했습니다.', toolCalls: [] };
    },
  };

  const result = await runAgent({
    request: '첫 방법이 안 되면 다른 방법으로 확인해줘',
    model,
    tools: [makeExecTool({ workspace })],
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.answer, '다른 방법으로 확인해 해결했습니다.');
  assert.deepEqual(result.receipts.map((receipt) => receipt.outcome), ['failed', 'succeeded']);
  assert.equal(result.modelTurns, 3);
}));

test('취소되면 같은 응답에 남은 도구 호출을 시작하지 않는다', async () => {
  const controller = new AbortController();
  const executed = [];
  const tool = {
    name: 'exec', description: 'test tool', parameters: { type: 'object' },
    async execute(args) {
      executed.push(args.command);
      controller.abort();
      return { exitCode: 0, stdout: 'first', stderr: '' };
    },
  };
  const model = {
    async respond() {
      return {
        text: '',
        toolCalls: [
          { id: 'first', name: 'exec', args: { command: 'first' } },
          { id: 'second', name: 'exec', args: { command: 'second' } },
        ],
      };
    },
  };

  const result = await runAgent({ request: '둘을 실행해', model, tools: [tool], signal: controller.signal });

  assert.equal(result.status, 'cancelled');
  assert.deepEqual(executed, ['first']);
  assert.equal(result.receipts.length, 1);
});

test('런타임은 모델의 최종 답을 덧붙이거나 교정하지 않는다', async () => {
  const model = { async respond() { return {
    text: '모델이 쓴 답 그대로', toolCalls: [],
    responseId: 'response-1', responseModel: 'model-reported', usage: { input_tokens: 3, output_tokens: 2 },
  }; } };
  const result = await runAgent({ request: '인사해줘', model, tools: [] });
  assert.equal(result.answer, '모델이 쓴 답 그대로');
  assert.equal(result.transcript.at(-1).content, '모델이 쓴 답 그대로');
  assert.equal(result.modelTurns, 1);
  assert.deepEqual(result.modelCalls, [{
    turn: 1, responseId: 'response-1', responseModel: 'model-reported',
    usage: { input_tokens: 3, output_tokens: 2 },
  }]);
});

test('agent loop 이벤트는 Model Step과 전체 ToolReceipt를 원장에 넘길 수 있다', async () => withWorkspace(async (workspace) => {
  const events = [];
  let turn = 0;
  const model = { async respond() {
    if (turn++ === 0) return {
      text: '확인 중', responseId: 'model-response-1', responseModel: 'event-model',
      usage: { input_tokens: 4, output_tokens: 3 },
      toolCalls: [{ id: 'event-tool-1', name: 'exec', args: { command: "printf 'event-ok'", cwd: null } }],
    };
    return { text: '완료', toolCalls: [], responseId: 'model-response-2', responseModel: 'event-model' };
  } };
  const result = await runAgent({
    request: '확인해', model, tools: [makeExecTool({ workspace })],
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.status, 'completed');
  const modelCompleted = events.find((event) => event.type === 'model_end' && event.turn === 1);
  assert.equal(modelCompleted.response.responseId, 'model-response-1');
  assert.equal(modelCompleted.response.text, '확인 중');
  assert.equal(modelCompleted.response.toolCalls[0].id, 'event-tool-1');
  const toolCompleted = events.find((event) => event.type === 'tool_end');
  assert.equal(toolCompleted.receipt.toolCallId, 'event-tool-1');
  assert.equal(toolCompleted.receipt.actualCall.args.command, "printf 'event-ok'");
  assert.equal(toolCompleted.receipt.result.stdout, 'event-ok');
}));

test('모르는 도구 요청은 실행하지 않고 그 사실을 모델에게 돌려준다', async () => {
  let turn = 0;
  const model = {
    async respond(input) {
      if (turn++ === 0) {
        return { text: '', toolCalls: [{ id: 'unknown', name: 'missing.tool', args: {} }] };
      }
      const observation = JSON.parse(input.messages.at(-1).content);
      assert.equal(observation.outcome, 'unavailable');
      assert.equal(observation.actualCall, null);
      return { text: '그 도구는 현재 사용할 수 없습니다.', toolCalls: [] };
    },
  };
  const result = await runAgent({ request: '없는 도구를 써봐', model, tools: [] });
  assert.equal(result.status, 'completed');
  assert.equal(result.receipts[0].outcome, 'unavailable');
});

test('authority preflight가 멈춘 call은 actualCall 없이 not_executed receipt로 남는다', async () => {
  let executed = false;
  let turn = 0;
  const tool = {
    name: 'exec', description: 'effect test', parameters: { type: 'object' },
    async preflight() {
      return {
        allowed: false, outcome: 'not_executed',
        result: { state: 'approval_required', pendingId: 'pending-1' },
      };
    },
    async execute() { executed = true; return { exitCode: 0 }; },
  };
  const model = { async respond(input) {
    if (turn++ === 0) return {
      text: '', toolCalls: [{ id: 'gated-call', name: 'exec', args: { command: 'rm target' } }],
    };
    const receipt = JSON.parse(input.messages.at(-1).content);
    assert.equal(receipt.outcome, 'not_executed');
    assert.equal(receipt.actualCall, null);
    assert.equal(receipt.result.pendingId, 'pending-1');
    return { text: '승인이 필요합니다.', toolCalls: [] };
  } };
  const result = await runAgent({ request: '지워줘', model, tools: [tool] });
  assert.equal(result.status, 'completed');
  assert.equal(executed, false);
  assert.equal(result.receipts[0].actualCall, null);
});

test('콘솔의 앞선 사용자·assistant 대화가 현재 요청보다 먼저 모델 문맥에 들어간다', async () => {
  const model = {
    async respond(input) {
      assert.deepEqual(input.messages, [
        { role: 'user', content: '앞 질문' },
        { role: 'assistant', content: '앞 답' },
        { role: 'user', content: '그걸 이어서 해줘' },
      ]);
      return { text: '이어진 답', toolCalls: [] };
    },
  };
  const result = await runAgent({
    request: '그걸 이어서 해줘',
    history: [
      { role: 'user', content: '앞 질문' },
      { role: 'assistant', content: '앞 답' },
    ],
    model,
  });
  assert.equal(result.answer, '이어진 답');
});
