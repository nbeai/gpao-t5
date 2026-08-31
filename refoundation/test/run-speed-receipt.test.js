import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveRunPerformanceTimeline, deriveRunSpeedReceipt } from '../src/run-speed-receipt.js';

test('Run 사건에서 모델·도구·출력·토큰·사용자 가시 시간을 분리해 계산한다', () => {
  const event = (sequence, seconds, type, payload = {}, stepId) => ({
    schema: 't5.run-event.v1', runId: 'run-1', sequence,
    recordedAt: `2026-08-19T00:00:0${seconds}.000Z`, type,
    ...(stepId ? { stepId } : {}), payload,
  });
  const run = {
    runId: 'run-1', status: 'completed', events: [
      event(1, 0, 'run_started'),
      event(2, 0, 'model_started', { turn: 1 }, 'model-1'),
      event(3, 1, 'surface_metric', { event: 'first_feedback_visible', elapsedMs: 80, visibilityState: 'visible' }),
      event(4, 2, 'model_completed', { turn: 1, response: {
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 }, toolCalls: [{}],
      } }, 'model-1'),
      event(5, 2, 'tool_started', {}, 'tool-1'),
      event(6, 3, 'tool_completed', { receipt: {
        outcome: 'succeeded', result: { stdout: 'hello', stderr: '!', omittedChars: 4, durationMs: 900 },
      } }, 'tool-1'),
      event(7, 3, 'model_started', { turn: 2 }, 'model-2'),
      event(8, 4, 'model_completed', { turn: 2, response: {
        usage: { input_tokens: 150, output_tokens: 30, total_tokens: 180 }, toolCalls: [],
      } }, 'model-2'),
      event(8.1, 4, 'surface_metric', { event: 'first_answer_delta_received', elapsedMs: 2200, visibilityState: 'visible' }),
      event(8.2, 4, 'surface_metric', { event: 'first_answer_delta_visible', elapsedMs: 2275, visibilityState: 'visible' }),
      event(9, 4, 'surface_metric', { event: 'first_grounded_content', elapsedMs: 4050, visibilityState: 'visible' }),
      event(10, 4, 'run_completed', { modelTurns: 2, receiptCount: 1 }),
      event(11, 5, 'surface_metric', { event: 'turn_complete', elapsedMs: 5100, visibilityState: 'visible' }),
    ],
  };
  assert.deepEqual(deriveRunSpeedReceipt(run), {
    runId: 'run-1', status: 'completed',
    wallMs: 4000,
    model: { calls: 2, durationMs: 3000, inputTokens: 250, outputTokens: 50, totalTokens: 300 },
    tools: { calls: 1, durationMs: 900, outputChars: 6, omittedChars: 4, failedCalls: 0 },
    visible: { firstFeedbackMs: 80, firstGroundedContentMs: 4050,
      firstAnswerDeltaReceivedMs: 2200, firstAnswerDeltaVisibleMs: 2275,
      answerDeltaToVisibleMs: 75, turnCompleteMs: 5100 },
  });
});

test('없는 가시성·사용량 값은 성공처럼 0으로 꾸미지 않고 null로 둔다', () => {
  const run = {
    runId: 'run-2', status: 'interrupted', events: [{
      recordedAt: '2026-08-19T00:00:00.000Z', type: 'run_started', payload: {},
    }],
  };
  const receipt = deriveRunSpeedReceipt(run);
  assert.equal(receipt.wallMs, null);
  assert.deepEqual(receipt.visible, {
    firstFeedbackMs: null, firstGroundedContentMs: null,
    firstAnswerDeltaReceivedMs: null, firstAnswerDeltaVisibleMs: null,
    answerDeltaToVisibleMs: null, turnCompleteMs: null,
  });
  assert.equal(receipt.model.inputTokens, null);
});

test('PERF-0 timeline은 기존 model·tool·context·cache 사실만 content-free로 재계산한다', () => {
  const event = (sequence, milliseconds, type, payload = {}, stepId) => ({
    schema: 't5.run-event.v1', runId: 'perf-run', sequence,
    recordedAt: new Date(Date.parse('2026-08-31T00:00:00.000Z') + milliseconds).toISOString(),
    type, ...(stepId ? { stepId } : {}), payload,
  });
  const timeline = deriveRunPerformanceTimeline({ runId: 'perf-run', status: 'completed', events: [
    event(1, 0, 'model_started', { turn: 1 }, 'model-1'),
    event(2, 100, 'model_completed', { turn: 1, response: {
      toolCalls: [{ name: 'observe' }],
      contextReceipt: { requestBytes: 1000, instructionsBytes: 300,
        input: { bytes: 400, byKind: { function_call_output: { bytes: 0 } } },
        tools: { bytes: 200 } },
      usage: { input_tokens: 100, output_tokens: 10,
        input_tokens_details: { cached_tokens: 80, cache_write_tokens: 5 } },
    } }, 'model-1'),
    event(3, 130, 'tool_started', { turn: 1 }, 'tool-call-1'),
    event(4, 230, 'tool_completed', { turn: 1, receipt: {
      requestedCall: { name: 'observe' }, actualCall: { name: 'observe' }, outcome: 'succeeded',
      result: { stdout: 'OK', stderr: '', durationMs: 70 },
    } }, 'tool-call-1'),
    event(5, 250, 'model_started', { turn: 2 }, 'model-2'),
    event(6, 350, 'model_completed', { turn: 2, response: {
      toolCalls: [], contextReceipt: { requestBytes: 1200, instructionsBytes: 300,
        input: { bytes: 600, byKind: { function_call_output: { bytes: 150 } } },
        tools: { bytes: 200 } },
      usage: { input_tokens: 120, output_tokens: 20,
        input_tokens_details: { cached_tokens: 80, cache_write_tokens: 0 } },
    } }, 'model-2'),
  ] });
  assert.deepEqual(timeline.models.map((item) => ({ turn: item.turn, durationMs: item.durationMs,
    requestBytes: item.requestBytes, cachedInputTokens: item.cachedInputTokens })), [
    { turn: 1, durationMs: 100, requestBytes: 1000, cachedInputTokens: 80 },
    { turn: 2, durationMs: 100, requestBytes: 1200, cachedInputTokens: 80 },
  ]);
  assert.equal(timeline.tools[0].wallMs, 100);
  assert.equal(timeline.tools[0].reportedExecutionMs, 70);
  assert.equal(timeline.tools[0].nextModelStartMs, 20);
  assert.equal(timeline.totals.requestBytes, 2200);
  assert.equal(timeline.totals.functionOutputBytes, 150);
  assert.equal(timeline.totals.cachedInputTokens, 160);
  assert.ok(timeline.unavailableFacts.includes('tool_preflight_duration'));
  assert.doesNotMatch(JSON.stringify(timeline), /OK/u);
});
