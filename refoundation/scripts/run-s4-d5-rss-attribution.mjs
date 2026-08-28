#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeProcessControlTool, makeProcessStartTool, makeTerminalHand } from '../src/exec-tool.js';
import { explainShellCommand } from '../src/command-explainer.js';
import { ManagedProcessRegistry } from '../src/managed-process.js';
import { TerminalOutputStore } from '../src/terminal-output-store.js';

const here = dirname(fileURLToPath(import.meta.url));
const script = fileURLToPath(import.meta.url);
const effect = { kind: 'observe', targets: [], confirmation: 'not_applicable', rollbackOfToolCallId: null };
const terminalArgs = (overrides = {}) => ({
  action: 'list', command: null, cwd: null, effect: null, processId: null, cursor: null,
  input: null, end: null, waitMs: null, cols: null, rows: null, handle: null,
  stream: null, offset: null, limit: null, ...overrides,
});
const arms = [
  'idle',
  'store_only',
  'raw_pipe_discard',
  'raw_pipe_bounded_string',
  'raw_pipe_bounded_snapshots',
  'registry_direct_wait_terminal',
  'registry_direct_poll',
  'registry_shell_poll',
  'command_explainer_short',
  'command_explainer_output',
  'explainer_then_raw_pipe',
  'explainer_then_registry_poll',
  'explainer_retained_then_registry_poll',
  'process_start_no_explainer',
  'process_start_registry_poll',
  'process_start_control_poll',
  'registry_direct_without_live_store',
  'registry_without_live_store',
  'terminal_direct_live_store',
  'terminal_live_store',
  'terminal_bounded_hash_read',
  'terminal_concat_read',
];

function memory() {
  const value = process.memoryUsage();
  return { rss: value.rss, heapUsed: value.heapUsed, external: value.external,
    arrayBuffers: value.arrayBuffers };
}

async function collect(label) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    global.gc?.(); await new Promise((resolve) => setImmediate(resolve));
  }
  return { label, ...memory() };
}

function outputProgram() {
  return { program: process.execPath, args: ['-e', [
    "process.stdout.write('OUT-EARLY-'+'o'.repeat(1100000)+'-OUT-TAIL')",
    "process.stderr.write('ERR-EARLY-'+'e'.repeat(1100000)+'-ERR-TAIL')",
    'setTimeout(()=>process.exit(0),200)',
  ].join(';')] };
}

function outputCommand() {
  const value = outputProgram();
  return `${JSON.stringify(value.program)} -e ${JSON.stringify(value.args[1])}`;
}

async function pollTerminal(session, started, track) {
  let current = started; let polls = 0;
  for (let attempt = 0; attempt < 512 && current.state === 'running'; attempt += 1) {
    current = await session.execute(terminalArgs({ action: 'poll', processId: started.processId,
      cursor: current.cursor, waitMs: 1000 }));
    polls += 1;
    track();
  }
  if (current.state === 'running') throw new Error('managed process did not settle');
  return { ...current, qualificationPolls: polls };
}

async function readBounded(session, handle, mode, track) {
  const hashes = { stdout: createHash('sha256'), stderr: createHash('sha256') };
  const concatenated = { stdout: '', stderr: '' };
  for (const stream of ['stdout', 'stderr']) {
    let offset = 0;
    do {
      const range = await session.execute(terminalArgs({ action: 'read_output', handle,
        stream, offset, limit: 16_000 }));
      hashes[stream].update(range.text);
      if (mode === 'concat') concatenated[stream] += range.text;
      offset = range.nextOffset;
      track();
    } while (offset != null);
  }
  return {
    stdoutSha256: hashes.stdout.digest('hex'), stderrSha256: hashes.stderr.digest('hex'),
    retainedConcatChars: concatenated.stdout.length + concatenated.stderr.length,
  };
}

