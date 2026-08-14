import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { interpret } from '../src/kernel/l1-intent/intent.js';

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
          result: {
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
