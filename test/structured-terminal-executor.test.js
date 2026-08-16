import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { demoDescriptors, demoEnv, demoTools } from '../src/surface/demo-context.js';
import { runTurn } from '../src/kernel/turn.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { interpret } from '../src/kernel/l1-intent/intent.js';
import { sandboxProfile } from '../src/runtime/sandbox.js';
import { TruthLedger } from '../src/kernel/l0-evidence/ledger.js';

const terminalModule = await import('../src/runtime/terminal-run.js');
const runProgram = terminalModule.runProgram;

const state = () => buildSelfState(demoEnv({
  include: ['local.terminal'], hands: ['local.terminal'],
}));

test('RED: structured single-process executor가 존재한다', () => {
  assert.equal(typeof runProgram, 'function');
});

test('A1 RED: structured profile은 deny-default capability profile이다', () => {
  const profile = sandboxProfile('structured', { secrets: [] });
  assert.match(profile, /^\(version 1\)\n\(deny default\)/);
  assert.doesNotMatch(profile, /\(allow default\)/);
});

test('A2 RED: 실행 결과는 profile 적용과 target-start를 구조 사실로 증명한다', async () => {
  const out = await runProgram('/usr/bin/printf', ['proof'], { cwd: '/tmp' });
  assert.equal(out.enforcement?.profileApplied, true);
  assert.equal(out.enforcement?.targetStarted, true);
  assert.equal(out.processDelivery, 'delivered');
});

test('A3 RED: shell과 delegator는 structured leaf 실행기로 열리지 않는다', async () => {
  for (const executable of ['/bin/sh', '/bin/zsh', '/usr/bin/env']) {
    const out = await runProgram(executable, ['-c', 'printf bypass'], { cwd: '/tmp' });
    assert.equal(out.processDelivery, 'not_run', executable);
    assert.notEqual(out.enforcement?.state, 'enforced', executable);
  }
});

test('A4 RED: 성공·실패 terminal raw는 TruthLedger durable entries에 남지 않는다', async () => {
  const success = await new ToolRunner({ 'local.terminal': makeLocalTerminalTool({ runProgram: async (executable, argv, opts) => ({
    executable, argv, cwd: opts.cwd, exitCode: 0, stdout: 'LEDGER_SUCCESS_RAW', stderr: '',
    processDelivery: 'delivered', effects: { state: 'none' },
    enforcement: { state: 'enforced', profileApplied: true, targetStarted: true },
  }) }) }).run('local.terminal', { executable: '/usr/bin/printf', argv: ['safe'], cwd: '/tmp' }, state());
  const failure = await new ToolRunner({ 'local.terminal': makeLocalTerminalTool({ runProgram: async (executable, argv, opts) => ({
    executable, argv, cwd: opts.cwd, exitCode: 9, stdout: '', stderr: 'LEDGER_FAILURE_RAW',
    processDelivery: 'delivered', effects: { state: 'none' },
    enforcement: { state: 'enforced', profileApplied: true, targetStarted: true },
  }) }) }).run('local.terminal', { executable: '/usr/bin/false', argv: [], cwd: '/tmp' }, state());
  const ledger = new TruthLedger(); ledger.append(success); ledger.append(failure);
  assert.doesNotMatch(JSON.stringify(ledger.entries), /LEDGER_SUCCESS_RAW|LEDGER_FAILURE_RAW/);
});

test('A5 RED: missing executable은 target-start 없이 not_run이다', async () => {
  const out = await runProgram('/definitely/missing/t5-stage1', [], { cwd: '/tmp' });
  assert.equal(out.processDelivery, 'not_run');
  assert.equal(out.enforcement?.targetStarted, false);
});

test('A6 RED: Q1 pass는 structured target-start와 계산 stdout을 필수로 센다', async () => {
  const source = await readFile(new URL('../scripts/terminal-qualification/s1-live.mjs', import.meta.url), 'utf8');
  assert.match(source, /targetStarted/);
  assert.match(source, /calculationStdout/);
  assert.match(source, /report\.pass[^;]+targetStarted[^;]+calculationStdout/s);
});

test('RED: 모델 스키마는 provider-neutral executable/argv/cwd를 요구하고 command를 노출하지 않는다', () => {
  const terminal = demoDescriptors().find((tool) => tool.id === 'local.terminal');
  assert.deepEqual(terminal.schema.parameters.required, ['executable', 'argv']);
  assert.ok(terminal.schema.parameters.properties.executable);
  assert.ok(terminal.schema.parameters.properties.argv);
  assert.equal(terminal.schema.parameters.properties.command, undefined);
});

