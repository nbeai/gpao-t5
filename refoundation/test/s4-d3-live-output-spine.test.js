import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeTerminalHand } from '../src/exec-tool.js';
import { ManagedProcessRegistry } from '../src/managed-process.js';
import { makeTerminalOutputTool, TerminalOutputStore } from '../src/terminal-output-store.js';

const effect = { kind: 'observe', targets: [], confirmation: 'not_applicable', rollbackOfToolCallId: null };
const args = (overrides = {}) => ({ action: 'list', command: null, cwd: null, effect: null,
  processId: null, cursor: null, input: null, end: null, waitMs: null, cols: null, rows: null,
  handle: null, stream: null, offset: null, limit: null, ...overrides });

async function fixture(run, { breakAppend = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 't5-s4d3-live-output-'));
  const directory = join(root, 'output');
  const store = new TerminalOutputStore(directory);
  if (breakAppend) store.append = async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
  const registry = new ManagedProcessRegistry({ outputLimit: 128 });
  const hand = makeTerminalHand({ workingDirectory: root, workspace: root,
    ownerId: 'session-a', originRunId: 'run-a', yieldMs: 10,
    terminalOutputStore: store, processRegistry: registry });
  const session = hand.tools.find((tool) => tool.name === 'terminal_session');
  try { await run({ root, directory, store, registry, session }); }
  finally { await registry.stopAll('test_cleanup'); await rm(root, { recursive: true, force: true }); }
}

async function pollUntil(session, started, predicate) {
  let current = started;
  for (let attempt = 0; attempt < 20 && !predicate(current); attempt += 1) {
    current = await session.execute(args({ action: 'poll', processId: started.processId,
      cursor: current.cursor, waitMs: 1000 }));
  }
  return current;
}

async function readAll(store, handle, sessionId, stream) {
  let offset = 0; let text = '';
  do {
    const range = await store.read({ handle, sessionId, stream, offset, limit: 16000 });
    text += range.text; offset = range.nextOffset;
  } while (offset != null);
  return text;
}

test('S4-D3 RED: running 1MiB+ stdout·stderr를 시작 때 받은 handle로 exact reopen한다', {
  timeout: 5000,
}, () => fixture(async ({ directory, session }) => {
  const code = [
    "process.stdout.write('OUT-EARLY-'+'o'.repeat(1100000)+'-OUT-TAIL')",
    "process.stderr.write('ERR-EARLY-'+'e'.repeat(1100000)+'-ERR-TAIL')",
    'setTimeout(()=>process.exit(0),3000)',
  ].join(';');
  const started = await session.execute(args({ action: 'start',
    command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(code)}`, effect }));
  assert.equal(started.state, 'running');
  assert.ok(started.outputRecall?.handle);
  const observed = await pollUntil(session, started,
    (value) => value.outputRecall?.cursor?.stdout >= 1100000
      && value.outputRecall?.cursor?.stderr >= 1100000);
  assert.equal(observed.state, 'running');
  const stdout = await session.execute(args({ action: 'read_output',
    handle: started.outputRecall.handle, stream: 'stdout', offset: 0, limit: 32 }));
  const stderr = await session.execute(args({ action: 'read_output',
    handle: started.outputRecall.handle, stream: 'stderr', offset: 0, limit: 32 }));
  assert.match(stdout.text, /^OUT-EARLY-/u); assert.match(stderr.text, /^ERR-EARLY-/u);
  const restartedStore = new TerminalOutputStore(directory);
  assert.match((await restartedStore.read({ handle: started.outputRecall.handle,
    sessionId: 'session-a', stream: 'stdout', offset: 0, limit: 32 })).text, /^OUT-EARLY-/u);
  const terminal = await pollUntil(session, observed, (value) => value.state !== 'running');
  assert.equal(terminal.state, 'completed');
  assert.equal(terminal.outputRecall.handle, started.outputRecall.handle);
  assert.equal(terminal.exactOutputRecallUnavailable, undefined);
  const tail = await session.execute(args({ action: 'read_output',
    handle: started.outputRecall.handle, stream: 'stdout', offset: 1100000, limit: 64 }));
  assert.match(tail.text, /OUT-TAIL$/u);
  const exactStdout = await readAll(restartedStore, started.outputRecall.handle, 'session-a', 'stdout');
  const exactStderr = await readAll(restartedStore, started.outputRecall.handle, 'session-a', 'stderr');
  const expectedStdout = `OUT-EARLY-${'o'.repeat(1100000)}-OUT-TAIL`;
  const expectedStderr = `ERR-EARLY-${'e'.repeat(1100000)}-ERR-TAIL`;
  assert.equal(createHash('sha256').update(exactStdout).digest('hex'),
    createHash('sha256').update(expectedStdout).digest('hex'));
  assert.equal(createHash('sha256').update(exactStderr).digest('hex'),
    createHash('sha256').update(expectedStderr).digest('hex'));
}));

test('S4-D3 RED: Unicode chunk 경계와 foreign Session owner를 같은 live handle에서 보존한다', {
  timeout: 5000,
}, () => fixture(async ({ store, session }) => {
  const code = "process.stdout.write('a'.repeat(63999)+'😀-UNICODE-'+'b'.repeat(70000));setTimeout(()=>process.exit(0),400)";
  const started = await session.execute(args({ action: 'start',
    command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(code)}`, effect }));
  assert.ok(started.outputRecall?.handle);
  const observed = await pollUntil(session, started,
    (value) => value.outputRecall?.cursor?.stdout > 130000);
  const range = await session.execute(args({ action: 'read_output',
    handle: started.outputRecall.handle, stream: 'stdout', offset: 63995, limit: 32 }));
  assert.match(range.text, /aaaa😀-UNICODE-/u);
  const foreign = makeTerminalOutputTool({ store, sessionId: 'session-b' });
  await assert.rejects(() => foreign.execute({ handle: started.outputRecall.handle,
    stream: 'stdout', offset: 0, limit: 20 }), /not found/u);
  await pollUntil(session, observed, (value) => value.state !== 'running');
}));

