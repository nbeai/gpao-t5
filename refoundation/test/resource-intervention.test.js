import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAgent } from '../src/agent-loop.js';
import { makeProcessControlTool } from '../src/exec-tool.js';
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

test('Process Hand가 pending으로 밝힌 같은 running poll은 반복되어도 종료 관측까지 계속한다', async () => {
  const ledger = new ResourceLedger(await mkdtemp(join(tmpdir(), 't5-a1-5-pending-poll-')));
  const resourceRun = await new ResourceController(ledger).startRun({ sessionId: 'session', runId: 'run' });
  let polls = 0; let turn = 0; const contexts = [];
  const processRegistry = {
    async poll() {
      polls += 1;
      return polls < 4
        ? { processId: 'process', state: 'running', stdout: '', stderr: '', cursor: { stdout: 0, stderr: 0 }, exitCode: null }
        : { processId: 'process', state: 'completed', stdout: 'done', stderr: '', cursor: { stdout: 4, stderr: 0 }, exitCode: 0 };
    },
    metadata() { return null; },
  };
  const tool = makeProcessControlTool({ processRegistry, ownerId: 'owner' });
  const args = { action: 'poll', processId: 'process', cursor: { stdout: 0, stderr: 0 },
    input: null, end: null, waitMs: 0, cols: null, rows: null };
  const result = await runAgent({ request: '종료될 때까지 현재 프로세스를 확인해', tools: [tool], resourceRun,
    model: { async respond(input) { turn += 1;
      contexts.push(input.runtimeContext ?? '');
      const handle = await input.resourceObserver?.reserve({ provider: 'fixture', model: 'fixture', attempt: 1,
        contextReceipt: { requestBytes: 1000 + turn, input: { bytes: 800 }, tools: { bytes: 100 } } });
      await input.resourceObserver?.commit(handle, { usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 } });
      if (turn <= 4) return { text: '', toolCalls: [{ id: `poll-${turn}`, name: 'process_control', args }] };
      assert.equal(JSON.parse(input.messages.at(-1).content).result.state, 'completed');
      return { text: '프로세스가 정상 종료됐습니다.', toolCalls: [] };
    } } });
  assert.equal(result.status, 'completed'); assert.equal(polls, 4);
  assert.equal(result.receipts.some((receipt) => receipt.result?.state === 'method_not_executed'), false);
  await resourceRun.close('completed');
  assert.equal(contexts.some((context) => /pathology_candidate|active-control|model_selected_recovery/u.test(context)), false);
  assert.equal(deriveResourceReport(await ledger.read()).controlActions, 0);
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

test('같은 Hand의 서로 다른 args가 같은 이유로 실패해도 미시도 route는 유지한다', async () => {
  let turn = 0; let providerCalls = 0;
  const result = await runAgent({ request: '세 번째 대상까지 직접 확인해', parallelCapacity: 2, tools: [
    { name: 'provider_read', executionMode: 'parallel', description: 'read', parameters: { type: 'object' },
      async execute(args) {
        providerCalls += 1;
        if (args.source === 'c') return { state: 'observed', value: 42 };
        throw new Error('same target-level failure');
      } },
  ], model: { async respond(input) { turn += 1;
    if (turn === 1) return { text: '', toolCalls: [
      { id: 'rate-a', name: 'provider_read', args: { source: 'a' } },
      { id: 'rate-b', name: 'provider_read', args: { source: 'b' } },
    ] };
    if (turn === 2) return { text: '', toolCalls: [{ id: 'rate-c', name: 'provider_read', args: { source: 'c' } }] };
    assert.equal(JSON.parse(input.messages.at(-1).content).result.value, 42);
    return { text: '세 번째 대상에서 42를 확인했습니다.', toolCalls: [] };
  } } });
  assert.equal(providerCalls, 3); assert.match(result.answer, /42/u);
});

test('A0 정제 replay는 107-call 자원 곡선만으로 active stop 지점을 발명하지 않는다', async () => {
  const fixture = JSON.parse(await readFile(new URL(
    '../config/s2-incident-reference-fixtures.json', import.meta.url,
  ), 'utf8'));
  const calls = fixture.resourceRunaway.runs.flatMap((run) => run.calls);
  assert.equal(calls.length, 107);
  assert.equal(calls.every((call) => Array.isArray(call) && call.length === 4
    && call.every(Number.isInteger)), true);
  const activeReplay = {
    observedCalls: calls.length, interventionAtCall: null,
    reason: 'route_identity_and_evidence_fingerprint_not_preserved',
  };
  assert.deepEqual(activeReplay, { observedCalls: 107, interventionAtCall: null,
    reason: 'route_identity_and_evidence_fingerprint_not_preserved' });
});

test('새 Evidence 없는 고유 route 증가는 pathology Situation 후 모델 recovery까지 실행하고 추가 실행을 막는다', async () => {
  const ledger = new ResourceLedger(await mkdtemp(join(tmpdir(), 't5-a1-5-unique-runaway-')));
  const resourceRun = await new ResourceController(ledger).startRun({ sessionId: 'session', runId: 'run' });
  let turn = 0; let executions = 0; const contexts = [];
  const model = { async respond(input) {
    turn += 1; contexts.push(input.runtimeContext ?? '');
    const handle = await input.resourceObserver?.reserve({ provider: 'fixture', model: 'fixture', attempt: 1,
      contextReceipt: { requestBytes: 1000 + (turn * 100), input: { bytes: 800 + (turn * 100) },
        tools: { bytes: 100 }, source: { bytes: 500 } } });
    await input.resourceObserver?.commit(handle, { usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } });
    if (turn <= 4) return { text: '', usage: { total_tokens: 12 },
      toolCalls: [{ id: `route-${turn}`, name: 'probe', args: { route: String.fromCharCode(64 + turn) } }] };
    const blocked = JSON.parse(input.messages.at(-1).content);
    assert.equal(blocked.result.reason, 'no_new_evidence_after_selected_recovery');
    return { text: '세 방법을 확인했지만 근거를 얻지 못해 아직 완료하지 못했습니다.', toolCalls: [] };
  } };
  const result = await runAgent({ request: '근거를 찾아', model, resourceRun,
    tools: [{ name: 'probe', description: 'probe one selected route', parameters: { type: 'object' },
      async execute(args) { executions += 1; return { state: 'not_found', route: args.route, exitCode: 1 }; } }] });
  await resourceRun.close('completed');
  assert.equal(result.status, 'completed'); assert.equal(executions, 3);
  assert.equal(result.receipts.length, 4); assert.equal(result.receipts[3].outcome, 'not_executed');
  assert.match(contexts[2], /pathology_candidate/u);
  assert.match(contexts[3], /model_selected_recovery_produced_no_new_evidence/u);
  assert.match(result.answer, /완료하지 못/u);
  assert.equal(deriveResourceReport(await ledger.read()).controlActions, 1);
});

