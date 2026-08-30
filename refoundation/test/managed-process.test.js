import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ManagedProcessRegistry } from '../src/managed-process.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function collectUntilTerminal(registry, initial, ownerId = 'session-a') {
  let current = initial;
  let stdout = initial.stdout;
  let stderr = initial.stderr;
  let deltaStdout = '';
  let deltaStderr = '';
  for (let attempt = 0; attempt < 10 && current.state === 'running'; attempt += 1) {
    current = await registry.poll({
      processId: initial.processId, cursor: current.cursor, ownerId, waitMs: 1000,
    });
    stdout += current.stdout;
    stderr += current.stderr;
    deltaStdout += current.stdout;
    deltaStderr += current.stderr;
  }
  return { ...current, stdout, stderr, deltaStdout, deltaStderr };
}

async function room(fn) {
  const root = await mkdtemp(join(tmpdir(), 't5-managed-process-'));
  const registry = new ManagedProcessRegistry({ stopGraceMs: 80, killGraceMs: 300 });
  try { return await fn({ root, registry }); }
  finally {
    await registry.stopAll('test_cleanup');
    await rm(root, { recursive: true, force: true });
  }
}

test('오래 걸리는 명령은 턴을 막지 않고 running handle을 돌려준 뒤 완료를 다시 관측한다', async () => room(async ({ root, registry }) => {
  const startedAt = Date.now();
  const started = await registry.start({
    program: '/bin/sh', args: ['-lc', "sleep 0.2; printf 'finished'"], cwd: root,
    env: process.env, ownerId: 'session-a', waitMs: 20,
  });
  assert.equal(started.state, 'running');
  assert.ok(started.processId);
  assert.ok(Date.now() - startedAt < 150);
  const completed = await collectUntilTerminal(registry, started);
  assert.equal(completed.state, 'completed');
  assert.equal(completed.exitCode, 0);
  assert.equal(completed.stdout, 'finished');
}));

test('poll cursor는 이미 본 출력이 아니라 새 출력만 돌려준다', async () => room(async ({ root, registry }) => {
  const started = await registry.start({
    program: '/bin/sh', args: ['-lc', "printf 'first'; IFS= read -r value; printf 'second'"], cwd: root,
    env: process.env, ownerId: 'session-a', waitMs: 0,
  });
  const first = await registry.poll({
    processId: started.processId, cursor: started.cursor, ownerId: 'session-a', waitMs: 1000,
  });
  assert.equal(first.stdout, 'first');
  registry.write({ processId: started.processId, input: 'continue\n', ownerId: 'session-a' });
  const next = await collectUntilTerminal(registry, first);
  assert.equal(next.deltaStdout, 'second');
  assert.equal(next.state, 'completed');
}));

test('실행 중 프로세스의 stdin에 값을 보내 결과를 얻는다', async () => room(async ({ root, registry }) => {
  const started = await registry.start({
    program: '/bin/sh', args: ['-lc', "IFS= read -r value; printf 'you typed [%s]' \"$value\""], cwd: root,
    env: process.env, ownerId: 'session-a', waitMs: 20,
  });
  assert.equal(started.state, 'running');
  const written = registry.write({ processId: started.processId, input: 'hello-t5\n', ownerId: 'session-a' });
  assert.equal(written.accepted, true);
  const completed = await collectUntilTerminal(registry, started);
  assert.equal(completed.stdout, 'you typed [hello-t5]');
  assert.equal(completed.state, 'completed');
}));

test('stop은 셸만이 아니라 stdout을 붙든 자식 프로세스까지 끝내고 종료를 확인한다', async () => room(async ({ root, registry }) => {
  const marker = join(root, 'orphan-wrote.txt');
  const started = await registry.start({
    program: '/bin/sh',
    args: ['-lc', `(sleep 0.3; printf orphan > '${marker}') & wait`],
    cwd: root, env: process.env, ownerId: 'session-a', waitMs: 20,
  });
  const stopped = await registry.stop({ processId: started.processId, ownerId: 'session-a', reason: 'user' });
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.terminationConfirmed, true);
  await delay(380);
  await assert.rejects(() => access(marker));
}));

test('다른 세션은 process handle을 관측하거나 제어할 수 없다', async () => room(async ({ root, registry }) => {
  const started = await registry.start({
    program: '/bin/sh', args: ['-lc', 'sleep 1'], cwd: root,
    env: process.env, ownerId: 'session-a', waitMs: 20,
  });
  await assert.rejects(
    () => registry.poll({ processId: started.processId, ownerId: 'session-b' }),
    /process not found/,
  );
}));

