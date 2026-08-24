import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAgent } from '../src/agent-loop.js';
import { ResourceController } from '../src/resource-controller.js';
import { resourceExecutionWaves } from '../src/resource-execution-control.js';
import { ResourceLedger } from '../src/resource-ledger.js';
import { deriveResourceReport } from '../src/resource-report.js';

test('새 Evidence가 계속되면 기존 16 model·24 tool 경계를 넘어도 완료한다', async () => {
  let turn = 0; let observed = 0;
  const result = await runAgent({ request: '긴 관측을 끝내',
    tools: [{ name: 'observe', description: 'observe', parameters: { type: 'object' },
      async execute() { observed += 1; return { state: 'observed', value: observed }; } }],
    model: { async respond() { turn += 1;
      if (turn <= 26) return { text: '', toolCalls: [{ id: `call-${turn}`, name: 'observe', args: {} }] };
      return { text: `26개를 모두 확인했습니다: ${observed}`, toolCalls: [] };
    } } });
  assert.equal(result.status, 'completed'); assert.equal(result.modelTurns, 27);
  assert.equal(result.receipts.length, 26); assert.match(result.answer, /26/u);
});

test('제품 콘솔은 user·automation Run에 새 고정 숫자를 전달하지 않는다', async () => {
  const [agent, consoleServer] = await Promise.all([
    readFile(new URL('../src/agent-loop.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/console-server.js', import.meta.url), 'utf8'),
  ]);
  assert.match(agent, /maxModelTurns = null/u);
  assert.match(agent, /maxToolCalls = null/u);
  assert.match(agent, /maxProviderTokens = null/u);
  assert.doesNotMatch(consoleServer, /maxModelTurns:\s*(?:12|16)|maxToolCalls:\s*(?:18|24)|maxProviderTokens:\s*(?:300_000|500_000)/u);
});

test('같은 호출이어도 결과가 바뀌면 호출 수로 막지 않는다', async () => {
  let turn = 0; let value = 0;
  const result = await runAgent({ request: '변화를 계속 관측해',
    tools: [{ name: 'poll', description: 'poll', parameters: { type: 'object' },
      async execute() { value += 1; return { state: 'running', value }; } }],
    model: { async respond() { turn += 1;
      return turn <= 5 ? { text: '', toolCalls: [{ id: `poll-${turn}`, name: 'poll', args: {} }] }
        : { text: `최신 값 ${value}`, toolCalls: [] };
    } } });
  assert.equal(result.status, 'completed'); assert.equal(result.receipts.length, 5);
  assert.match(result.answer, /5/u);
});

test('같은 route의 같은 결과를 두 번 관측한 뒤에만 차단하고 다른 route는 유지한다', async () => {
  let turn = 0; let repeatedExecutions = 0; const events = [];
  const ledger = new ResourceLedger(await mkdtemp(join(tmpdir(), 't5-a1-5-route-')));
  const resourceRun = await new ResourceController(ledger).startRun({ sessionId: 'session', runId: 'run' });
  const result = await runAgent({ request: '다른 방법으로라도 확인해', resourceRun, tools: [
    { name: 'stuck', description: 'stuck', parameters: { type: 'object' },
      async execute() { repeatedExecutions += 1; return { state: 'same', value: 7 }; } },
    { name: 'alternate', description: 'alternate', parameters: { type: 'object' },
      async execute() { return { state: 'observed', value: 42 }; } },
  ], model: { async respond(input) { turn += 1;
    if (turn <= 3) return { text: '', toolCalls: [{ id: `stuck-${turn}`, name: 'stuck', args: {} }] };
    if (turn === 4) {
      assert.equal(JSON.parse(input.messages.at(-1).content).result.state, 'method_not_executed');
      return { text: '', toolCalls: [{ id: 'alternate', name: 'alternate', args: {} }] };
    }
    return { text: '다른 방법으로 42를 확인했습니다.', toolCalls: [] };
  } }, onEvent: (event) => events.push(event) });
  assert.equal(repeatedExecutions, 2); assert.match(result.answer, /42/u);
  assert.equal(events.filter((event) => event.type === 'resource_intervention'
    && event.action === 'route_blocked').length, 1);
  await resourceRun.close('completed');
  assert.equal(deriveResourceReport(await ledger.read()).controlActions, 1);
});