test('RED: legacy command는 실제 실행하지 않고 구조화 호출 안내와 not_run 사실을 남긴다', async () => {
  let runs = 0;
  const tool = makeLocalTerminalTool({ sandboxAvailable: () => true, run: async () => {
    runs += 1;
    return { exitCode: 0, stdout: 'legacy-ran', stderr: '' };
  } });
  const out = await tool.handler({ command: 'printf legacy' });
  assert.equal(runs, 0);
  assert.equal(out.blocked, true);
  assert.equal(out.failureResult.processDelivery, 'not_run');
  assert.match(JSON.stringify(out), /executable|argv/);
});

test('RED: structured 성공은 정확히 한 번 실행되고 stdout/stderr/cwd/effects를 보존한다', async () => {
  let calls = 0;
  const cwd = await mkdtemp(join(tmpdir(), 't5-structured-once-'));
  const tool = makeLocalTerminalTool({ runProgram: async (spec) => {
    calls += 1;
    return { ...spec, exitCode: 0, stdout: 'ok\n', stderr: '', processDelivery: 'delivered',
      effects: { state: 'none', basis: 'structured_sandbox' },
      enforcement: { state: 'enforced', policy: 'single-process-no-effects' } };
  } });
  const out = await tool.handler({ executable: '/usr/bin/printf', argv: ['ok\n'], cwd });
  assert.equal(calls, 1);
  assert.deepEqual(out.result, {
    executable: '/usr/bin/printf', argv: ['ok\n'], cwd, exitCode: 0, stdout: 'ok\n', stderr: '',
    processDelivery: 'delivered', effects: { state: 'none', basis: 'structured_sandbox' }, applied: false,
  });
});

test('RED: structured nonzero 원시는 같은 턴 모델에 가고 durable 영수증에는 남지 않는다', async () => {
  const cwd = '/isolated/work';
  const tool = makeLocalTerminalTool({ runProgram: async (spec) => ({ ...spec, exitCode: 23,
    stdout: 'PRIVATE_STDOUT', stderr: 'PRIVATE_STDERR', processDelivery: 'delivered',
    effects: { state: 'none', basis: 'structured_sandbox' },
    enforcement: { state: 'enforced', policy: 'single-process-no-effects' } }) });
  const receipt = await new ToolRunner({ 'local.terminal': tool }).run('local.terminal', {
    executable: '/usr/bin/false', argv: [], cwd,
  }, state());
  assert.equal(receipt.failureState, 'failed');
  assert.equal(receipt.result.exitCode, 23);
  const tc = buildTaskContext({ intent: interpret('실패를 확인해줘'), selfState: state(), receipts: [receipt] });
  assert.match(JSON.stringify(tc.turnExchange), /PRIVATE_STDOUT/);
  assert.match(JSON.stringify(tc.turnExchange), /PRIVATE_STDERR/);
  assert.doesNotMatch(JSON.stringify({ ...receipt, result: undefined }), /PRIVATE_STDOUT|PRIVATE_STDERR/);
});

test('RED: enforcement가 없으면 structured program을 실행하지 않고 not_run으로 닫는다', async () => {
  let calls = 0;
  const tool = makeLocalTerminalTool({ sandboxAvailable: () => false, runProgram: async () => {
    calls += 1;
    throw new Error('must not run');
  } });
  const out = await tool.handler({ executable: '/usr/bin/printf', argv: ['x'], cwd: '/tmp' });
  assert.equal(calls, 0);
  assert.equal(out.blocked, true);
  assert.equal(out.failureResult.processDelivery, 'not_run');
});

