import test from 'node:test';
import assert from 'node:assert/strict';
import { access, chmod, mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeExecTool, makeProcessControlTool, makeProcessStartTool } from '../src/exec-tool.js';
import { ManagedProcessRegistry } from '../src/managed-process.js';
import { TerminalOutputStore } from '../src/terminal-output-store.js';

async function rooms(fn) {
  const root = await mkdtemp(join(tmpdir(), 't5-exec-boundary-'));
  const workspace = join(root, 'workspace');
  const outside = join(root, 'outside');
  await Promise.all([mkdir(workspace), mkdir(outside)]);
  try { return await fn({ root, workspace, outside }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('foreground exec는 observe만 completion optional이고 실제 효과는 Work completion을 유지한다', () => {
  const tool = makeExecTool({ workspace: process.cwd() });
  assert.equal(tool.completionProposalOptional({ effect: null }), true);
  assert.equal(tool.completionProposalOptional({ effect: { kind: 'observe' } }), true);
  assert.equal(tool.completionProposalOptional({ effect: { kind: 'local_change', targets: ['x'] } }), false);
  assert.equal(tool.completionProposalOptional({ effect: { kind: 'external_change' } }), false);
});

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

test('미래 작업을 foreground sleep으로 붙들려 하면 automation 경계에서 실행 전에 멈춘다', async () => rooms(async ({ workspace }) => {
  const tool = makeExecTool({ workspace, effectPreflight: async () => ({ allowed: true }) });
  const gate = await tool.preflight({
    command: 'sleep 285; printf publish', cwd: null,
    effect: { kind: 'observe', summary: '미래 대기', targets: [], reversible: true, backupAvailable: false, recipientNew: false, approvalToken: null },
  }, {});
  assert.equal(gate.allowed, false);
  assert.equal(gate.result.state, 'future_schedule_required');
  assert.equal(gate.result.delaySeconds, 285);
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

test('foreground shell background는 Runtime 밖 고아 process를 만들기 전에 managed foreground 경로로 돌린다', async () => rooms(async ({ workspace }) => {
  const marker = join(workspace, 'unowned-late-effect.txt');
  const exec = makeExecTool({ workspace });
  const result = await exec.execute({
    command: `(sleep 0.15; printf late > '${marker}') &`, cwd: null,
  });
  assert.equal(result.state, 'managed_process_required');
  assert.equal(result.exitCode, 125);
  assert.deepEqual(result.activatedTools, ['terminal_session']);
  await new Promise((resolve) => setTimeout(resolve, 220));
  await assert.rejects(() => access(marker));
}));

test('managed shell도 내부 background로 ownership을 다시 잃지 않고 실제 foreground command를 요구한다', async () => rooms(async ({ workspace }) => {
  const start = makeProcessStartTool({ workingDirectory: workspace });
  const result = await start.execute({ command: 'sleep 30 &', cwd: null });
  assert.equal(result.state, 'managed_process_background_forbidden');
  assert.equal(result.exitCode, 125);
  assert.deepEqual(result.activatedTools, ['terminal_session']);
  assert.equal(start.processRegistry.list('default').length, 0);
}));

test('제품 preflight는 background shell을 실행 전에 막고 기존 terminal_session을 즉시 연다', async () => rooms(async ({ workspace }) => {
  const exec = makeExecTool({ workspace, effectPreflight: async () => ({ allowed: true }) });
  const gate = await exec.preflight({
    command: 'python3 -m http.server 8765 >server.log 2>&1 & echo $! >server.pid', cwd: null,
    effect: { kind: 'local_change', targets: [workspace], confirmation: 'not_applicable', rollbackOfToolCallId: null },
  }, {});
  assert.equal(gate.allowed, false);
  assert.equal(gate.outcome, 'not_executed');
  assert.equal(gate.result.state, 'managed_process_required');
  assert.deepEqual(gate.result.activatedTools, ['terminal_session']);
  assert.match(gate.result.nextSafeAction, /foreground.*terminal_session start/u);
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

test('잘린 foreground output은 command 재실행 없이 exact 중간 구간을 recall한다', async () => rooms(async ({ root, workspace }) => {
  const registry = new ManagedProcessRegistry({ outputLimit: 64 });
  const outputs = new TerminalOutputStore(join(root, 'terminal-outputs'));
  const tool = makeExecTool({ workspace, processRegistry: registry, outputLimit: 64,
    terminalOutputStore: outputs, originRunId: 'run-output-recall', ownerId: 'session-output-recall' });
  const result = await tool.execute({
    command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
      "process.stdout.write('HEAD-' + 'x'.repeat(100) + '-MIDDLE-NEEDLE-' + 'y'.repeat(100) + '-TAIL')",
    )}`, cwd: null,
    effect: { kind: 'observe', summary: 'large output', targets: [], reversible: true,
      backupAvailable: false, recipientNew: false, approvalToken: null },
  });
  assert.equal(result.truncated, true);
  assert.ok(result.outputRecall?.handle);
  assert.deepEqual(result.activatedTools, ['terminal_output']);
  const full = await outputs.read({ handle: result.outputRecall.handle, sessionId: 'session-output-recall',
    stream: 'stdout', offset: 90, limit: 80 });
  assert.match(full.text, /MIDDLE-NEEDLE/u);
  assert.equal(result.stdout.includes('MIDDLE-NEEDLE'), false);
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

test('관리 CLI 경로는 로그인 셸 초기화 뒤에도 현재 T5 command에서만 우선한다', async () => rooms(async ({ workspace }) => {
  const bin = join(workspace, 'managed bin'); const executable = join(bin, 't5-json');
  await mkdir(bin); await writeFile(executable, '#!/bin/sh\nprintf managed-path', { mode: 0o700 }); await chmod(executable, 0o700);
  const result = await makeExecTool({ workspace, pathPrepend: bin }).execute({ command: 'command -v t5-json; t5-json', cwd: null });
  assert.equal(result.stdout, `${executable}\nmanaged-path`);
  assert.equal(process.env.PATH?.startsWith(bin), false);
}));

test('exec 영수증은 실행 시점에 확인된 managed capability identity만 결속한다', async () => rooms(async ({ workspace }) => {
  const tool = makeExecTool({ workspace, capabilityAttribution: async ({ commandExplanation }) => (
    commandExplanation.steps[0].executable === 't5-json'
      ? [{ kind: 'cli', id: 't5-json', version: '1.2.3', digest: 'a'.repeat(64) }] : []
  ) });
  const result = await tool.execute({ command: 't5-json --version', cwd: null });
  assert.deepEqual(result.capabilitiesUsed, [{ kind: 'cli', id: 't5-json', version: '1.2.3', digest: 'a'.repeat(64) }]);
}));

test('terminal은 T5 관리 브라우저의 제어 주소·CDP를 Browser Hand 밖에서 읽거나 조작하지 않는다', async () => rooms(async ({ workspace }) => {
  const protectedRoot = join(workspace, 'browser-host');
  const tool = makeExecTool({ workspace, protectedBrowserRoots: [protectedRoot] });
  for (const command of [
    `cat '${protectedRoot}/identity/default/profile/DevToolsActivePort'`,
    `python3 -c 'print("Runtime.evaluate Input.insertText")'`,
  ]) {
    await assert.rejects(() => tool.execute({
      command, cwd: null,
      effect: { kind: 'observe', summary: '브라우저 우회', targets: [], reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null },
    }), (error) => error?.code === 'T5_BROWSER_HAND_REQUIRED');
  }
  const normal = await tool.execute({ command: 'printf normal-terminal', cwd: null });
  assert.equal(normal.stdout, 'normal-terminal');
}));
