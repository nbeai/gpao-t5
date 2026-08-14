import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { interpret } from '../src/kernel/l1-intent/intent.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { runCommand } from '../src/runtime/terminal-run.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoDescriptors, demoEnv } from '../src/surface/demo-context.js';

const selfState = buildSelfState({
  model: { id: 'test' },
  connections: [{ id: 'local.terminal', connected: true, executable: true }],
});

test('실행된 터미널 실패는 원시 stdout·stderr·exit·cwd 영수증을 보존한다', async () => {
  const runner = new ToolRunner({
    'local.terminal': {
      async handler() {
        return {
          failed: true,
          failureResult: {
            command: 'missing-command', cwd: '/isolated/work', exitCode: 127,
            stdout: 'partial output', stderr: 'command not found',
          },
          userSafeSummary: '명령이 이 컴퓨터에 없어요.',
        };
      },
    },
  });

  const receipt = await runner.run('local.terminal', { command: 'missing-command' }, selfState);
  assert.equal(receipt.actualCall?.tool, 'local.terminal');
  assert.equal(receipt.failureState, 'failed');
  assert.deepEqual(receipt.result, {
    command: 'missing-command', cwd: '/isolated/work', exitCode: 127,
    stdout: 'partial output', stderr: 'command not found',
  });
  const exchange = buildTaskContext({ intent: interpret('명령을 실행해 주세요.'), selfState, receipts: [receipt] }).turnExchange[0];
  assert.equal(exchange.확인안됨, true, '실패 결과를 성공 data로 승격했다');
  assert.equal(exchange.실패결과.stdout, 'partial output');
  assert.equal(exchange.실패결과.stderr, 'command not found');
  assert.equal(exchange.실패결과.exitCode, 127);
  assert.equal(exchange.실패결과.cwd, '/isolated/work');
  assert.equal(exchange.data, undefined, '실패 결과를 확인된 성공 값으로 보냈다');
});

test('실제 local.terminal exit 127은 전달된 실패로 원시 결과를 보낸다', async () => {
  const terminal = makeLocalTerminalTool({
    cwd: '/isolated/work', sandboxAvailable: () => true,
    run: async (command, { cwd, mode }) => ({ command, cwd, mode, exitCode: 127, stdout: 'partial output', stderr: 'command not found' }),
  });
  const receipt = await new ToolRunner({ 'local.terminal': terminal }).run(
    'local.terminal', { command: 'missing-command' }, selfState,
  );
  assert.equal(receipt.actualCall?.tool, 'local.terminal');
  assert.equal(receipt.failureState, 'failed');
  assert.equal(receipt.lifecycle, 'delivered');
  assert.equal(receipt.result?.commandOutcome?.status, 'failure');
  assert.equal(receipt.result?.commandOutcome?.exitCode, 127);
  assert.equal(receipt.result?.processDelivery, 'delivered');
  assert.equal(receipt.result?.effects?.state, 'unknown');
  const exchange = buildTaskContext({ intent: interpret('명령을 실행해 주세요.'), selfState, receipts: [receipt] }).turnExchange[0];
  assert.equal(exchange.확인안됨, true);
  assert.equal(exchange.data, undefined);
  assert.equal(exchange.실패결과.stdout, 'partial output');
  assert.equal(exchange.실패결과.stderr, 'command not found');
  assert.equal(exchange.실패결과.processDelivery, 'delivered');
  assert.deepEqual(exchange.실패결과.effects, { state: 'unknown' });
});

