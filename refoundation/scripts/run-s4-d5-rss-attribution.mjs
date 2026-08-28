#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { makeProcessControlTool, makeProcessStartTool, makeTerminalHand } from '../src/exec-tool.js';
import { explainShellCommand } from '../src/command-explainer.js';
import { ManagedProcessRegistry } from '../src/managed-process.js';
import { TerminalOutputStore } from '../src/terminal-output-store.js';

const here = dirname(fileURLToPath(import.meta.url));
const script = fileURLToPath(import.meta.url);
const explainerChild = join(here, 'command-explainer-child.mjs');
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
  'explainer_output_then_registry_poll',
  'explainer_retained_then_registry_poll',
  'process_start_no_explainer',
  'process_start_detached_explanation',
  'process_start_json_explanation',
  'process_start_buffer_detached_explanation',
  'process_start_explainer_discarded',
  'process_start_prepared_explanation_bytes',
  'process_start_isolated_explanation',
  'process_start_persistent_explanation',
  'prepared_bytes_then_registry_poll',
  'explanation_digest_then_registry_poll',
  'explanation_file_then_registry_poll',
  'process_start_registry_poll',
  'process_start_control_poll',
  'registry_direct_without_live_store',
  'registry_without_live_store',
  'terminal_direct_live_store',
  'terminal_live_store',
  'terminal_persistent_explanation',
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

async function prepareExplanationBytes(command) {
  const explanation = await explainShellCommand(command);
  return Buffer.from(JSON.stringify(explanation), 'utf8');
}

async function isolatedExplanation(command) {
  const child = spawn(process.execPath, [explainerChild], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (stdout.length > 512 * 1024) child.kill('SIGKILL');
  });
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(0, 1000); });
  child.stdin.end(String(command));
  const [code] = await once(child, 'close');
  if (code !== 0) throw new Error(`isolated explainer failed: ${stderr}`);
  return JSON.parse(stdout);
}