test('S4-D3 RED: live spool disk failure는 process 성공과 exact output 성공을 합치지 않는다', {
  timeout: 5000,
}, () => fixture(async ({ session }) => {
  const started = await session.execute(args({ action: 'start',
    command: "printf 'still-runs'; sleep 0.05", effect }));
  const terminal = await pollUntil(session, started, (value) => value.state !== 'running');
  assert.equal(terminal.state, 'completed');
  assert.equal(terminal.processExitCode, 0);
  assert.equal(terminal.exactOutputRecallUnavailable, true);
  assert.equal(terminal.outputRecall?.state, 'degraded');
}, { breakAppend: true }));

test('S4-D3 Runtime stop은 partial live spool을 같은 handle로 finalize한다', {
  timeout: 5000,
}, () => fixture(async ({ session }) => {
  const code = "process.stdout.write('BEFORE-STOP-'+'x'.repeat(1100000));setTimeout(()=>process.exit(0),5000)";
  const started = await session.execute(args({ action: 'start',
    command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(code)}`, effect }));
  const observed = await pollUntil(session, started,
    (value) => value.outputRecall?.cursor?.stdout >= 1100000);
  const stopped = await session.execute(args({ action: 'stop', processId: started.processId,
    cursor: observed.cursor }));
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.outputRecall.handle, started.outputRecall.handle);
  assert.equal(stopped.outputRecall.state, 'finalized');
  const reopened = await session.execute(args({ action: 'read_output',
    handle: started.outputRecall.handle, stream: 'stdout', offset: 0, limit: 32 }));
  assert.match(reopened.text, /^BEFORE-STOP-/u);
}));

test('S4-D3 PTY와 짧은 managed command도 시작부터 같은 output handle을 유지한다', {
  timeout: 5000,
}, () => fixture(async ({ session }) => {
  const short = await session.execute(args({ action: 'start', command: "printf 'short-output'", effect }));
  const shortTerminal = await pollUntil(session, short, (value) => value.state !== 'running');
  assert.ok(short.outputRecall?.handle); assert.equal(shortTerminal.outputRecall.handle, short.outputRecall.handle);
  assert.match((await session.execute(args({ action: 'read_output', handle: short.outputRecall.handle,
    stream: 'stdout', offset: 0, limit: 32 }))).text, /short-output/u);

  const pty = await session.execute(args({ action: 'start_tty', command: "printf 'pty-output'; sleep 1",
    effect, cols: 80, rows: 24 }));
  const ptyObserved = await pollUntil(session, pty,
    (value) => value.outputRecall?.cursor?.stdout > 0);
  assert.ok(pty.outputRecall?.handle);
  assert.match((await session.execute(args({ action: 'read_output', handle: pty.outputRecall.handle,
    stream: 'stdout', offset: 0, limit: 32 }))).text, /pty-output/u);
  const ptyStopped = await session.execute(args({ action: 'stop', processId: pty.processId,
    cursor: ptyObserved.cursor }));
  assert.equal(ptyStopped.outputRecall.handle, pty.outputRecall.handle);
}));