test('실패한 terminal probe 원문은 모델에는 failureResult로만, 저장용 호출 인자에는 남기지 않는다', async () => {
  const terminal = makeLocalTerminalTool({
    cwd: '/isolated/work', sandboxAvailable: () => true,
    run: async (command, { cwd, mode }) => ({ command, cwd, mode, exitCode: 127, stdout: 'AUDIT_STDOUT', stderr: 'AUDIT_STDERR' }),
  });
  const receipt = await new ToolRunner({ 'local.terminal': terminal }).run(
    'local.terminal', {
      command: 'missing-command',
      probeResult: { stdout: 'AUDIT_STDOUT', stderr: 'AUDIT_STDERR' },
    }, selfState,
  );
  assert.deepEqual(receipt.actualCall?.args, { command: 'missing-command' },
    '공개 actualCall을 내부 probe placeholder로 위조했다');
  const exchange = buildTaskContext({ intent: interpret('명령을 실행해 주세요.'), selfState, receipts: [receipt] }).turnExchange[0];
  assert.equal(exchange.실패결과.stdout, 'AUDIT_STDOUT');
  assert.equal(exchange.실패결과.stderr, 'AUDIT_STDERR');
  assert.doesNotMatch(JSON.stringify(exchange.args), /AUDIT_STDOUT|AUDIT_STDERR/);
  assert.deepEqual(exchange.args, { command: 'missing-command' });
});

test('승인 전 차단 terminal probe 원문도 영수증 호출 인자에 저장하지 않는다', async () => {
  const terminal = makeLocalTerminalTool({
    cwd: '/isolated/work', sandboxAvailable: () => true,
    run: async (command, { cwd, mode }) => ({ command, cwd, mode, exitCode: 1, stdout: 'BLOCKED_STDOUT', stderr: 'BLOCKED_STDERR: Operation not permitted' }),
  });
  const receipt = await new ToolRunner({ 'local.terminal': terminal }).run(
    'local.terminal', {
      command: 'printf x > report.tsv',
      probeResult: { stdout: 'BLOCKED_STDOUT', stderr: 'BLOCKED_STDERR: Operation not permitted' },
    }, selfState,
  );
  assert.equal(receipt.failureState, 'blocked');
  assert.deepEqual(receipt.actualCall?.args, { command: 'printf x > report.tsv' },
    '차단 actualCall을 내부 probe placeholder로 위조했다');
});

