import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeExecTool, makeProcessControlTool } from '../src/exec-tool.js';
import { makePtyStartTool } from '../src/pty-tool.js';

async function room(fn) {
  const root = await mkdtemp(join(tmpdir(), 't5-pty-'));
  try { return await fn(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

const TTY_PROGRAM = [
  "if (!process.stdin.isTTY) { console.error('TTY_REQUIRED'); process.exit(42); }",
  "process.stdout.write('Enter value: ');",
  "process.stdin.once('data', value => { console.log('TTY_VALUE [' + value.toString().trim() + ']'); process.exit(0); });",
].join(' ');

test('현재 pipe 기반 exec는 TTY-only 프로그램을 실제로 실행할 수 없다', async () => room(async (root) => {
  const result = await makeExecTool({ workspace: root }).execute({
    command: `${process.execPath} -e ${JSON.stringify(TTY_PROGRAM)}`, cwd: null,
    effect: { kind: 'observe', summary: 'TTY 확인', targets: [], reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null },
  });
  assert.equal(result.state, 'failed');
  assert.equal(result.exitCode, 42);
  assert.match(result.stderr, /TTY_REQUIRED/);
}));

test('PTY 명령이 첫 대기 안에 끝나면 현재 Turn이 이미 관측한 것으로 표시해 별도 wake를 만들지 않는다', async () => room(async (root) => {
  const exec = makeExecTool({ workspace: root });
  const pty = makePtyStartTool({
    workingDirectory: root, processRegistry: exec.processRegistry, ownerId: 'pty-immediate', yieldMs: 1000,
  });
  const result = await pty.execute({
    command: 'printf done', cwd: null,
    effect: { kind: 'observe', summary: '즉시 완료', targets: [], reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null },
    cols: 80, rows: 24,
  });
  assert.equal(result.state, 'completed');
  assert.equal(exec.processRegistry.claimTerminalWake(result.processId), null);
}));

test('pty_start는 같은 TTY-only 프로그램에 입력을 보내고 완료 출력을 관측한다', async () => room(async (root) => {
  const exec = makeExecTool({ workspace: root });
  const pty = makePtyStartTool({
    workingDirectory: root, processRegistry: exec.processRegistry, ownerId: 'pty-session', yieldMs: 50,
  });
  const started = await pty.execute({
    command: `${process.execPath} -e ${JSON.stringify(TTY_PROGRAM)}`, cwd: null,
    effect: { kind: 'observe', summary: 'TTY 대화', targets: [], reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null },
    cols: 80, rows: 24,
  });
  assert.equal(started.state, 'running');
  const control = makeProcessControlTool({ processRegistry: exec.processRegistry, ownerId: 'pty-session' });
  let current = started;
  let output = started.stdout;
  for (let attempt = 0; attempt < 5 && !output.includes('Enter value:'); attempt += 1) {
    current = await control.execute({
      action: 'poll', processId: started.processId, cursor: current.cursor,
      input: null, end: null, waitMs: 1000, cols: null, rows: null,
    });
    output += current.stdout;
  }
  assert.match(output, /Enter value:/);
  await control.execute({
    action: 'write', processId: started.processId, cursor: current.cursor,
    input: 'hello-pty\r', end: false, waitMs: null, cols: null, rows: null,
  });
  for (let attempt = 0; attempt < 10 && current.state === 'running'; attempt += 1) {
    current = await control.execute({
      action: 'poll', processId: started.processId, cursor: current.cursor,
      input: null, end: null, waitMs: 1000, cols: null, rows: null,
    });
    output += current.stdout;
  }
  assert.equal(current.state, 'completed');
  assert.equal(current.processExitCode, 0);
  assert.match(output, /TTY_VALUE \[hello-pty\]/);
}));

test('process_control resize는 실제 PTY의 stty geometry를 바꾼다', async () => room(async (root) => {
  const exec = makeExecTool({ workspace: root });
  const pty = makePtyStartTool({
    workingDirectory: root, processRegistry: exec.processRegistry, ownerId: 'pty-resize', yieldMs: 30,
  });
  let current = await pty.execute({
    command: "printf 'SIZE1 '; stty size; IFS= read -r value; printf 'SIZE2 '; stty size", cwd: null,
    effect: { kind: 'observe', summary: 'PTY 크기 확인', targets: [], reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null },
    cols: 80, rows: 24,
  });
  const control = makeProcessControlTool({ processRegistry: exec.processRegistry, ownerId: 'pty-resize' });
  let output = current.stdout;
  for (let attempt = 0; attempt < 5 && !output.includes('SIZE1'); attempt += 1) {
    current = await control.execute({
      action: 'poll', processId: current.processId, cursor: current.cursor,
      input: null, end: null, waitMs: 1000, cols: null, rows: null,
    });
    output += current.stdout;
  }
  assert.match(output, /SIZE1 24 80/);
  const resized = await control.execute({
    action: 'resize', processId: current.processId, cursor: current.cursor,
    input: null, end: null, waitMs: null, cols: 100, rows: 40,
  });
  assert.deepEqual({ cols: resized.cols, rows: resized.rows }, { cols: 100, rows: 40 });
  await control.execute({
    action: 'write', processId: current.processId, cursor: current.cursor,
    input: 'continue\r', end: false, waitMs: null, cols: null, rows: null,
  });
  for (let attempt = 0; attempt < 10 && current.state === 'running'; attempt += 1) {
    current = await control.execute({
      action: 'poll', processId: current.processId, cursor: current.cursor,
      input: null, end: null, waitMs: 1000, cols: null, rows: null,
    });
    output += current.stdout;
  }
  assert.match(output, /SIZE2 40 100/);
}));
