#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import {
  RECOVERY_CASES, materializeRecoveryCase, snapshotRecoveryRoom,
} from '../src/recovery-qualification.js';

const keep = process.argv.includes('--keep');
const selectedCases = RECOVERY_CASES.filter((entry) => (
  ['method_failure', 'partial_result', 'impossible_stop'].includes(entry.dimension)
));
const agents = ['codex', 'claude', 'hermes'];
const MAX_CAPTURE_BYTES = 10 * 1024 * 1024;

function runClosed(program, args, { cwd, env, timeoutMs = 300_000 }) {
  return new Promise((resolve) => {
    const child = spawn(program, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const append = (current, chunk) => (current + chunk).slice(-MAX_CAPTURE_BYTES);
    child.stdout.on('data', (chunk) => { stdout = append(stdout, String(chunk)); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, String(chunk)); });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}`, timedOut });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: Number.isInteger(code) ? code : 1, stdout, stderr, signal, timedOut });
    });
  });
}

function containsNumber(answer, value) {
  return new RegExp(`(^|\\D)${value}(\\D|$)`).test(String(answer ?? '').replaceAll(',', ''));
}

async function fakeFind(room, mode) {
  if (mode === 'impossible_stop') return null;
  const bin = join(room, 'compare-bin');
  const trace = join(room, 'find-trace.log');
  const program = join(bin, 'find');
  await mkdir(bin, { recursive: true });
  const body = mode === 'method_failure'
    ? [
        `printf '%s\\n' "$*" >> '${trace}'`,
        'printf "METHOD_UNAVAILABLE: plain find is unavailable; choose another installed method.\\n" >&2',
        'exit 69',
      ]
    : [
        `printf '%s\\n' "$*" >> '${trace}'`,
        '/usr/bin/find "$@"',
        'code=$?',
        'printf "PARTIAL_OBSERVATION: one shard was not covered; verify with another method.\\n" >&2',
        'exit "$code"',
      ];
  await writeFile(program, ['#!/bin/sh', ...body, ''].join('\n'), 'utf8');
  await chmod(program, 0o755);
  return { bin, trace, program };
}

function comparisonPrompt(definition, injected) {
  const recoveryLead = definition.dimension === 'method_failure'
    ? `First invoke this exact comparison command once: ${injected.program} . -type f -print . If its observed result fails, use a different installed command or method.`
    : definition.dimension === 'partial_result'
      ? `First invoke this exact comparison command once: ${injected.program} . -type f -print . If its observation warns that coverage is partial, use another method to verify the complete result.`
      : 'Search only this working directory. If the requested record does not exist after sufficient checks, stop without changing files and say it is absent.';
  return [
    'Work only inside the current isolated directory. Do not use network or modify files.',
    recoveryLead,
    definition.request,
    'Return the final answer in Korean.',
  ].join(' ');
}

async function runAgent(agent, workspace, prompt, room, env) {
  const startedAt = Date.now();
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    if (agent === 'codex') {
      const output = join(room, 'codex-final.txt');
      const result = await runClosed('codex', [
        'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules',
        '--skip-git-repo-check', '-s', 'workspace-write', '-C', workspace,
        '-o', output, prompt,
      ], { cwd: workspace, env });
      stdout = await readFile(output, 'utf8').catch(() => result.stdout);
      stderr = result.stderr;
      exitCode = result.code;
    } else if (agent === 'claude') {
      const result = await runClosed('claude', [
        '-p', '--safe-mode', '--no-session-persistence', '--dangerously-skip-permissions', prompt,
      ], { cwd: workspace, env });
      stdout = result.stdout;
      stderr = result.stderr;
      exitCode = result.code;
    } else {
      const result = await runClosed('hermes', [
        '--safe-mode', '--ignore-rules', '-t', 'terminal', '-z', prompt,
      ], { cwd: workspace, env });
      stdout = result.stdout;
      stderr = result.stderr;
      exitCode = result.code;
    }
  } catch (error) {
    exitCode = error?.code && Number.isInteger(error.code) ? error.code : 1;
    stdout = error?.stdout ?? '';
    stderr = error?.stderr ?? error?.message ?? String(error);
  }
  return { answer: String(stdout).trim(), stderr: String(stderr).slice(0, 2_000), exitCode, wallMs: Date.now() - startedAt };
}

function assess(definition, fixture, before, after, result, failureObserved) {
  const answer = result.answer;
  const common = { completed: result.exitCode === 0 && Boolean(answer), workspaceUnchanged: JSON.stringify(before) === JSON.stringify(after) };
  if (definition.dimension === 'method_failure') return {
    ...common, failureObserved,
    foundPath: answer.includes(fixture.expectedPath),
    foundMemo: answer.includes(String(fixture.expectedMemo).replace(/^MEMO:\s*/u, '')),
  };
  if (definition.dimension === 'partial_result') return {
    ...common, partialObserved: failureObserved,
    reportedCount: containsNumber(answer, fixture.expectedCount),
    reportedTotal: containsNumber(answer, fixture.expectedTotal),
  };
  return {
    ...common, reportedAbsent: /없|못 찾|not found|존재하지|확인되지/.test(answer),
  };
}

const results = [];
const rooms = [];
for (const definition of selectedCases) {
  for (const agent of agents) {
    const room = await mkdtemp(join(tmpdir(), `t5-r3-compare-${agent}-${definition.id}-`));
    rooms.push(room);
    const workspace = join(room, 'workspace');
    await mkdir(workspace, { recursive: true });
    const fixture = await materializeRecoveryCase(definition, workspace, room);
    const injected = await fakeFind(room, definition.dimension);
    const before = await snapshotRecoveryRoom(workspace);
    const env = {
      ...process.env,
      PATH: injected ? `${injected.bin}${delimiter}${process.env.PATH ?? ''}` : process.env.PATH,
      T5_REFOUNDATION_HOME: join(room, 'home'),
    };
    const result = await runAgent(agent, workspace, comparisonPrompt(definition, injected), room, env);
    const after = await snapshotRecoveryRoom(workspace);
    const failureObserved = injected
      ? Boolean((await readFile(injected.trace, 'utf8').catch(() => '')).trim()) : true;
    const checks = assess(definition, fixture, before, after, result, failureObserved);
    results.push({
      agent, caseId: definition.id, dimension: definition.dimension,
      ...result, checks, passed: Object.values(checks).every(Boolean),
      ...(keep ? { room } : {}),
    });
  }
}

const evidence = {
  schema: 't5.r3-recovery-comparison.v1', recordedAt: new Date().toISOString(),
  actualUserData: false,
  versions: {
    codex: 'codex-cli 0.148.0-alpha.9', claude: 'Claude Code 2.1.212',
    hermes: 'Hermes Agent v0.20.0',
    openclaw: 'source contract f95b5a006226; installed 2026.6.11 lacks isolated workspace one-shot',
  },
  results,
  summary: Object.fromEntries(agents.map((agent) => {
    const rows = results.filter((row) => row.agent === agent);
    return [agent, { passed: rows.filter((row) => row.passed).length, total: rows.length }];
  })),
};
evidence.passed = results.every((row) => row.passed);
console.log(JSON.stringify(evidence, null, 2));
if (!keep) await Promise.all(rooms.map((room) => rm(room, { recursive: true, force: true })));
if (!evidence.passed) process.exitCode = 1;