test('unknown effect의 같은 쓰기는 재실행하지 않고 현실 읽기를 열어둔다', async () => {
  let turn = 0; let writes = 0; let reads = 0;
  const result = await runAgent({ request: '쓰기 결과를 확인해', tools: [
    { name: 'write', description: 'write', parameters: { type: 'object' },
      async execute() { writes += 1; return { state: 'write_unknown' }; } },
    { name: 'read', description: 'read', parameters: { type: 'object' },
      async execute() { reads += 1; return { state: 'observed', present: true }; } },
  ], model: { async respond(input) { turn += 1;
    if (turn <= 2) return { text: '', toolCalls: [{ id: `write-${turn}`, name: 'write', args: { value: 'x' } }] };
    if (turn === 3) {
      assert.equal(JSON.parse(input.messages.at(-1).content).result.reason, 'effect_unknown_requires_observation');
      return { text: '', toolCalls: [{ id: 'read', name: 'read', args: {} }] };
    }
    return { text: '다시 쓰지 않고 현재 상태를 확인했습니다.', toolCalls: [] };
  } } });
  assert.equal(writes, 1); assert.equal(reads, 1); assert.equal(result.status, 'completed');
});

test('병렬 wave는 물리 병렬도를 넘지 않고 내부 fan-out Hand를 독점 wave로 분리한다', () => {
  const items = [
    { id: 'a', tool: {} }, { id: 'b', tool: {} },
    { id: 'nested', tool: { nestedParallelism: true } },
    { id: 'c', tool: {} }, { id: 'd', tool: {} }, { id: 'e', tool: {} },
  ];
  assert.deepEqual(resourceExecutionWaves(items, 2).map((wave) => wave.map((item) => item.id)),
    [['a', 'b'], ['nested'], ['c', 'd'], ['e']]);
});

test('병렬 provider rate 실패는 같은 Hand의 추가 fan-out 재시행으로 번지지 않는다', async () => {
  let turn = 0; let providerCalls = 0; let fallbackCalls = 0;
  const result = await runAgent({ request: '나온 자료만 정리해', parallelCapacity: 2, tools: [
    { name: 'provider_read', executionMode: 'parallel', description: 'read', parameters: { type: 'object' },
      async execute() { providerCalls += 1; throw new Error('provider rate limited'); } },
    { name: 'local_fallback', description: 'fallback', parameters: { type: 'object' },
      async execute() { fallbackCalls += 1; return { state: 'observed', value: 42 }; } },
  ], model: { async respond(input) { turn += 1;
    if (turn === 1) return { text: '', toolCalls: [
      { id: 'rate-a', name: 'provider_read', args: { source: 'a' } },
      { id: 'rate-b', name: 'provider_read', args: { source: 'b' } },
    ] };
    if (turn === 2) return { text: '', toolCalls: [{ id: 'rate-c', name: 'provider_read', args: { source: 'c' } }] };
    if (turn === 3) {
      assert.equal(JSON.parse(input.messages.at(-1).content).result.reason, 'same_hand_same_failure_repeated');
      return { text: '', toolCalls: [{ id: 'fallback', name: 'local_fallback', args: {} }] };
    }
    return { text: '로컬 근거에서 42를 확인했습니다.', toolCalls: [] };
  } } });
  assert.equal(providerCalls, 2); assert.equal(fallbackCalls, 1); assert.match(result.answer, /42/u);
});

