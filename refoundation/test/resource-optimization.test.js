import test from 'node:test';
import assert from 'node:assert/strict';

import { runAgent } from '../src/agent-loop.js';
import { observeResourceOptimizationChoice } from '../src/resource-optimization.js';

function situation(overrides = {}) {
  return {
    state: 'observed', accounting: 'exact_or_explicit_unknown', intervention: false,
    usage: { providerRetryAttempts: 0, unknownSettlements: 0 },
    evidence: { novel: 1, repeated: 0, none: 0, latestToolEvidence: 'new' },
    input: {},
    legacyFixedBoundaries: {
      modelTurns: { used: 1, configured: 2, wouldReachOnNextObservedPattern: true },
      toolCalls: { used: 1, configured: 24, wouldReachOnNextObservedPattern: false },
      providerTokens: { used: 100, configured: 500000, wouldReachOnNextObservedPattern: false },
      changedBySituation: false,
    },
    anomaly: null, ...overrides,
  };
}

function stagedResourceRun(stages) {
  let index = 0;
  return {
    situation() { return stages[Math.min(index++, stages.length - 1)] ?? null; },
    modelObserver() { return null; }, async observeTool() {},
  };
}

test('A1-4 runtime은 route를 고르지 않고 모델의 settle·continue·multiple 선택만 관측한다', () => {
  assert.deepEqual(observeResourceOptimizationChoice({ response: { toolCalls: [] } }), {
    choice: 'settle', toolCalls: 0,
  });
  assert.deepEqual(observeResourceOptimizationChoice({ response: { toolCalls: [
    { name: 'one', args: {} }, { name: 'two', args: {} },
  ] } }), { choice: 'multiple_calls_selected', toolCalls: 2 });
});

test('충분한 Evidence와 경계 임박에서는 모델의 정확한 정산 선택을 관측한다', async () => {
  const events = [];
  const result = await runAgent({ request: '이미 확인한 42를 답해', resourceRun: stagedResourceRun([situation()]),
    model: { async respond(input) {
      assert.match(input.runtimeContext, /T5 CURRENT RESOURCE SITUATION/u);
      return { text: '정확한 답은 42입니다.', toolCalls: [] };
    } }, onEvent: (event) => events.push(event) });
  assert.match(result.answer, /42/u);
  assert.equal(events.find((event) => event.type === 'resource_optimization_choice').choice, 'settle');
});

test('불충분한 Evidence와 경계 임박에서도 거짓 완료하지 않고 필요한 관측을 유지한다', async () => {
  const events = []; let turn = 0;
  const result = await runAgent({ request: '실제 값을 확인해', resourceRun: stagedResourceRun([situation(), situation()]),
    tools: [{ name: 'observe_fact', description: 'observe', parameters: { type: 'object' },
      async execute() { return { state: 'observed', value: 73 }; } }],
    model: { async respond(input) { turn += 1;
      if (turn === 1) {
        assert.match(input.runtimeContext, /T5 CURRENT RESOURCE SITUATION/u);
        return { text: '', toolCalls: [{ id: 'observe', name: 'observe_fact', args: {} }] };
      }
      const receipt = JSON.parse(input.messages.at(-1).content);
      return { text: `관측값은 ${receipt.result.value}입니다.`, toolCalls: [] };
    } }, onEvent: (event) => events.push(event) });
  assert.match(result.answer, /73/u);
  assert.equal(events.find((event) => event.type === 'resource_optimization_choice').choice, 'continue_observation');
});

test('동일 Evidence 반복 뒤 다른 route가 있으면 모델의 방법 전환을 관측한다', async () => {
  const events = []; let turn = 0;
  const repeated = situation({
    evidence: { novel: 1, repeated: 1, none: 0, latestToolEvidence: 'repeated' },
    anomaly: { category: 'pathology_candidate', signals: ['repeated_evidence_only'] },
  });
  const result = await runAgent({ request: '반복하지 말고 확인해', resourceRun: stagedResourceRun([null, repeated, repeated]),
    tools: [
      { name: 'first_hand', description: 'first', parameters: { type: 'object' }, async execute() { return { state: 'repeated' }; } },
      { name: 'other_hand', description: 'other', parameters: { type: 'object' }, async execute() { return { state: 'observed', value: 9 }; } },
    ], model: { async respond(input) { turn += 1;
      if (turn === 1) return { text: '', toolCalls: [{ id: 'first', name: 'first_hand', args: {} }] };
      if (turn === 2) {
        assert.match(input.runtimeContext, /repeated_evidence_only/u);
        return { text: '', toolCalls: [{ id: 'other', name: 'other_hand', args: {} }] };
      }
      return { text: '다른 방법에서 9를 확인했습니다.', toolCalls: [] };
    } }, onEvent: (event) => events.push(event) });
  assert.match(result.answer, /9/u);
  assert.equal(events.find((event) => event.type === 'resource_optimization_choice').choice, 'different_route_selected');
});