test('RED: 실제 runTurn은 승인 없이 정확히 한 번 실행하고 같은 턴에 nonzero 원시 사실을 돌려준다', async () => {
  let executions = 0;
  const seen = [];
  let chose = false;
  const model = {
    async respond(tc, opts = {}) {
      seen.push(JSON.stringify(tc));
      if (!chose && opts.tools?.length) {
        chose = true;
        return { text: '', toolCalls: [{ name: 'local.terminal', args: {
          executable: '/usr/bin/false', argv: [], cwd: '/tmp',
        } }] };
      }
      return opts.tools?.length ? { text: '원시 결과를 확인했어요.', toolCalls: [] } : '원시 결과를 확인했어요.';
    },
  };
  const localTerminal = makeLocalTerminalTool({ runProgram: async (executable, argv, opts) => {
    executions += 1;
    return { executable, argv, cwd: opts.cwd, exitCode: 19, stdout: 'TURN_PRIVATE_OUT',
      stderr: 'TURN_PRIVATE_ERR', processDelivery: 'delivered',
      effects: { state: 'none', basis: 'structured_sandbox' },
      enforcement: { state: 'enforced', policy: 'single-process-no-effects' } };
  } });
  const out = await runTurn({ text: '구조화 실행해줘' }, {
    env: demoEnv(), model, tools: demoTools({ localTerminal }),
  });
  assert.notEqual(out.kind, 'approval');
  assert.equal(executions, 1);
  assert.match(seen.join('\n'), /TURN_PRIVATE_OUT/);
  assert.match(seen.join('\n'), /TURN_PRIVATE_ERR/);
  assert.match(seen.join('\n'), /"exitCode":19/);
  assert.match(seen.join('\n'), /"processDelivery":"delivered"/);
  assert.match(seen.join('\n'), /structured_sandbox/);
  assert.doesNotMatch(JSON.stringify(out), /TURN_PRIVATE_OUT|TURN_PRIVATE_ERR/);
});

test('RED: 실제 runTurn success도 승인 없이 한 번 실행되고 같은 턴 모델에 전달된다', async () => {
  let executions = 0;
  const seen = [];
  let chose = false;
  const model = { async respond(tc, opts = {}) {
    seen.push(JSON.stringify(tc));
    if (!chose && opts.tools?.length) {
      chose = true;
      return { text: '', toolCalls: [{ name: 'local.terminal', args: {
        executable: '/usr/bin/printf', argv: ['SAFE_ARG'], cwd: '/tmp',
      } }] };
    }
    return opts.tools?.length ? { text: '확인했어요.', toolCalls: [] } : '확인했어요.';
  } };
  const localTerminal = makeLocalTerminalTool({ runProgram: async (executable, argv, opts) => {
    executions += 1;
    return { executable, argv, cwd: opts.cwd, exitCode: 0, stdout: 'SUCCESS_PRIVATE', stderr: '',
      processDelivery: 'delivered', effects: { state: 'none', basis: 'structured_sandbox' },
      enforcement: { state: 'enforced', policy: 'single-process-no-effects' } };
  } });
  const out = await runTurn({ text: '구조화 실행해줘' }, {
    env: demoEnv(), model, tools: demoTools({ localTerminal }),
  });
  assert.notEqual(out.kind, 'approval');
  assert.equal(executions, 1);
  assert.match(seen.join('\n'), /SUCCESS_PRIVATE/);
  assert.doesNotMatch(JSON.stringify(out), /SUCCESS_PRIVATE/);
});

const actual = (name, fn) => test(`RED actual-host: ${name}`, { skip: process.platform !== 'darwin' }, async (t) => {
  assert.equal(typeof runProgram, 'function');
  await fn(t);
});
const assertStarted = (out) => {
  assert.equal(out.enforcement?.profileApplied, true);
  assert.equal(out.enforcement?.targetStarted, true);
  assert.equal(out.processDelivery, 'delivered');
};

actual('read/find/rg/awk/python 계산이 성공한다', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 't5-structured-read-'));
  await writeFile(join(cwd, 'rows.tsv'), 'a\t2\nb\t3\n');
  const rgCandidates = ['/Applications/ChatGPT.app/Contents/Resources/rg', '/opt/homebrew/bin/rg', '/usr/local/bin/rg'];
  let rgExecutable;
  for (const candidate of rgCandidates) {
    try { await access(candidate); rgExecutable = candidate; break; } catch { /* try next installed path */ }
  }
  assert.ok(rgExecutable, 'actual-host rg executable is required');
  for (const spec of [
    { executable: '/bin/cat', argv: ['rows.tsv'], expect: /a\t2/ },
    { executable: '/usr/bin/find', argv: ['.', '-name', 'rows.tsv'], expect: /rows\.tsv/ },
    { executable: rgExecutable, argv: ['a', 'rows.tsv'], expect: /a\t2/ },
    { executable: '/usr/bin/awk', argv: ['-F', '\t', '{s+=$2} END{print s}', 'rows.tsv'], expect: /^5\s*$/ },
    { executable: '/usr/bin/python3', argv: ['-c', 'print(sum([2,3]))'], expect: /^5\s*$/ },
  ]) {
    const out = await runProgram(spec.executable, spec.argv, { cwd });
    assertStarted(out);
    assert.equal(out.exitCode, 0, out.stderr);
    assert.match(out.stdout, spec.expect);
  }
});