async function runStoreOnly(root, track) {
  const store = new TerminalOutputStore(join(root, 'terminal-outputs'));
  const live = await store.begin({ sessionId: 'session-a', runId: 'run-a' });
  const chunk = 'x'.repeat(64_000);
  for (const stream of ['stdout', 'stderr']) {
    let remaining = 1_100_020;
    while (remaining > 0) {
      const text = chunk.slice(0, Math.min(chunk.length, remaining));
      await store.append({ handle: live.handle, sessionId: 'session-a', stream, text });
      remaining -= text.length; track();
    }
  }
  await store.finalize({ handle: live.handle, sessionId: 'session-a' });
  return { outputHandle: live.handle, outputChars: 2_200_040 };
}

async function runRawPipe(mode, track) {
  const output = outputProgram();
  const proc = spawn(output.program, output.args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const retained = { stdout: '', stderr: '' }; const observed = { stdout: 0, stderr: 0 };
  for (const stream of ['stdout', 'stderr']) {
    proc[stream].setEncoding('utf8');
    proc[stream].on('data', (chunk) => {
      const value = String(chunk); observed[stream] += value.length;
      if (mode === 'bounded_string') {
        retained[stream] += value;
        if (retained[stream].length > 1_048_576) {
          retained[stream] = retained[stream].slice(retained[stream].length - 1_048_576);
        }
      } else if (mode === 'bounded_snapshots') {
        retained[stream] += value;
        if (retained[stream].length > 1_048_576) {
          retained[stream] = retained[stream].slice(retained[stream].length - 1_048_576);
        }
        const visible = retained[stream].length <= 64_000 ? retained[stream]
          : `${retained[stream].slice(0, 32_000)}\n…omitted…\n${retained[stream].slice(-32_000)}`;
        createHash('sha256').update(visible).digest();
      }
      track();
    });
  }
  const [code] = await once(proc, 'close'); track();
  if (code !== 0) throw new Error(`raw output process failed: ${code}`);
  return { observed, retainedChars: retained.stdout.length + retained.stderr.length };
}

async function runRegistryWaitTerminal(root, track) {
  const output = outputProgram();
  const registry = new ManagedProcessRegistry({ platform: 'linux', outputLimit: 64_000 });
  try {
    const terminal = await registry.start({
      program: output.program, args: output.args, cwd: root, env: process.env,
      ownerId: 'session-a', waitMs: null, spoolLimit: 1_048_576,
      metadata: { kind: 'managed' }, onActivity: track,
    });
    track();
    return { terminalState: terminal.state,
      residentStdoutChars: registry.fullOutput(terminal.processId, 'session-a').stdout.text.length,
      residentStderrChars: registry.fullOutput(terminal.processId, 'session-a').stderr.text.length };
  } finally { await registry.stopAll('test_cleanup'); }
}

async function runRegistryPoll(root, track) {
  const output = outputProgram();
  const registry = new ManagedProcessRegistry({ platform: 'linux', outputLimit: 64_000 });
  try {
    let current = await registry.start({
      program: output.program, args: output.args, cwd: root, env: process.env,
      ownerId: 'session-a', waitMs: 10, spoolLimit: 1_048_576,
      metadata: { kind: 'managed' }, onActivity: track,
    });
    let polls = 0;
    while (current.state === 'running' && polls < 512) {
      current = await registry.poll({ processId: current.processId, cursor: current.cursor,
        ownerId: 'session-a', waitMs: 1000 });
      polls += 1; track();
    }
    if (current.state === 'running') throw new Error('direct registry poll did not settle');
    return { terminalState: current.state, polls,
      residentStdoutChars: registry.fullOutput(current.processId, 'session-a').stdout.text.length,
      residentStderrChars: registry.fullOutput(current.processId, 'session-a').stderr.text.length };
  } finally { await registry.stopAll('test_cleanup'); }
}

async function runRegistryShellPoll(root, track) {
  const registry = new ManagedProcessRegistry({ platform: 'linux', outputLimit: 64_000 });
  try {
    let current = await registry.start({
      program: '/bin/zsh', args: ['-lc', outputCommand()], cwd: root, env: process.env,
      ownerId: 'session-a', waitMs: 10, spoolLimit: 1_048_576,
      metadata: { kind: 'managed' }, onActivity: track,
    });
    let polls = 0;
    while (current.state === 'running' && polls < 512) {
      current = await registry.poll({ processId: current.processId, cursor: current.cursor,
        ownerId: 'session-a', waitMs: 1000 });
      polls += 1; track();
    }
    if (current.state === 'running') throw new Error('shell registry poll did not settle');
    return { terminalState: current.state, polls };
  } finally { await registry.stopAll('test_cleanup'); }
}

async function runAfterExplainer(root, next, track) {
  const explanation = await explainShellCommand(next === 'retained' ? outputCommand() : "printf 'warm parser'");
  track();
  const result = next === 'raw' ? await runRawPipe('discard', track) : await runRegistryPoll(root, track);
  return next === 'retained' ? { ...result, retainedExplanationSteps: explanation.steps.length } : result;
}

async function runProcessToolPoll(root, mode, track) {
  const registry = new ManagedProcessRegistry({ platform: 'linux', outputLimit: 64_000 });
  const start = makeProcessStartTool({ workingDirectory: root, workspace: root,
    ownerId: 'session-a', originRunId: 'run-a', yieldMs: 10, processRegistry: registry,
    ...(mode === 'no_explainer' ? { explainCommand: async () => ({ ok: false,
      hasParseError: null, source: null, shapes: [], steps: [], operators: [] }) } : {}) });
  const control = makeProcessControlTool({ processRegistry: registry, ownerId: 'session-a' });
  try {
    let current = await start.execute({ command: outputCommand(), cwd: null, effect }, { onActivity: track });
    let polls = 0;
    while (current.state === 'running' && polls < 512) {
      current = ['registry', 'no_explainer'].includes(mode)
        ? await registry.poll({ processId: current.processId, cursor: current.cursor,
          ownerId: 'session-a', waitMs: 1000 })
        : await control.execute({ action: 'poll', processId: current.processId, cursor: current.cursor,
          input: null, end: null, waitMs: 1000, cols: null, rows: null });
      polls += 1; track();
    }
    if (current.state === 'running') throw new Error('process tool poll did not settle');
    return { terminalState: current.state, polls };
  } finally { await registry.stopAll('test_cleanup'); }
}

async function runTerminal(root, arm, track) {
  const store = ['registry_without_live_store', 'registry_direct_without_live_store'].includes(arm)
    ? null : new TerminalOutputStore(join(root, 'terminal-outputs'));
  const direct = ['registry_direct_without_live_store', 'terminal_direct_live_store'].includes(arm);
  const registry = new ManagedProcessRegistry({ outputLimit: 64_000,
    ...(direct ? { platform: 'linux' } : {}) });
  const hand = makeTerminalHand({ workingDirectory: root, workspace: root,
    ownerId: 'session-a', originRunId: 'run-a', yieldMs: 10,
    ...(store ? { terminalOutputStore: store } : {}), processRegistry: registry });
  const session = hand.tools.find((tool) => tool.name === 'terminal_session');
  try {
    const started = await session.execute(terminalArgs({ action: 'start',
      command: outputCommand(), effect }), { onActivity: track });
    track();
    const terminal = await pollTerminal(session, started, track);
    let read = null;
    if (arm === 'terminal_bounded_hash_read') {
      read = await readBounded(session, terminal.outputRecall.handle, 'hash', track);
    } else if (arm === 'terminal_concat_read') {
      read = await readBounded(session, terminal.outputRecall.handle, 'concat', track);
    }
    return { terminalState: terminal.state, outputRecall: terminal.outputRecall?.state ?? null,
      polls: terminal.qualificationPolls,
      residentStdoutChars: registry.fullOutput(terminal.processId, 'session-a').stdout.text.length,
      residentStderrChars: registry.fullOutput(terminal.processId, 'session-a').stderr.text.length,
      read };
  } finally { await registry.stopAll('test_cleanup'); }
}

async function runArm(arm) {
  if (!global.gc) throw new Error('run with --expose-gc');
  if (!arms.includes(arm)) throw new Error('unknown RSS arm');
  const root = await mkdtemp(join(tmpdir(), `t5-s4d5-${arm}-`));
  let peak = memory();
  const track = () => {
    const current = memory();
    if (current.rss > peak.rss) peak = current;
  };
  const startedAt = process.hrtime.bigint();
  try {
    const before = await collect('before'); track();
    const result = arm === 'idle' ? { idle: true }
      : arm === 'store_only' ? await runStoreOnly(root, track)
        : arm === 'command_explainer_short' ? await explainShellCommand("printf 'ok'")
          : arm === 'command_explainer_output' ? await explainShellCommand(outputCommand())
            : arm === 'explainer_then_raw_pipe' ? await runAfterExplainer(root, 'raw', track)
              : arm === 'explainer_then_registry_poll' ? await runAfterExplainer(root, 'registry', track)
                : arm === 'explainer_retained_then_registry_poll' ? await runAfterExplainer(root, 'retained', track)
        : arm === 'raw_pipe_discard' ? await runRawPipe('discard', track)
          : arm === 'raw_pipe_bounded_string' ? await runRawPipe('bounded_string', track)
            : arm === 'raw_pipe_bounded_snapshots' ? await runRawPipe('bounded_snapshots', track)
              : arm === 'registry_direct_wait_terminal' ? await runRegistryWaitTerminal(root, track)
                : arm === 'registry_direct_poll' ? await runRegistryPoll(root, track)
                  : arm === 'registry_shell_poll' ? await runRegistryShellPoll(root, track)
                    : arm === 'process_start_no_explainer' ? await runProcessToolPoll(root, 'no_explainer', track)
                      : arm === 'process_start_registry_poll' ? await runProcessToolPoll(root, 'registry', track)
                      : arm === 'process_start_control_poll' ? await runProcessToolPoll(root, 'control', track)
        : await runTerminal(root, arm, track);
    const afterOperation = { label: 'after_operation', ...memory() }; track();
    const afterGc = await collect('after_gc'); track();
    return { arm, wallMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
      before, peak, afterOperation, afterGc, result };
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function child(arm) {
  const result = await runArm(arm);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function launchArm(arm) {
  const proc = spawn(process.execPath, ['--expose-gc', script, '--arm', arm], {
    cwd: join(here, '..', '..'), stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = ''; let stderr = '';
  proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => { stdout += chunk; });
  proc.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(proc, 'close');
  if (code !== 0) throw new Error(`RSS arm ${arm} failed: ${stderr.slice(0, 1000)}`);
  return JSON.parse(stdout.trim().split('\n').at(-1));
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  const samples = {};
  for (const arm of arms) {
    samples[arm] = [];
    for (let sample = 0; sample < 3; sample += 1) samples[arm].push(await launchArm(arm));
  }
  const summary = Object.fromEntries(Object.entries(samples).map(([arm, values]) => [arm, {
    medianPeakRssDelta: median(values.map((value) => value.peak.rss - value.before.rss)),
    medianAfterGcRssDelta: median(values.map((value) => value.afterGc.rss - value.before.rss)),
    medianAfterGcHeapDelta: median(values.map((value) => value.afterGc.heapUsed - value.before.heapUsed)),
    medianWallMs: median(values.map((value) => value.wallMs)),
  }]));
  process.stdout.write(`${JSON.stringify({
    schema: 't5.s4d5.rss-attribution.v1', recordedOn: new Date().toISOString().slice(0, 10),
    platform: process.platform, architecture: process.arch, node: process.version,
    isolatedTemporaryRoots: true, realUserData: false, externalWrites: 0,
    productChanges: 0, outputCharsPerStream: 1_100_020, samplesPerArm: 3,
    samples, summary,
  }, null, 2)}\n`);
}

const armIndex = process.argv.indexOf('--arm');
if (armIndex >= 0) await child(process.argv[armIndex + 1]);
else await main();