test('parallel cancel은 시작한 자식만 종료·commit하고 대기 자식은 실행·reservation하지 않는다', async () => {
  const ledger = new ResourceLedger(await mkdtemp(join(tmpdir(), 't5-a1-5-cancel-')));
  const run = await new ResourceController(ledger).startRun({ sessionId: 'session', runId: 'run' });
  const controller = new AbortController(); let executed = 0; let turn = 0;
  const tools = Array.from({ length: 5 }, (_, index) => ({
    name: `read_${index}`, executionMode: 'parallel', description: 'read', parameters: { type: 'object' },
    async execute(_args, context) {
      executed += 1; if (index === 0) setTimeout(() => controller.abort(), 1);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return context.signal.aborted ? { stopped: 'aborted' } : { state: 'observed', index };
    },
  }));
  const resultPromise = runAgent({ request: '다섯 개를 함께 읽어', tools, resourceRun: run,
    parallelCapacity: 2, signal: controller.signal, model: { async respond() { turn += 1;
      return { text: '', toolCalls: tools.map((tool, index) => ({ id: `call-${index}`, name: tool.name, args: {} })) };
    } } });
  const result = await resultPromise; await run.close('cancelled');
  const report = deriveResourceReport(await ledger.read());
  assert.equal(result.status, 'cancelled'); assert.equal(executed, 2); assert.equal(result.receipts.length, 5);
  assert.equal(report.reservations, 2); assert.equal(report.committed, 2); assert.equal(report.unsettled, 0);
});

test('사용자·자격 경계로 명시한 상한은 계속 정확히 집행한다', async () => {
  let turn = 0;
  await assert.rejects(() => runAgent({ request: '명시 경계 시험', maxModelTurns: 2,
    model: { async respond() { turn += 1; return { text: '', toolCalls: [{ id: `${turn}`, name: 'read', args: { turn } }] }; } },
    tools: [{ name: 'read', description: 'read', parameters: { type: 'object' }, async execute(args) { return args; } }],
  }), (error) => error.reason === 'run_resource_budget_exceeded' && error.resource === 'model_turns');
});

function failingStorage(failType) {
  let body = ''; let failed = false;
  return {
    async prepare() {}, async read() { return body; },
    async append(line) {
      const event = JSON.parse(line);
      if (!failed && event.type === failType) { failed = true; throw new Error(`fault at ${failType}`); }
      body += line;
    },
  };
}

test('tool reservation·settlement storage 실패는 병렬 사용자 결과를 막지 않고 열린 정산은 재시작 unknown이 된다', async () => {
  for (const failType of ['ResourceReserved', 'ReservationCommitted']) {
    const storage = failingStorage(failType); const diagnostics = [];
    const ledger = new ResourceLedger('fault-storage', { storage });
    const resourceRun = await new ResourceController(ledger).startRun({
      sessionId: `session-${failType}`, runId: `run-${failType}`,
      onDiagnostic: async (value) => diagnostics.push(value.stage),
    });
    let turn = 0;
    const tools = [1, 2].map((value) => ({ name: `read_${value}`, executionMode: 'parallel',
      description: 'read', parameters: { type: 'object' },
      async execute() { return { state: 'observed', value }; } }));
    const result = await runAgent({ request: '두 개를 함께 확인해', resourceRun, tools,
      model: { async respond() { turn += 1; return turn === 1
        ? { text: '', toolCalls: tools.map((tool, index) => ({ id: `read-${index}`, name: tool.name, args: {} })) }
        : { text: '확인한 값은 42입니다.', toolCalls: [] }; } } });
    assert.match(result.answer, /42/u); assert.equal(diagnostics.length, 1);
    if (failType === 'ReservationCommitted') {
      const restarted = new ResourceLedger('fault-storage', { storage });
      assert.equal((await restarted.recoverOpenReservations()).length, 2);
      assert.equal(deriveResourceReport(await restarted.read()).unknown, 2);
    }
  }
});
