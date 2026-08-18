import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAgent } from '../src/agent-loop.js';
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