test('process_start가 running으로 반환된 뒤 생긴 terminal 상태는 한 번만 wake 대상으로 claim된다', async () => room(async ({ root, registry }) => {
  const notified = [];
  let resolveTerminal;
  const terminalEvent = new Promise((resolve) => { resolveTerminal = resolve; });
  const unsubscribe = registry.onTerminal((event) => {
    notified.push(event);
    resolveTerminal(event);
  });
  let terminalTimeout;
  try {
    const started = await registry.start({
      program: '/bin/sh', args: ['-lc', "sleep 0.06; printf 'wake-output'"], cwd: root,
      env: process.env, ownerId: 'session-wake', waitMs: 10,
      metadata: { kind: 'managed', originRunId: 'run-origin' },
    });
    assert.equal(started.state, 'running');
    await Promise.race([terminalEvent, new Promise((_, reject) => {
      terminalTimeout = setTimeout(() => reject(new Error('terminal event was not emitted')), 2000);
    })]);
    assert.equal(notified.length, 1);
    const wake = registry.claimTerminalWake(started.processId);
    assert.equal(wake.state, 'completed');
    assert.equal(wake.stdout, 'wake-output');
    assert.equal(wake.ownerId, 'session-wake');
    assert.equal(wake.metadata.originRunId, 'run-origin');
    assert.equal(registry.claimTerminalWake(started.processId), null);
    assert.equal(registry.releaseTerminalWake(started.processId), true);
    assert.equal(registry.claimTerminalWake(started.processId).stdout, 'wake-output');
  } finally {
    clearTimeout(terminalTimeout);
    unsubscribe();
  }
}));

test('S4-D2 RED: stop이 이미 terminal 결과를 반환하면 같은 completion wake는 다시 claim되지 않는다', {
  timeout: 2000,
}, async () => room(async ({ root, registry }) => {
  let resolveTerminal;
  const terminalEvent = new Promise((resolve) => { resolveTerminal = resolve; });
  const unsubscribe = registry.onTerminal(resolveTerminal);
  try {
    const started = await registry.start({
      program: '/bin/sh', args: ['-lc', "printf 'stop-first'"], cwd: root,
      env: process.env, ownerId: 'session-stop-first', waitMs: 0,
      metadata: { kind: 'managed', originRunId: 'run-stop-first' },
    });
    await terminalEvent;
    const observed = await registry.stop({ processId: started.processId,
      ownerId: 'session-stop-first', reason: 'model_requested', cursor: started.cursor });
    assert.equal(observed.state, 'completed');
    assert.equal(registry.claimTerminalWake(started.processId), null);
  } finally { unsubscribe(); }
}));

test('S4-D2 반대 순서: wake가 먼저 claim되면 이후 stop이 background wake를 다시 만들지 않는다', {
  timeout: 2000,
}, async () => room(async ({ root, registry }) => {
  let resolveTerminal;
  const terminalEvent = new Promise((resolve) => { resolveTerminal = resolve; });
  const unsubscribe = registry.onTerminal(resolveTerminal);
  try {
    const started = await registry.start({
      program: '/bin/sh', args: ['-lc', "printf 'wake-first'"], cwd: root,
      env: process.env, ownerId: 'session-wake-first', waitMs: 0,
      metadata: { kind: 'managed', originRunId: 'run-wake-first' },
    });
    await terminalEvent;
    assert.equal(registry.claimTerminalWake(started.processId)?.state, 'completed');
    const observed = await registry.stop({ processId: started.processId,
      ownerId: 'session-wake-first', reason: 'model_requested', cursor: started.cursor });
    assert.equal(observed.state, 'completed');
    assert.equal(registry.claimTerminalWake(started.processId), null);
  } finally { unsubscribe(); }
}));

test('모델이 poll로 terminal 상태를 이미 관측한 process는 다시 wake하지 않는다', async () => room(async ({ root, registry }) => {
  const started = await registry.start({
    program: '/bin/sh', args: ['-lc', "sleep 0.04; printf 'observed'"], cwd: root,
    env: process.env, ownerId: 'session-observed', waitMs: 5,
    metadata: { kind: 'managed' },
  });
  await collectUntilTerminal(registry, started, 'session-observed');
  await delay(10);
  assert.equal(registry.claimTerminalWake(started.processId), null);
}));