test('pathology Situation 후 모델이 선택한 recovery가 새 Evidence를 내면 추가 미시도 route를 계속 연다', async () => {
  const ledger = new ResourceLedger(await mkdtemp(join(tmpdir(), 't5-a1-5-recovery-progress-')));
  const resourceRun = await new ResourceController(ledger).startRun({ sessionId: 'session', runId: 'run' });
  let turn = 0; let executions = 0;
  const result = await runAgent({ request: '다른 방법의 근거까지 확인해', resourceRun,
    tools: [{ name: 'probe', description: 'probe', parameters: { type: 'object' }, async execute(args) {
      executions += 1;
      if (args.route === 'A' || args.route === 'B') return { state: 'not_found', route: args.route, exitCode: 1 };
      return { state: 'observed', route: args.route, value: args.route === 'C' ? 42 : 43 };
    } }], model: { async respond(input) {
      turn += 1;
      const handle = await input.resourceObserver?.reserve({ provider: 'fixture', model: 'fixture', attempt: 1,
        contextReceipt: { requestBytes: 1000 + (turn * 100), input: { bytes: 800 }, tools: { bytes: 100 } } });
      await input.resourceObserver?.commit(handle, { usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 } });
      if (turn <= 4) return { text: '', toolCalls: [{ id: `route-${turn}`, name: 'probe',
        args: { route: String.fromCharCode(64 + turn) } }] };
      return { text: 'recovery에서 42, 다음 방법에서 43을 확인했습니다.', toolCalls: [] };
    } } });
  await resourceRun.close('completed');
  assert.equal(result.status, 'completed'); assert.equal(executions, 4);
  assert.equal(result.receipts.some((receipt) => receipt.outcome === 'not_executed'), false);
  assert.equal(deriveResourceReport(await ledger.read()).controlActions, 0);
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
