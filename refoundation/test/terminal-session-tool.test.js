import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  EFFECT_SCHEMA, makeExecTool, makeProcessControlTool, makeProcessStartTool, makeTerminalHand,
  normalizeTerminalEffect,
} from '../src/exec-tool.js';
import { ManagedProcessRegistry } from '../src/managed-process.js';
import { makePtyStartTool } from '../src/pty-tool.js';
import { makeTerminalOutputTool, TerminalOutputStore } from '../src/terminal-output-store.js';
import { makeTerminalSessionTool } from '../src/terminal-session-tool.js';

const effect = {
  kind: 'observe', summary: '격리 Terminal 관측', targets: [], reversible: true,
  backupAvailable: false, recipientNew: false, approvalToken: null,
};

const empty = (overrides = {}) => ({
  action: 'list', command: null, cwd: null, effect: null, processId: null, cursor: null,
  input: null, end: null, waitMs: null, cols: null, rows: null, handle: null,
  stream: null, offset: null, limit: null, ...overrides,
});

async function room(run) {
  const root = await mkdtemp(join(tmpdir(), 't5-terminal-session-'));
  try {
    const outputStore = new TerminalOutputStore(join(root, 'outputs'));
    const common = { workingDirectory: root, workspace: root, ownerId: 'session-a', originRunId: 'run-a',
      outputLimit: 128, yieldMs: 10, terminalOutputStore: outputStore };
    const processRegistry = new ManagedProcessRegistry({ outputLimit: 128 });
    const exec = makeExecTool({ ...common, processRegistry });
    const start = makeProcessStartTool({ ...common, processRegistry });
    const ptyStart = makePtyStartTool({ ...common, processRegistry });
    const control = makeProcessControlTool({ processRegistry, ownerId: 'session-a' });
    const output = makeTerminalOutputTool({ store: outputStore, sessionId: 'session-a' });
    const session = makeTerminalSessionTool({
      start, ptyStart, control, output, effectSchema: EFFECT_SCHEMA,
      normalizeEffect: normalizeTerminalEffect,
    });
    await run({ root, exec, start, ptyStart, control, output, session });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('terminal_session은 기존 process start와 delta poll 영수증을 바꾸지 않는다', async () => room(async ({ session }) => {
  const started = await session.execute(empty({
    action: 'start', command: "printf 'FIRST\\n'; sleep 0.05; printf 'SECOND\\n'",
    effect: structuredClone(effect),
  }));
  assert.ok(started.processId);
  let current = started;
  let observed = started.stdout ?? '';
  for (let attempt = 0; attempt < 8 && ['running', 'stop_requested'].includes(current.state); attempt += 1) {
    current = await session.execute(empty({
      action: 'poll', processId: started.processId, cursor: current.cursor, waitMs: 1000,
    }));
    observed += current.stdout ?? '';
  }
  assert.equal(current.state, 'completed');
  assert.equal(current.processExitCode, 0);
  assert.equal(observed.split('SECOND').length - 1, 1);
  assert.equal(session.resourceSemantics(empty({ action: 'poll' }), { state: 'running' }).pending, true);
}));

test('terminal_session은 PTY 입력과 크기 변경을 기존 registry에 위임한다', async () => room(async ({ session }) => {
  const started = await session.execute(empty({
    action: 'start_tty', command: 'read value; printf "VALUE=%s\\n" "$value"',
    effect: structuredClone(effect), cols: 80, rows: 24,
  }));
  await session.execute(empty({ action: 'resize', processId: started.processId, cols: 100, rows: 30 }));
  await session.execute(empty({ action: 'write', processId: started.processId, input: 'forty-two\n', end: false }));
  let current = started;
  let observed = '';
  for (let attempt = 0; attempt < 8 && ['running', 'stop_requested'].includes(current.state); attempt += 1) {
    current = await session.execute(empty({
      action: 'poll', processId: started.processId, cursor: current.cursor, waitMs: 1000,
    }));
    observed += current.stdout ?? '';
  }
  assert.equal(current.state, 'completed');
  assert.match(observed, /VALUE=forty-two/u);
}));

test('terminal_session은 잘린 foreground 출력을 재실행 없이 정확히 읽는다', async () => room(async ({ exec, session }) => {
  const result = await exec.execute({
    command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify("process.stdout.write('HEAD-' + 'x'.repeat(2000) + '-TAIL')")}`,
    cwd: null, effect: structuredClone(effect),
  });
  assert.equal(result.truncated, true);
  const recalled = await session.execute(empty({
    action: 'read_output', handle: result.outputRecall.handle, stream: 'stdout', offset: 1995, limit: 20,
  }));
  assert.match(recalled.text, /-TAIL$/u);
}));

test('제품 terminal_session의 즉시 완료된 큰 managed 출력도 exact handle로 읽는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-terminal-managed-recall-'));
  try {
    const outputStore = new TerminalOutputStore(join(root, 'outputs'));
    const hand = makeTerminalHand({
      workingDirectory: root, workspace: root, ownerId: 'session-managed',
      originRunId: 'run-managed', outputLimit: 128, yieldMs: 1000,
      terminalOutputStore: outputStore,
    });
    const session = hand.tools.find((tool) => tool.name === 'terminal_session');
    const started = await session.execute(empty({
      action: 'start',
      command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify("process.stdout.write('HEAD-' + 'x'.repeat(2000) + '-MANAGED-NEEDLE-' + 'y'.repeat(2000) + '-TAIL')")}`,
      effect: structuredClone(effect),
    }));
    assert.equal(started.state, 'completed');
    assert.equal(started.truncated, true);
    assert.ok(started.outputRecall?.handle);
    const recalled = await session.execute(empty({
      action: 'read_output', handle: started.outputRecall.handle,
      stream: 'stdout', offset: 1990, limit: 80,
    }));
    assert.match(recalled.text, /MANAGED-NEEDLE/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('exec + terminal_session 스키마는 기존 기본 네 도구보다 작다', async () => room(async ({ exec, start, ptyStart, control, session }) => {
  const bytes = (tools) => Buffer.byteLength(JSON.stringify(tools.map(({ name, description, parameters }) => ({
    name, description, parameters,
  }))));
  const current = bytes([exec, start, ptyStart, control]);
  const candidate = bytes([exec, session]);
  assert.ok(candidate < current, { current, candidate });
}));

test('모델 effect 표면은 세 필드이고 런타임은 기존 권한 사실을 정확히 복원한다', () => {
  assert.deepEqual(EFFECT_SCHEMA.required, ['kind', 'targets', 'confirmation']);
  const destructive = normalizeTerminalEffect({
    kind: 'destructive', targets: ['/tmp/result'], confirmation: 'backup_unavailable',
  });
  assert.equal(destructive.reversible, false);
  assert.equal(destructive.backupAvailable, false);
  assert.equal(destructive.recipientNew, false);
  assert.equal(destructive.approvalToken, null);
  const known = normalizeTerminalEffect({
    kind: 'external_send', targets: ['existing-chat'], confirmation: 'known_recipient',
  });
  assert.equal(known.recipientNew, false);
  assert.throws(() => normalizeTerminalEffect({
    kind: 'observe', targets: [], confirmation: 'new_recipient',
  }), { code: 'T5_EFFECT_CONFIRMATION_MISMATCH' });
});
