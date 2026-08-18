#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';

import { runAgent } from '../src/agent-loop.js';
import { discoverComputerEnvironment, publicComputerFacts } from '../src/computer-environment.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeExecTool } from '../src/exec-tool.js';
import {
  TERMINAL_PERFORMANCE_CASES,
  assessTerminalPerformanceCase,
  materializeTerminalPerformanceCase,
  snapshotTerminalRoom,
} from '../src/terminal-performance.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const evidencePath = resolve(option('--evidence')
  ?? 'refoundation/evidence/r1-terminal-performance-attempt1.json');
const keep = process.argv.includes('--keep');
const connectionFile = process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const runtimeFiles = [
  'package.json',
  'refoundation/src/agent-loop.js',
  'refoundation/src/computer-environment.js',
  'refoundation/src/console-model-factory.js',
  'refoundation/src/exec-tool.js',
  'refoundation/src/terminal-performance.js',
  'refoundation/scripts/run-terminal-performance.mjs',
];
const runtimeHash = createHash('sha256');
for (const file of runtimeFiles) {
  runtimeHash.update(file); runtimeHash.update('\0');
  runtimeHash.update(await readFile(resolve(file))); runtimeHash.update('\0');
}
let runtimeFilesDirty = false;
try { execFileSync('git', ['diff', '--quiet', 'HEAD', '--', ...runtimeFiles]); }
catch { runtimeFilesDirty = true; }

const cases = [];
const rooms = [];
let connection = null;
for (const definition of TERMINAL_PERFORMANCE_CASES) {
  const room = await mkdtemp(join(tmpdir(), `t5-terminal-${definition.id}-`));
  rooms.push(room);
  const home = join(room, 'home');
  const workspace = join(room, 'workspace');
  const stateDir = join(room, 'state');
  await Promise.all([home, workspace, stateDir].map((path) => mkdir(path, { recursive: true })));
  const fixture = await materializeTerminalPerformanceCase(definition, workspace);
  const before = await snapshotTerminalRoom(workspace);
  const computer = discoverComputerEnvironment({ userHome: home });
  const access = makeConsoleModelAccess({ connectionFile, stateDir });
  connection ??= await access.status();
  const model = await access.model({
    sessionId: definition.id,
    workspace,
    computer: publicComputerFacts(computer),
  });
  const toolEnv = fixture.pathPrefix
    ? { PATH: `${fixture.pathPrefix}${delimiter}${process.env.PATH ?? ''}` }
    : {};
  const previousHome = process.env.T5_REFOUNDATION_HOME;
  process.env.T5_REFOUNDATION_HOME = home;
  const startedAt = Date.now();
  let agentResult;
  let runError = null;
  try {
    agentResult = await runAgent({
      request: definition.request,
      model,
      tools: [makeExecTool({ workingDirectory: workspace, computer, env: toolEnv })],
      maxModelTurns: 32,
    });
  } catch (error) {
    runError = error?.message ?? String(error);
    agentResult = { status: 'failed', answer: null, receipts: [], modelCalls: [], modelTurns: 0 };
  } finally {
    if (previousHome == null) delete process.env.T5_REFOUNDATION_HOME;
    else process.env.T5_REFOUNDATION_HOME = previousHome;
  }
  const after = await snapshotTerminalRoom(workspace);
  const verdict = assessTerminalPerformanceCase({ definition, fixture, before, after, agentResult });
  cases.push({
    id: definition.id,
    dimension: definition.dimension,
    request: definition.request,
    durationMs: Date.now() - startedAt,
    status: agentResult.status,
    answer: agentResult.answer,
    modelTurns: agentResult.modelTurns,
    modelCalls: agentResult.modelCalls,
    toolCalls: agentResult.receipts.map((receipt) => ({
      command: receipt.actualCall?.args?.command ?? null,
      cwd: receipt.result?.cwd ?? null,
      outcome: receipt.outcome,
      exitCode: receipt.result?.exitCode ?? null,
      stopped: receipt.result?.stopped ?? null,
      truncated: Boolean(receipt.result?.truncated),
      stdoutChars: String(receipt.result?.stdout ?? '').length,
      stderrChars: String(receipt.result?.stderr ?? '').length,
      steps: (receipt.result?.commandExplanation?.steps ?? []).map((step) => step.executable),
      operators: (receipt.result?.commandExplanation?.operators ?? []).map((operator) => operator.kind),
    })),
    checks: verdict.checks,
    runError,
    passed: verdict.passed,
    ...(keep ? { room } : {}),
  });
}

const evidence = {
  schema: 't5.refoundation.terminal-performance.v1',
  observedAt: new Date().toISOString(),
  sourceCommit,
  runtimeDigest: runtimeHash.digest('hex'),
  runtimeFilesDirty,
  connection: connection ? { provider: connection.provider, modelId: connection.modelId } : null,
  cases,
};
evidence.passed = !runtimeFilesDirty
  && cases.length === TERMINAL_PERFORMANCE_CASES.length
  && cases.every((entry) => entry.passed);
await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  evidence: evidencePath,
  runtimeFilesDirty,
  passed: evidence.passed,
  cases: cases.map((entry) => ({
    id: entry.id, dimension: entry.dimension, passed: entry.passed,
    modelTurns: entry.modelTurns, toolCalls: entry.toolCalls.length, checks: entry.checks,
  })),
}, null, 2));
if (!keep) await Promise.all(rooms.map((room) => rm(room, { recursive: true, force: true })));
if (!evidence.passed) process.exitCode = 1;
