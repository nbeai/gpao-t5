import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { interpret } from '../src/kernel/l1-intent/intent.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';

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
  assert.match(exchange.실패결과, /partial output/);
  assert.match(exchange.실패결과, /command not found/);
  assert.match(exchange.실패결과, /127/);
  assert.match(exchange.실패결과, /isolated\/work/);
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
  assert.match(exchange.실패결과, /partial output/);
  assert.match(exchange.실패결과, /command not found/);
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
  assert.doesNotMatch(JSON.stringify(receipt.actualCall?.args), /AUDIT_STDOUT|AUDIT_STDERR/);
  const exchange = buildTaskContext({ intent: interpret('명령을 실행해 주세요.'), selfState, receipts: [receipt] }).turnExchange[0];
  assert.match(exchange.실패결과, /AUDIT_STDOUT/);
  assert.match(exchange.실패결과, /AUDIT_STDERR/);
  assert.doesNotMatch(JSON.stringify(exchange.args), /AUDIT_STDOUT|AUDIT_STDERR/);
  assert.match(JSON.stringify(exchange.args), /확인되지 않은 탐침 결과/);
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
  assert.doesNotMatch(JSON.stringify(receipt.actualCall?.args), /BLOCKED_STDOUT|BLOCKED_STDERR/);
  assert.match(JSON.stringify(receipt.actualCall?.args), /탐침 결과는 실패 영수증에만 있음/);
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