test('실제 /turn 실패 원문은 같은 턴 모델에만 가고 HTTP·transcript·SessionStore 원장에는 남지 않는다', async () => {
  const state = await mkdtemp(join(tmpdir(), 'terminal-failure-durable-'));
  const modelInputs = [];
  let called = false;
  const model = {
    async respond(tc, opts = {}) {
      modelInputs.push(structuredClone(tc));
      if (tc?.workContractAssessment) {
        return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      }
      if (opts.tools?.length && !called) {
        called = true;
        return { text: '', toolCalls: [{
          providerCallId: 'call_terminal_failure', name: 'local.terminal',
          args: { command: 'missing-command' },
        }] };
      }
      return { text: '다른 방법을 확인해 볼게요.', toolCalls: [] };
    },
  };
  const terminal = makeLocalTerminalTool({
    cwd: '/actual/work', sandboxAvailable: () => true,
    run: async (command, { cwd, mode }) => ({
      command, cwd, mode, processDelivery: 'delivered', exitCode: 127,
      stdout: 'DURABLE_STDOUT_MARKER', stderr: 'DURABLE_STDERR_MARKER',
    }),
  });
  const store = new SessionStore(state);
  const server = makeServer({
    store,
    env: demoEnv({ include: ['local.terminal'], hands: ['local.terminal'] }),
    descriptors: demoDescriptors({ include: ['local.terminal'] }),
    tools: new ToolRunner({ 'local.terminal': terminal }), model,
    modelTimeoutMs: 0, processEnv: { GPAO_T5_TCELL: 'off' },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const cookie = ((await fetch(`${base}/`)).headers.get('set-cookie') ?? '').split(';')[0];
    const session = await (await fetch(`${base}/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}',
    })).json();
    const response = await (await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ sessionId: session.id, text: '없는 명령을 실행해줘' }),
    })).json();
    const saved = await store.load(session.id);
    const durableText = JSON.stringify(saved);
    const responseText = JSON.stringify(response);
    const modelText = JSON.stringify(modelInputs);
    assert.match(modelText, /DURABLE_STDOUT_MARKER/);
    assert.match(modelText, /DURABLE_STDERR_MARKER/);
    assert.match(modelText, /확인안됨|확인 안 됨/);
    assert.doesNotMatch(responseText, /DURABLE_STDOUT_MARKER|DURABLE_STDERR_MARKER/);
    assert.doesNotMatch(durableText, /DURABLE_STDOUT_MARKER|DURABLE_STDERR_MARKER/);
    assert.doesNotMatch(durableText, /probeResult|탐침 결과는 실패 영수증에만 있음/,
      '지속 세션 JSON에 내부 probe 또는 placeholder가 남았다');
    const failed = saved.ledgerEntries.find((entry) => entry?.actualCall?.tool === 'local.terminal');
    assert.ok(failed, '실패 실행의 공개 영수증이 지속 원장에서 사라졌다');
    assert.deepEqual(failed.actualCall.args, { command: 'missing-command' },
      '모델이 요청한 공개 호출 사실과 actualCall이 다르다');
    assert.equal(failed.failureState, 'failed');
    assert.equal(failed.result, undefined, '지속 원장에 같은 턴 전용 실패 관측이 남았다');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('실제 /turn 실패 뒤 쓰기 승인은 원문 없이 지속되고 재시작 뒤 정확히 한 번 실행된다', async () => {
  const state = await mkdtemp(join(tmpdir(), 'terminal-failure-pending-'));
  const modelInputs = [];
  const 실패명령 = 'missing-command';
  const 승인명령 = 'printf done > result.txt';
  let 승인실행수 = 0;
  const model = {
    async respond(tc, opts = {}) {
      modelInputs.push(structuredClone(tc));
      if (tc?.workContractAssessment) {
        return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      }
      if (!opts.tools?.length) return { text: '이어 실행했어요.', toolCalls: [] };
      const terminalSteps = (tc?.turnExchange ?? []).filter((step) => step?.tool === 'local.terminal');
      if (!terminalSteps.length) {
        return { text: '', toolCalls: [{
          providerCallId: 'call_failed_before_approval', name: 'local.terminal',
          args: { command: 실패명령 },
        }] };
      }
      if (!terminalSteps.some((step) => step?.args?.command === 승인명령)) {
        return { text: '실패를 확인했고 다른 걸음을 이어갈게요.', toolCalls: [{
          providerCallId: 'call_pending_after_failure', name: 'local.terminal',
          args: { command: 승인명령 },
        }] };
      }
      return { text: '이어 실행했어요.', toolCalls: [] };
    },
  };
  const terminal = makeLocalTerminalTool({
    cwd: '/actual/work', sandboxAvailable: () => true,
    run: async (command, { cwd, mode }) => {
      if (command === 실패명령) {
        return {
          command, cwd, mode, processDelivery: 'delivered', exitCode: 127,
          stdout: 'PENDING_FAILURE_STDOUT', stderr: 'PENDING_FAILURE_STDERR',
        };
      }
      if (mode === 'granted') 승인실행수 += 1;
      return mode === 'granted'
        ? { command, cwd, mode, processDelivery: 'delivered', exitCode: 0, stdout: 'done', stderr: '' }
        : {
          command, cwd, mode, processDelivery: 'delivered', exitCode: 1,
          stdout: 'PENDING_PROBE_STDOUT', stderr: 'PENDING_PROBE_STDERR: Operation not permitted',
        };
    },
  });
  const serverOptions = (store) => ({
    store,
    env: demoEnv({ include: ['local.terminal'], hands: ['local.terminal'] }),
    descriptors: demoDescriptors({ include: ['local.terminal'] }),
    tools: new ToolRunner({ 'local.terminal': terminal }), model,
    modelTimeoutMs: 0, processEnv: { GPAO_T5_TCELL: 'off' },
  });
  const post = (base, body) => fetch(`${base}/turn`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then((response) => response.json());

  const firstStore = new SessionStore(state);
  const firstServer = makeServer(serverOptions(firstStore));
  await new Promise((resolve) => firstServer.listen(0, '127.0.0.1', resolve));
  let sessionId;
  let pendingId;
  try {
    const base = `http://127.0.0.1:${firstServer.address().port}`;
    const session = await (await fetch(`${base}/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).json();
    sessionId = session.id;
    const pendingResponse = await post(base, { sessionId, text: '없는 명령을 실행하고 이어서 결과를 저장해줘' });
    pendingId = pendingResponse.pendingId;
    assert.equal(pendingResponse.kind, 'approval');
    assert.equal(승인실행수, 0, '승인 전에 실제 쓰기가 실행됐다');
    assert.doesNotMatch(JSON.stringify(pendingResponse), /PENDING_(?:FAILURE|PROBE)_(?:STDOUT|STDERR)/,
      'HTTP 승인 응답에 같은 턴 실행 원문이 샜다');

    const saved = await firstStore.load(sessionId);
    const pending = saved.pendingApprovals?.[pendingId];
    assert.ok(pending, '공개 pending 신분이 지속되지 않았다');
    assert.equal(pending.호출신분?.['local.terminal']?.providerCallId, 'call_pending_after_failure');
    assert.deepEqual(pending.호출신분?.['local.terminal']?.publicCallArgs, { command: 승인명령 });
    assert.equal(pending.intent?.toolArgs?.['local.terminal']?.command, 승인명령);
    assert.equal(pending.intent?.terminalOp?.command, 승인명령);
    assert.equal(pending.sendArgs?.['local.terminal']?.command, 승인명령);
    const pendingFailure = (pending.이미한걸음 ?? []).find((step) => step?.failureState === 'failed'
      && step?.actualCall?.tool === 'local.terminal');
    assert.ok(pendingFailure, '승인 전 실패 걸음이 관측되지 않았다');
    assert.equal(pendingFailure.subject?.key, `cmd:${실패명령}`, '전달된 실패 command subject가 사라졌다');
    assert.equal(saved.workingState?.subjects?.find((subject) => subject.key === `cmd:${실패명령}`)?.failed,
      true, '실패 subject가 지속 상태에서 성공처럼 풀렸다');
    const durableText = JSON.stringify(saved);
    assert.doesNotMatch(durableText, /PENDING_(?:FAILURE|PROBE)_(?:STDOUT|STDERR)/,
      '지속 pending에 같은 턴 전용 실패·probe 원문이 남았다');
    assert.doesNotMatch(durableText, /probeResult/,
      '지속 pending에 terminal 내부 probe가 남았다');
    assert.match(JSON.stringify(modelInputs), /PENDING_FAILURE_STDOUT/,
      '실행 실패 원문이 같은 턴 모델 관측에서 사라졌다');
    assert.match(JSON.stringify(modelInputs), /PENDING_FAILURE_STDERR/,
      '실행 실패 원문이 같은 턴 모델 관측에서 사라졌다');
  } finally {
    await new Promise((resolve) => firstServer.close(resolve));
  }

  const restartedStore = new SessionStore(state);
  const restartedServer = makeServer(serverOptions(restartedStore));
  await new Promise((resolve) => restartedServer.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${restartedServer.address().port}`;
    const reloaded = await (await fetch(`${base}/sessions/${sessionId}`)).json();
    assert.ok(reloaded.activePendingIds.includes(pendingId), '재시작 뒤 승인 대기가 사라졌다');
    const resumed = await post(base, { sessionId, approve: pendingId });
    assert.equal(resumed.kind, 'reply', '재시작 뒤 승인 실행이 다시 대기로 돌아갔다');
    assert.equal(승인실행수, 1, '승인한 terminal 쓰기가 정확히 한 번 실행되지 않았다');
    const saved = await restartedStore.load(sessionId);
    assert.deepEqual(saved.pendingApprovals, {}, '승인 실행 뒤 pending이 제거되지 않았다');
    const terminalReceipts = saved.ledgerEntries.filter((entry) => entry?.actualCall?.tool === 'local.terminal');
    assert.ok(terminalReceipts.some((entry) => entry.failureState === 'failed'
      && entry.actualCall.args?.command === 실패명령), '앞선 실패 사실이 성공처럼 풀렸다');
    assert.ok(terminalReceipts.some((entry) => entry.failureState === 'none'
      && entry.actualCall.args?.command === 승인명령), '승인한 실행의 성공 사실이 남지 않았다');
    assert.doesNotMatch(JSON.stringify(saved), /PENDING_(?:FAILURE|PROBE)_(?:STDOUT|STDERR)|probeResult/,
      '승인 완료 뒤 지속 세션에 같은 턴 전용 원문·probe가 남았다');
  } finally {
    await new Promise((resolve) => restartedServer.close(resolve));
  }
});

test('실제 runCommand는 프로세스 전달 실패를 delivered로 기록하지 않고 command subject로 올리지 않는다', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'terminal-delivery-'));
  const delivered = await runCommand('exit 9', { mode: 'raw', cwd });
  assert.equal(delivered.processDelivery, 'delivered');
  assert.equal(delivered.exitCode, 9);

  const missingCwd = join(cwd, 'does-not-exist');
  const notDelivered = await runCommand('exit 9', { mode: 'raw', cwd: missingCwd });
  assert.equal(notDelivered.processDelivery, 'not_delivered');
  assert.equal(notDelivered.exitCode, -1);

  const terminal = makeLocalTerminalTool({ cwd: missingCwd, run: runCommand, sandboxAvailable: () => true });
  const receipt = await new ToolRunner({ 'local.terminal': terminal }).run(
    'local.terminal', { command: 'exit 9', granted: true }, selfState,
  );
  assert.equal(receipt.lifecycle, 'failed', 'spawn 미전달을 delivered 수명으로 기록했다');
  assert.equal(receipt.result?.processDelivery, 'not_delivered');
  assert.equal(receipt.result?.applied, false, '프로세스 미전달을 적용된 실행으로 기록했다');
  assert.equal(receipt.subject, undefined, '프로세스에 전달되지 않은 명령을 command subject로 만들었다');
});

test('시간 제한 중단은 signal이 아니라 stopReason으로 기록한다', async () => {
  const terminal = makeLocalTerminalTool({
    cwd: '/isolated/work', sandboxAvailable: () => true,
    run: async (command, { cwd, mode }) => ({ command, cwd, mode, exitCode: 143, stopped: 'timeout', stdout: '', stderr: '' }),
  });
  const receipt = await new ToolRunner({ 'local.terminal': terminal }).run(
    'local.terminal', { command: 'long-job' }, selfState,
  );
  assert.equal(receipt.failureState, 'failed');
  assert.equal(receipt.result?.commandOutcome?.status, 'stopped');
  assert.equal(receipt.result?.commandOutcome?.exitCode, null);
  assert.equal(receipt.result?.commandOutcome?.signal, null);
  assert.equal(receipt.result?.commandOutcome?.stopReason, 'timeout');
});

test('명시적 failureResult 없는 실패 도구의 내부 result는 모델 교환에 노출하지 않는다', async () => {
  const receipt = await new ToolRunner({
    other: { async handler() { return { failed: true, result: { internalSecret: 'do-not-expose' }, userSafeSummary: '실패' }; } },
  }).run('other', {}, buildSelfState({ model: { id: 'test' }, connections: [{ id: 'other', connected: true, executable: true }] }));
  assert.equal(receipt.result, undefined);
  const exchange = buildTaskContext({ intent: interpret('실행해 주세요.'), selfState, receipts: [receipt] }).turnExchange[0];
  assert.doesNotMatch(JSON.stringify(exchange), /do-not-expose/);
});
