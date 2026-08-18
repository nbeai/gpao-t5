import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeExecTool, makeProcessControlTool } from '../src/exec-tool.js';

async function rooms(fn) {
  const root = await mkdtemp(join(tmpdir(), 't5-exec-boundary-'));
  const workspace = join(root, 'workspace');
  const outside = join(root, 'outside');
  await Promise.all([mkdir(workspace), mkdir(outside)]);
  try { return await fn({ root, workspace, outside }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('exec는 부모 프로세스의 자격 환경변수를 셸에 상속하지 않는다', async () => rooms(async ({ workspace }) => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'must-not-reach-shell';
  try {
    const result = await makeExecTool({ workspace }).execute({
      command: 'if [ -z "${OPENAI_API_KEY+x}" ]; then printf clean; else printf leaked; fi',
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'clean');
    assert.doesNotMatch(result.stdout, /must-not-reach-shell/);
  } finally {
    if (previous == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
}));

test('기본 cwd는 능력 경계가 아니며 사용자가 지목한 접근 가능한 디렉터리로 이동한다', async () => rooms(async ({ workspace, outside }) => {
  const tool = makeExecTool({ workspace });
  const result = await tool.execute({ command: 'pwd', cwd: outside });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), await realpath(outside));
}));

test('exec는 오래 걸리는 명령을 거짓 timeout으로 만들지 않고 제어 가능한 handle을 돌려준다', async () => rooms(async ({ workspace }) => {
  const tool = makeExecTool({ workspace, yieldMs: 20 });
  const result = await tool.execute({ command: 'sleep 1', cwd: null });
  assert.equal(result.state, 'running');
  assert.ok(result.processId);
  const control = makeProcessControlTool({ processRegistry: tool.processRegistry });
  const stopped = await control.execute({
    action: 'stop', processId: result.processId, cursor: result.cursor, input: null, end: null, waitMs: null,
  });
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.terminationConfirmed, true);
}));

test('exec 결과에는 Tree-sitter가 읽은 명령 단계와 operator가 붙는다', async () => rooms(async ({ workspace }) => {
  const result = await makeExecTool({ workspace }).execute({
    command: "printf 'b\\na\\n' | sort && printf done",
    cwd: null,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.commandExplanation.ok, true);
  assert.deepEqual(result.commandExplanation.steps.map((step) => step.executable), ['printf', 'sort', 'printf']);
  assert.deepEqual(result.commandExplanation.operators.map((operator) => operator.kind), ['pipe', 'and']);
}));

test('명령 설명기가 실패해도 셸 실행 능력은 줄지 않는다', async () => rooms(async ({ workspace }) => {
  const result = await makeExecTool({
    workspace,
    explainCommand: async () => { throw new Error('parser unavailable'); },
  }).execute({ command: "printf 'still-ran'", cwd: null });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'still-ran');
  assert.deepEqual(result.commandExplanation, { ok: false, error: 'parser unavailable' });
}));