function persistentExplanationClient() {
  const child = spawn(process.execPath, [explainerChild, '--persistent'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map(); let sequence = 0; let lastRss = null;
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => {
    let response;
    try { response = JSON.parse(line); } catch { response = null; }
    const entry = response?.id && pending.get(response.id); if (!entry) return;
    pending.delete(response.id);
    if (response.ok === true) { lastRss = response.rss; entry.resolve(response.result); }
    else entry.reject(new Error(response?.error ?? 'invalid_explanation_response'));
  });
  child.once('exit', () => {
    for (const entry of pending.values()) entry.reject(new Error('explainer_process_exited'));
    pending.clear();
  });
  return {
    explain(command) {
      const id = `p-${++sequence}`;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify({ id, command })}\n`);
      });
    },
    rss: () => lastRss,
    async close() {
      child.stdin.end();
      if (child.exitCode == null) await once(child, 'close');
      lines.close();
    },
  };
}

async function runPreparedBytesThenRegistry(root, track) {
  const bytes = await prepareExplanationBytes(outputCommand()); track();
  const result = await runRegistryPoll(root, track);
  const explanation = JSON.parse(bytes.toString('utf8'));
  return { ...result, restoredExplanationSteps: explanation.steps.length };
}

async function runExplanationPointerThenRegistry(root, mode, track) {
  let explanation = await explainShellCommand(outputCommand());
  let serialized = JSON.stringify(explanation);
  let pointer;
  if (mode === 'digest') pointer = createHash('sha256').update(serialized).digest('hex');
  else {
    pointer = join(root, 'command-explanation.json');
    await writeFile(pointer, serialized, { mode: 0o600 });
  }
  explanation = null; serialized = null;
  track();
  const result = await runRegistryPoll(root, track);
  const restored = mode === 'digest' ? pointer
    : JSON.parse(await readFile(pointer, 'utf8')).steps.length;
  return { ...result, restored };
}

async function runAfterExplainer(root, next, track) {
  const explanation = await explainShellCommand(['retained', 'output_discarded'].includes(next)
    ? outputCommand() : "printf 'warm parser'");
  track();
  const result = next === 'raw' ? await runRawPipe('discard', track) : await runRegistryPoll(root, track);
  return next === 'retained' ? { ...result, retainedExplanationSteps: explanation.steps.length } : result;
}

async function runProcessToolPoll(root, mode, track) {
  const registry = new ManagedProcessRegistry({ platform: 'linux', outputLimit: 64_000 });
  const persistent = mode === 'persistent_explanation' ? persistentExplanationClient() : null;
  const start = makeProcessStartTool({ workingDirectory: root, workspace: root,
    ownerId: 'session-a', originRunId: 'run-a', yieldMs: 10, processRegistry: registry,
    ...(mode === 'no_explainer' ? { explainCommand: async () => ({ ok: false,
      hasParseError: null, source: null, shapes: [], steps: [], operators: [] }) } : {}),
    ...(mode === 'detached_explanation' ? { explainCommand: async (command) => (
      structuredClone(await explainShellCommand(command))
    ) } : {}),
    ...(mode === 'json_explanation' ? { explainCommand: async (command) => (
      JSON.parse(JSON.stringify(await explainShellCommand(command)))
    ) } : {}),
    ...(mode === 'buffer_detached_explanation' ? { explainCommand: async (command) => (
      JSON.parse(Buffer.from(JSON.stringify(await explainShellCommand(command)), 'utf8').toString('utf8'))
    ) } : {}),
    ...(mode === 'explainer_discarded' ? { explainCommand: async (command) => {
      await explainShellCommand(command);
      return { ok: false, hasParseError: null, source: null, shapes: [], steps: [], operators: [] };
    } } : {}),
    ...(mode === 'prepared_explanation_bytes' ? { explainCommand: async (command) => (
      JSON.parse((await prepareExplanationBytes(command)).toString('utf8'))
    ) } : {}),
    ...(mode === 'isolated_explanation' ? { explainCommand: isolatedExplanation } : {}) });
  if (persistent) start.execute = makeProcessStartTool({ workingDirectory: root, workspace: root,
    ownerId: 'session-a', originRunId: 'run-a', yieldMs: 10, processRegistry: registry,
    explainCommand: (command) => persistent.explain(command) }).execute;
  const control = makeProcessControlTool({ processRegistry: registry, ownerId: 'session-a' });
  try {
    if (persistent) await persistent.explain("printf 'warm helper'");
    let current = await start.execute({ command: outputCommand(), cwd: null, effect }, { onActivity: track });
    let polls = 0;
    while (current.state === 'running' && polls < 512) {
      current = ['registry', 'no_explainer', 'detached_explanation', 'json_explanation',
        'buffer_detached_explanation', 'explainer_discarded', 'prepared_explanation_bytes',
        'isolated_explanation'].includes(mode)
        ? await registry.poll({ processId: current.processId, cursor: current.cursor,
          ownerId: 'session-a', waitMs: 1000 })
        : await control.execute({ action: 'poll', processId: current.processId, cursor: current.cursor,
          input: null, end: null, waitMs: 1000, cols: null, rows: null });
      polls += 1; track();
    }
    if (current.state === 'running') throw new Error('process tool poll did not settle');
    return { terminalState: current.state, polls, helperRss: persistent?.rss() ?? null };
  } finally {
    await registry.stopAll('test_cleanup');
    await persistent?.close();
  }
}

async function runTerminal(root, arm, track) {
  const store = ['registry_without_live_store', 'registry_direct_without_live_store'].includes(arm)
    ? null : new TerminalOutputStore(join(root, 'terminal-outputs'));
  const direct = ['registry_direct_without_live_store', 'terminal_direct_live_store'].includes(arm);
  const registry = new ManagedProcessRegistry({ outputLimit: 64_000,
    ...(direct ? { platform: 'linux' } : {}) });
  const persistent = arm === 'terminal_persistent_explanation' ? persistentExplanationClient() : null;
  const hand = makeTerminalHand({ workingDirectory: root, workspace: root,
    ownerId: 'session-a', originRunId: 'run-a', yieldMs: 10,
    ...(store ? { terminalOutputStore: store } : {}), processRegistry: registry,
    ...(persistent ? { explainCommand: (command) => persistent.explain(command) } : {}) });
  const session = hand.tools.find((tool) => tool.name === 'terminal_session');
  try {
    if (persistent) await persistent.explain("printf 'warm helper'");
    const started = await session.execute(terminalArgs({ action: 'start',
      command: outputCommand(), effect }), { onActivity: track });
    track();
    const terminal = await pollTerminal(session, started, track);
    let read = null;
    if (['terminal_bounded_hash_read', 'terminal_persistent_explanation'].includes(arm)) {
      read = await readBounded(session, terminal.outputRecall.handle, 'hash', track);
    } else if (arm === 'terminal_concat_read') {
      read = await readBounded(session, terminal.outputRecall.handle, 'concat', track);
    }
    return { terminalState: terminal.state, outputRecall: terminal.outputRecall?.state ?? null,
      polls: terminal.qualificationPolls,
      helperRss: persistent?.rss() ?? null,
      residentStdoutChars: registry.fullOutput(terminal.processId, 'session-a').stdout.text.length,
      residentStderrChars: registry.fullOutput(terminal.processId, 'session-a').stderr.text.length,
      read };
  } finally {
    await registry.stopAll('test_cleanup');
    await persistent?.close();
  }
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
                : arm === 'explainer_output_then_registry_poll' ? await runAfterExplainer(root, 'output_discarded', track)
                  : arm === 'explainer_retained_then_registry_poll' ? await runAfterExplainer(root, 'retained', track)
        : arm === 'raw_pipe_discard' ? await runRawPipe('discard', track)
          : arm === 'raw_pipe_bounded_string' ? await runRawPipe('bounded_string', track)
            : arm === 'raw_pipe_bounded_snapshots' ? await runRawPipe('bounded_snapshots', track)
              : arm === 'registry_direct_wait_terminal' ? await runRegistryWaitTerminal(root, track)
                : arm === 'registry_direct_poll' ? await runRegistryPoll(root, track)
                  : arm === 'registry_shell_poll' ? await runRegistryShellPoll(root, track)
                    : arm === 'process_start_no_explainer' ? await runProcessToolPoll(root, 'no_explainer', track)
                      : arm === 'process_start_detached_explanation' ? await runProcessToolPoll(root, 'detached_explanation', track)
                        : arm === 'process_start_json_explanation' ? await runProcessToolPoll(root, 'json_explanation', track)
                          : arm === 'process_start_buffer_detached_explanation' ? await runProcessToolPoll(root, 'buffer_detached_explanation', track)
                            : arm === 'process_start_explainer_discarded' ? await runProcessToolPoll(root, 'explainer_discarded', track)
                              : arm === 'process_start_prepared_explanation_bytes' ? await runProcessToolPoll(root, 'prepared_explanation_bytes', track)
                                : arm === 'process_start_isolated_explanation' ? await runProcessToolPoll(root, 'isolated_explanation', track)
                                  : arm === 'process_start_persistent_explanation' ? await runProcessToolPoll(root, 'persistent_explanation', track)
                                    : arm === 'prepared_bytes_then_registry_poll' ? await runPreparedBytesThenRegistry(root, track)
                                  : arm === 'explanation_digest_then_registry_poll' ? await runExplanationPointerThenRegistry(root, 'digest', track)
                                    : arm === 'explanation_file_then_registry_poll' ? await runExplanationPointerThenRegistry(root, 'file', track)
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
