import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeExecTool, makeProcessControlTool, makeProcessStartTool } from '../src/exec-tool.js';
import { ManagedProcessRegistry } from '../src/managed-process.js';

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

test('foreground exec는 1초가 넘더라도 완료까지 기다려 전체 결과를 한 번에 돌려준다', async () => rooms(async ({ workspace }) => {
  const tool = makeExecTool({ workspace });
  const result = await tool.execute({ command: "sleep 1.05; printf 'foreground-complete'", cwd: null });
  assert.equal(result.state, 'completed');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'foreground-complete');
  assert.equal(result.processId, undefined);
}));

test('process_start만 실행 중 handle을 돌려주고 process_control로 이어진다', async () => rooms(async ({ workspace }) => {
  const exec = makeExecTool({ workspace });
  const start = makeProcessStartTool({
    workingDirectory: workspace, processRegistry: exec.processRegistry, yieldMs: 20,
  });
  const result = await start.execute({ command: 'sleep 1', cwd: null });
  assert.equal(result.state, 'running');
  assert.ok(result.processId);
  const control = makeProcessControlTool({ processRegistry: exec.processRegistry });
  const stopped = await control.execute({
    action: 'stop', processId: result.processId, cursor: result.cursor, input: null, end: null, waitMs: null,
  });
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.terminationConfirmed, true);
}));

test('foreground exec는 관리 spool보다 큰 출력도 전체의 처음과 끝을 보존해 자른다', async () => rooms(async ({ workspace }) => {
  const registry = new ManagedProcessRegistry({ spoolLimit: 32, outputLimit: 64 });
  const tool = makeExecTool({ workspace, processRegistry: registry, outputLimit: 64 });
  const result = await tool.execute({
    command: "printf 'BEGIN-'; printf '%0200d' 0; printf '%s' '-END'", cwd: null,
  });
  assert.equal(result.truncated, true);
  assert.match(result.stdout, /^BEGIN-/);
  assert.match(result.stdout, /-END$/);
  assert.equal(result.omittedChars, 146);
}));

test('foreground exec를 취소하면 기다림만 끝내지 않고 자식 프로세스 효과도 멈춘다', async () => rooms(async ({ workspace }) => {
  const marker = join(workspace, 'late-write.txt');
  const tool = makeExecTool({ workspace });
  const controller = new AbortController();
  const pending = tool.execute({
    command: `(sleep 0.4; printf late > '${marker}') & wait`, cwd: null,
  }, { signal: controller.signal });
  setTimeout(() => controller.abort(), 30);
  const result = await pending;
  assert.equal(result.state, 'stopped');
  assert.equal(result.terminationConfirmed, true);
  await new Promise((resolve) => setTimeout(resolve, 450));
  await assert.rejects(() => access(marker));
}));

test('process_control의 중첩 cursor 스키마는 strict function 계약을 만족한다', () => {
  const exec = makeExecTool({ workspace: '/private/tmp' });
  const control = makeProcessControlTool({ processRegistry: exec.processRegistry });
  assert.deepEqual(control.parameters.properties.cursor.required, ['stdout', 'stderr']);
});

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
