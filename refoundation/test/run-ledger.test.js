import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RunLedger } from '../src/run-ledger.js';

async function room(fn) {
  const root = await mkdtemp(join(tmpdir(), 't5-run-ledger-'));
  try { return await fn(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('Run·Step·Receipt는 순서 있는 append-only JSONL로 기록되고 재시작 뒤 복원된다', async () => room(async (root) => {
  const ledger = new RunLedger(root);
  const run = await ledger.start({ sessionId: 'session-1', request: '파일을 찾아줘' });
  await run.append({ type: 'model_started', stepId: 'model-1', payload: { turn: 1 } });
  const prefix = await readFile(run.file, 'utf8');
  const receipt = {
    toolCallId: 'call-1', requestedCall: { name: 'exec', args: { command: 'pwd', cwd: null } },
    actualCall: { name: 'exec', args: { command: 'pwd', cwd: null } },
    outcome: 'succeeded', result: { state: 'completed', exitCode: 0, stdout: '/tmp\n', stderr: '' },
  };
  await run.append({ type: 'tool_completed', stepId: 'tool-call-1', payload: { receipt } });
  await run.finish('completed', { modelTurns: 2 });

  const bytes = await readFile(run.file, 'utf8');
  assert.equal(bytes.startsWith(prefix), true);
  assert.equal((await stat(run.file)).mode & 0o777, 0o600);
  const lines = bytes.trimEnd().split('\n').map(JSON.parse);
  assert.deepEqual(lines.map((entry) => entry.sequence), [1, 2, 3, 4]);
  assert.deepEqual(lines.map((entry) => entry.type), [
    'run_started', 'model_started', 'tool_completed', 'run_completed',
  ]);
  assert.deepEqual(lines[2].payload.receipt, receipt);

  const reopened = new RunLedger(root);
  const restored = await reopened.read(run.runId);
  assert.equal(restored.status, 'completed');
  assert.equal(restored.sessionId, 'session-1');
  assert.equal(restored.request, '파일을 찾아줘');
  assert.deepEqual(restored.events, lines);
  assert.deepEqual((await reopened.list({ sessionId: 'session-1' })).map((entry) => entry.runId), [run.runId]);
}));

test('동시에 들어온 Step도 파일 안에서는 빠짐없는 단조 sequence가 된다', async () => room(async (root) => {
  const run = await new RunLedger(root).start({ sessionId: 'session-2', request: '둘을 실행해' });
  await Promise.all(Array.from({ length: 20 }, (_, index) => run.append({
    type: 'tool_started', stepId: `tool-${index}`, payload: { index },
  })));
  const restored = await new RunLedger(root).read(run.runId);
  assert.deepEqual(restored.events.map((entry) => entry.sequence), Array.from({ length: 21 }, (_, index) => index + 1));
}));

test('종료 이벤트 없이 남은 Run은 성공으로 꾸미지 않고 interrupted로 읽는다', async () => room(async (root) => {
  const run = await new RunLedger(root).start({ sessionId: 'session-3', request: '진행해' });
  await run.append({ type: 'model_started', stepId: 'model-1', payload: { turn: 1 } });
  const restored = await new RunLedger(root).read(run.runId);
  assert.equal(restored.status, 'interrupted');
}));

test('run_completed 뒤에는 실행 사건이 아니라 surface_metric 관측만 추가 append할 수 있다', async () => room(async (root) => {
  const run = await new RunLedger(root).start({ sessionId: 'session-4', request: '보이는 시간도 기록해' });
  await run.finish('completed');
  await run.append({
    type: 'surface_metric', payload: {
      event: 'turn_complete', elapsedMs: 321, visibilityState: 'visible',
    },
  });
  await assert.rejects(() => run.append({ type: 'tool_started', payload: {} }), /already finished/);
  const restored = await new RunLedger(root).read(run.runId);
  assert.equal(restored.status, 'completed');
  assert.equal(restored.events.at(-1).type, 'surface_metric');
  assert.deepEqual(restored.events.map((event) => event.sequence), [1, 2, 3]);
}));
