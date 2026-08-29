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

test('도구가 관측한 현재 Run 이미지는 다음 모델 호출에만 공급하고 Receipt에는 base64를 남기지 않는다', async () => {
  let turn = 0; const events = [];
  const image = { type: 'input_image', detail: 'high', image_url: 'data:image/png;base64,aW1hZ2U=' };
  const model = { async respond(input) {
    turn += 1;
    if (turn === 1) return { text: '', toolCalls: [{ id: 'visual', name: 'observe_image', args: {} }] };
    assert.equal(input.messages.at(-2).role, 'tool');
    assert.equal(input.messages.at(-1).role, 'user');
    assert.deepEqual(input.messages.at(-1).modelAttachments, [image]);
    assert.doesNotMatch(input.messages.at(-2).content, /base64|aW1hZ2U/u);
    return { text: '렌더 픽셀을 확인했습니다.', toolCalls: [] };
  } };
  const result = await runAgent({
    request: '결과 이미지를 확인해', model,
    tools: [{ name: 'observe_image', description: 'observe', parameters: { type: 'object' }, async execute() { return { state: 'observed', _modelAttachments: [image] }; } }],
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.answer, '렌더 픽셀을 확인했습니다.');
  assert.doesNotMatch(JSON.stringify(result.receipts), /base64|aW1hZ2U/u);
  assert.doesNotMatch(JSON.stringify(events.filter((event) => event.type === 'tool_end')), /base64|aW1hZ2U/u);
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

test('Tool의 model projection은 canonical Receipt를 바꾸지 않고 다음 model input만 줄인다', async () => {
  let turn = 0; let observedToolMessage;
  const model = { async respond(input) {
    turn += 1;
    if (turn === 1) return { text: '', toolCalls: [{ id: 'artifact', name: 'attachment', args: {} }] };
    observedToolMessage = input.messages.find((message) => message.role === 'tool');
    return { text: '결과를 준비했습니다.', toolCalls: [] };
  } };
  const tool = { name: 'attachment', description: 'fixture', parameters: { type: 'object' },
    projectResultForModel: (result) => ({ state: result.state, artifact: { originalName: result.artifact.originalName } }),
    async execute() { return { state: 'registered', artifact: {
      originalName: 'result.html', downloadUrl: '/private-download', sessionId: 'private-session',
    } }; } };
  const result = await runAgent({ request: '결과를 만들어줘', model, tools: [tool] });
  assert.match(observedToolMessage.content, /result\.html/u);
  assert.doesNotMatch(observedToolMessage.content, /private-download|private-session/u);
  assert.equal(result.receipts[0].result.artifact.downloadUrl, '/private-download');
  assert.equal(result.receipts[0].result.artifact.sessionId, 'private-session');
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

test('같은 exact route가 같은 이유로 두 번 실패하면 차단 영수증 후 고집한 Run만 멈춘다', async () => {
  let executed = 0;
  let turn = 0;
  const model = { async respond() {
    turn += 1;
    return { text: '', toolCalls: [{ id: `same-${turn}`, name: 'browser', args: {
      action: 'fill_editable', editableId: 'title', text: 'same-attempt',
    } }] };
  } };
  const tool = {
    name: 'browser', description: 'fixture', parameters: { type: 'object' },
    async execute() { executed += 1; throw new Error('tab unavailable'); },
  };
  await assert.rejects(
    () => runAgent({ request: '제목을 입력해줘', model, tools: [tool] }),
    (error) => error.reason === 'verified_resource_runaway',
  );
  assert.equal(executed, 2);
});

test('모델 provider 사용량 합계가 Run 상한을 넘으면 다음 도구를 실행하지 않는다', async () => {
  let turns = 0; let executions = 0; const events = [];
  const model = { async respond() { turns += 1; return {
    text: '', usage: { total_tokens: 300 },
    toolCalls: [{ id: `call-${turns}`, name: 'observe', args: { turn: turns } }],
  }; } };
  const tool = { name: 'observe', description: 'fixture', parameters: { type: 'object' },
    async execute() { executions += 1; return { state: 'observed' }; } };
  await assert.rejects(
    () => runAgent({ request: '긴 작업', model, tools: [tool], maxProviderTokens: 500,
      onEvent: (event) => events.push(event) }),
    (error) => error.reason === 'run_resource_budget_exceeded' && error.resource === 'provider_tokens',
  );
  assert.equal(executions, 1);
  assert.equal(events.filter((event) => event.type === 'model_end').length, 2);
});

test('예약 계약의 단일 필수 실행 Hand는 첫 모델 호출에서 provider tool choice로 강제된다', async () => {
  let turn = 0; const choices = [];
  const model = { async respond(input) {
    choices.push(input.toolChoice ?? null); turn += 1;
    if (turn === 1) return { text: '', toolCalls: [{ id: 'exec-1', name: 'exec', args: {} }] };
    return { text: '실행 결과', toolCalls: [] };
  } };
  const tool = { name: 'exec', description: 'execute exact observed command', parameters: { type: 'object' },
    async execute() { return { state: 'completed', exitCode: 0, stdout: 'done' }; } };
  const result = await runAgent({ request: '예약 실행', model, tools: [tool], requiredInitialTool: 'exec' });
  assert.deepEqual(choices, [{ requiredToolName: 'exec' }, null]);
  assert.equal(result.answer, '실행 결과'); assert.equal(result.receipts[0].outcome, 'succeeded');
});

test('같은 탭의 새 Browser 관측은 모델 transcript에서 이전 큰 snapshot·입력문만 대체한다', async () => {
  let turn = 0;
  const model = { async respond(input) {
    turn += 1;
    if (turn <= 2) return { text: '', toolCalls: [{
      id: `browser-${turn}`, name: 'browser', args: {
        action: turn === 1 ? 'fill_editable' : 'snapshot', text: turn === 1 ? '긴 본문'.repeat(5_000) : null,
      },
    }] };
    const browserMessages = input.messages.filter((message) => message.role === 'tool' && message.name === 'browser')
      .map((message) => JSON.parse(message.content));
    assert.equal(browserMessages[0].result.observationSuperseded, true);
    assert.equal(browserMessages[0].requestedCall.args.text, null);
    assert.equal(browserMessages[0].requestedCall.args.textOmittedAfterUse, true);
    assert.equal(browserMessages[1].result.observation.text.length, 20_000);
    return { text: '최신 화면만 사용했습니다.', toolCalls: [] };
  } };
  const tool = { name: 'browser', description: 'fixture', parameters: { type: 'object' },
    async execute(args) { return {
      state: 'observed', tab: { tabId: 't1', url: 'https://example.com/editor' },
      observation: { text: 'x'.repeat(20_000), refScope: { tabId: 't1' } },
    }; } };
  const result = await runAgent({ request: '편집해', model, tools: [tool] });
  assert.equal(result.answer, '최신 화면만 사용했습니다.');
  assert.equal(result.receipts[0].requestedCall.args.text.length > 10_000, true, 'canonical receipt keeps exact input');
});

test('예약 Run은 필수 목적 영수증 없이 최종 문장으로 종료할 수 없다', async () => {
  let turn = 0;
  const model = { async respond(input) {
    turn += 1;
    if (turn === 1) return { text: '완료했습니다.', toolCalls: [] };
    if (turn === 2) {
      assert.match(input.messages.at(-1).content, /RUNTIME COMPLETION CONTRACT/u);
      return { text: '', toolCalls: [{ id: 'finish', name: 'automation_outcome', args: {} }] };
    }
    return { text: '영수증과 함께 완료했습니다.', toolCalls: [] };
  } };
  const tool = { name: 'automation_outcome', description: 'fixture', parameters: { type: 'object' },
    async execute() { return { state: 'declared', status: 'achieved' }; } };
  const result = await runAgent({ request: '예약 실행', model, tools: [tool], requiredCompletionTool: 'automation_outcome' });
  assert.equal(result.answer, '영수증과 함께 완료했습니다.');
  assert.equal(result.receipts[0].actualCall.name, 'automation_outcome');
});

test('work completion proposal 뒤 빈 응답은 한 번만 최종 답 상태를 다시 공급한다', async () => {
  let turn = 0;
  const model = { async respond(input) {
    turn += 1;
    if (turn === 1) return { text: '', toolCalls: [{ id: 'proposal', name: 'work_completion', args: {} }] };
    if (turn === 2) return { text: '', toolCalls: [] };
    assert.match(input.messages.at(-1).content, /RESULT PUBLICATION STATE/u);
    return { text: '사용자 최종 답입니다.', toolCalls: [] };
  } };
  const tool = { name: 'work_completion', description: 'fixture', parameters: { type: 'object' },
    async execute() { return { state: 'proposal_recorded', verifiedOutcome: 'achieved' }; } };
  const result = await runAgent({ request: '일을 끝내줘', model, tools: [tool] });
  assert.equal(result.answer, '사용자 최종 답입니다.'); assert.equal(turn, 3);
});

test('검증된 무진전 차단 영수증 뒤에도 같은 호출을 고집하면 Run을 멈춘다', async () => {
  let executed = 0;
  const model = { async respond() { return {
    text: '', toolCalls: [{ id: `same-${Date.now()}`, name: 'browser', args: { action: 'snapshot' } }],
  }; } };
  const tool = {
    name: 'browser', description: 'fixture', parameters: { type: 'object' },
    async execute() { executed += 1; return { state: 'tab_unavailable' }; },
  };
  await assert.rejects(
    () => runAgent({ request: '계속 새로고침해', model, tools: [tool] }),
    (error) => error.reason === 'verified_resource_runaway',
  );
  assert.equal(executed, 2);
});