actual('파일 write/fork/background/setsid 효과가 0이다', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 't5-structured-effects-'));
  const target = join(cwd, 'effect.txt');
  const programs = [
    ['open(target,"w").write("write")'],
    ['import os; p=os.fork(); print("CHILD" if p==0 else "PARENT")'],
    ['import subprocess; subprocess.Popen(["/usr/bin/printf","BACKGROUND"])'],
    ['import os; os.setsid(); p=os.fork(); print("SETSID_CHILD" if p==0 else "SETSID_PARENT")'],
  ];
  for (const [code] of programs) {
    const out = await runProgram('/usr/bin/python3', ['-c', code.replaceAll('target', JSON.stringify(target))], { cwd });
    assertStarted(out);
    assert.doesNotMatch(out.stdout, /CHILD|BACKGROUND|SETSID_CHILD|SETSID_PARENT/);
  }
  await assert.rejects(access(target));
});

actual('TCP와 Unix IPC 전달이 0이다', async (t) => {
  let tcpBytes = 0;
  const server = createServer((socket) => socket.on('data', (data) => { tcpBytes += data.length; }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const port = server.address().port;
  assertStarted(await runProgram('/usr/bin/python3', ['-c', `import socket;s=socket.socket();s.connect(("127.0.0.1",${port}));s.send(b"x")`], { cwd: '/tmp' }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(tcpBytes, 0);

  const cwd = await mkdtemp(join(tmpdir(), 't5-structured-unix-'));
  const socketPath = join(cwd, 'observer.sock');
  let unixBytes = 0;
  const unix = createServer((socket) => socket.on('data', (data) => { unixBytes += data.length; }));
  unix.listen(socketPath);
  await once(unix, 'listening');
  t.after(() => unix.close());
  assertStarted(await runProgram('/usr/bin/python3', ['-c', `import socket;s=socket.socket(socket.AF_UNIX);s.connect(${JSON.stringify(socketPath)});s.send(b"x")`], { cwd }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(unixBytes, 0);
});

actual('Mach IPC/AppleEvent/clipboard 효과가 0이다', async (t) => {
  const topic = `com.gpao.t5.stage1.${process.pid}.${Date.now()}`;
  const observer = spawn('/usr/bin/notifyutil', ['-1', topic]);
  let machNotifications = '';
  observer.stdout.on('data', (data) => { machNotifications += data; });
  t.after(() => observer.kill('SIGKILL'));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assertStarted(await runProgram('/usr/bin/notifyutil', ['-p', topic], { cwd: '/tmp' }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(machNotifications, '');
  assert.equal(observer.exitCode, null);

  const marker = `T5_STAGE1_${process.pid}`;
  const before = await new Promise((resolve) => {
    const p = spawn('/usr/bin/pbpaste', []); let out = '';
    p.stdout.on('data', (d) => { out += d; }); p.on('close', () => resolve(out));
  });
  assertStarted(await runProgram('/usr/bin/osascript', ['-e', `set the clipboard to "${marker}"`], { cwd: '/tmp' }));
  const after = await new Promise((resolve) => {
    const p = spawn('/usr/bin/pbpaste', []); let out = '';
    p.stdout.on('data', (d) => { out += d; }); p.on('close', () => resolve(out));
  });
  assert.equal(after, before);
  assert.notEqual(after, marker);
});

actual('외부 signal 대상이 생존하고 전달 0이다', async (t) => {
  const sleeper = spawn('/bin/sleep', ['30']);
  t.after(() => sleeper.kill('SIGKILL'));
  assertStarted(await runProgram('/bin/kill', ['-TERM', String(sleeper.pid)], { cwd: '/tmp' }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(sleeper.exitCode, null);
});

actual('지정 secret 원문을 읽지 못한다', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 't5-structured-secret-'));
  const secret = join(cwd, 'secret.txt');
  await writeFile(secret, 'TOP_SECRET_STAGE1');
  const out = await runProgram('/bin/cat', [secret], { cwd, secrets: [secret] });
  assertStarted(out);
  assert.doesNotMatch(`${out.stdout}\n${out.stderr}`, /TOP_SECRET_STAGE1/);
  assert.equal(await readFile(secret, 'utf8'), 'TOP_SECRET_STAGE1');
});