test('모든 Evidence가 새로우면 호출 수만으로 탐색을 축소하지 않는다', async () => {
  const choice = observeResourceOptimizationChoice({
    response: { toolCalls: [{ name: 'next_observation', args: {} }] },
    lastReceipt: { requestedCall: { name: 'prior_observation', args: {} }, result: { state: 'observed' } },
    situation: situation(),
  });
  assert.equal(choice.choice, 'continue_observation');
});

test('unknown 외부 효과에서는 같은 쓰기보다 현실 재관측을 선택한다', async () => {
  const events = []; let turn = 0;
  const unknown = situation({ usage: { providerRetryAttempts: 0, unknownSettlements: 1 },
    anomaly: { category: 'reliability_candidate', signals: ['usage_unknown'] } });
  const result = await runAgent({ request: '불명확한 쓰기를 확인해', resourceRun: stagedResourceRun([null, unknown, unknown]),
    tools: [
      { name: 'write_page', description: 'write', parameters: { type: 'object' }, async execute() { return { state: 'write_unknown' }; } },
      { name: 'read_page', description: 'read', parameters: { type: 'object' }, async execute() { return { state: 'read', present: true }; } },
    ], model: { async respond(input) { turn += 1;
      if (turn === 1) return { text: '', toolCalls: [{ id: 'write', name: 'write_page', args: { value: 'x' } }] };
      if (turn === 2) {
        assert.match(input.runtimeContext, /usage_unknown/u);
        return { text: '', toolCalls: [{ id: 'read', name: 'read_page', args: {} }] };
      }
      return { text: '다시 쓰지 않고 현재 페이지를 확인했습니다.', toolCalls: [] };
    } }, onEvent: (event) => events.push(event) });
  assert.match(result.answer, /다시 쓰지 않고/u);
  assert.equal(events.find((event) => event.type === 'resource_optimization_choice').choice, 'reobserve_or_change_selected');
});

async function parallelQualification(mode, mixed = false) {
  let active = 0; let peak = 0; let turn = 0; const events = [];
  const observedWalls = [];
  const makeTool = (name, delay, executionMode = 'parallel') => ({
    name, executionMode, description: name, parameters: { type: 'object' }, async execute() {
      active += 1; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, delay)); active -= 1;
      return { state: 'observed', name };
    },
  });
  const result = await runAgent({ request: '두 독립 관측을 해', activeOptimizationMode: mode,
    resourceRun: {
      situation() { return null; }, modelObserver() { return null; },
      async observeTool(observation) { observedWalls.push(observation.wallMs); },
    },
    tools: [makeTool('slow', 60), makeTool('fast', 20, mixed ? 'sequential' : 'parallel')],
    model: { async respond(input) { turn += 1;
      if (turn === 1) return { text: '', toolCalls: [
        { id: 'slow-call', name: 'slow', args: {} }, { id: 'fast-call', name: 'fast', args: {} },
      ] };
      assert.deepEqual(input.messages.filter((message) => message.role === 'tool')
        .map((message) => message.toolCallId), ['slow-call', 'fast-call']);
      return { text: '두 관측 완료', toolCalls: [] };
    } }, onEvent: (event) => events.push(event) });
  return { result, peak, events, observedWalls };
}

test('모델이 함께 선택하고 모든 Hand가 parallel-safe일 때만 병렬 실행한다', async () => {
  const sequential = await parallelQualification('off');
  const parallel = await parallelQualification('model-selected-v1');
  const mixed = await parallelQualification('model-selected-v1', true);
  assert.equal(sequential.peak, 1);
  assert.equal(parallel.peak, 2);
  assert.equal(mixed.peak, 1);
  assert.equal(parallel.events.filter((event) => event.type === 'resource_parallel_batch').length, 1);
  assert.equal(mixed.events.some((event) => event.type === 'resource_parallel_batch'), false);
  assert.equal(parallel.result.modelTurns, sequential.result.modelTurns);
  assert.ok(parallel.observedWalls[1] < parallel.observedWalls[0]);
  assert.ok(parallel.observedWalls[1] < 50);
});
