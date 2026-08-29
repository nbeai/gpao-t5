#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';

import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { ConsoleSessionStore } from '../src/console-session-store.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import {
  RECOVERY_CASES, assessRecoveryCase, materializeRecoveryCase, snapshotRecoveryRoom,
} from '../src/recovery-qualification.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const keep = process.argv.includes('--keep');
const evidencePath = option('--evidence') ? resolve(option('--evidence')) : null;
const sourceConnectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const sourceCommit = (await import('node:child_process')).execFileSync(
  'git', ['rev-parse', 'HEAD'], { encoding: 'utf8' },
).trim();
const runtimeFiles = [
  'refoundation/src/agent-loop.js', 'refoundation/src/console-server.js',
  'refoundation/src/exec-tool.js', 'refoundation/src/recovery-qualification.js',
  'refoundation/scripts/run-recovery-qualification.mjs',
];
const runtimeHash = createHash('sha256');
for (const file of runtimeFiles) {
  runtimeHash.update(file); runtimeHash.update('\0');
  runtimeHash.update(await readFile(resolve(file))); runtimeHash.update('\0');
}

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server, reason) {
  server.closeWakeStreams();
  server.closeModelConnections();
  await server.closeCommandExplainer();
  await server.closeMessengers();
  await server.managedProcesses.stopAll(reason);
  await new Promise((resolveClose) => server.close(resolveClose));
}

function callsFrom(run) {
  return (run?.events ?? []).filter((event) => event.type === 'tool_completed')
    .map((event) => event.payload.receipt);
}

const cases = [];
const rooms = [];
const originalPath = process.env.PATH;
const originalHome = process.env.T5_REFOUNDATION_HOME;
try {
  const storedConnection = JSON.parse(await readFile(sourceConnectionFile, 'utf8'));
  const selectedConnection = storedConnection.connections?.find((item) => item.id === 'chatgpt_oauth:gpt-5.5')
    ?? storedConnection.connections?.find((item) => item.id === storedConnection.activeId);
  if (!selectedConnection) throw new Error('qualified model connection unavailable');
  for (const definition of RECOVERY_CASES) {
    const room = await mkdtemp(join(tmpdir(), `t5-r3-${definition.id}-`));
    rooms.push(room);
    const workspace = join(room, 'workspace');
    const stateDir = join(room, 'state');
    const isolatedHome = join(room, 'home');
    const skillsRoot = join(room, 'skills-none');
    await Promise.all([workspace, stateDir, isolatedHome].map((path) => mkdir(path, { recursive: true })));
    const fixture = await materializeRecoveryCase(definition, workspace, room);
    const before = await snapshotRecoveryRoom(workspace);
    const baseComputer = discoverComputerEnvironment({ userHome: workspace });
    const computer = fixture.shellProgram ? {
      ...baseComputer,
      commandRuntime: { ...baseComputer.commandRuntime, program: fixture.shellProgram },
    } : baseComputer;
    process.env.T5_REFOUNDATION_HOME = isolatedHome;
    process.env.PATH = fixture.pathPrefix
      ? `${fixture.pathPrefix}${delimiter}${originalPath ?? ''}` : originalPath;
    const connectionFile = join(room, 'model-connection.json');
    await writeFile(connectionFile, JSON.stringify({ ...storedConnection,
      activeId: selectedConnection.id, connections: [selectedConnection] }), { mode: 0o600 });
    const access = makeConsoleModelAccess({ connectionFile, stateDir,
      secretStore: makePlatformSecretStore({ platform: computer.platform }) });
    const server = makeConsoleServer({
      stateDir, workspace, skillsRoot, computerEnvironment: computer,
      modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
    });
    const startedAt = Date.now();
    let base;
    let response;
    let surface;
    let run;
    let error = null;
    try {
      base = await listen(server);
      const session = await new ConsoleSessionStore(stateDir).create();
      response = await fetch(`${base}/turn`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, text: definition.request }),
      });
      surface = await response.json();
      run = surface.runId
        ? await fetch(`${base}/runs/${surface.runId}`).then((item) => item.json()) : null;
    } catch (caught) {
      error = caught?.message ?? String(caught);
    } finally {
      await close(server, 'recovery_qualification_shutdown');
    }
    const after = await snapshotRecoveryRoom(workspace);
    const calls = callsFrom(run);
    const verdict = assessRecoveryCase({
      definition, fixture, before, after,
      status: run?.status ?? 'unknown', answer: surface?.reply ?? '', calls,
    });
    cases.push({
      id: definition.id, dimension: definition.dimension, request: definition.request,
      httpStatus: response?.status ?? null, runId: surface?.runId ?? null,
      runStatus: run?.status ?? 'unknown', answer: surface?.reply ?? null,
      durationMs: Date.now() - startedAt,
      modelCalls: run?.events?.filter((event) => event.type === 'model_completed').length ?? null,
      toolCalls: calls.map((call) => ({
        name: call.requestedCall?.name, command: call.actualCall?.args?.command ?? null,
        action: call.actualCall?.args?.action ?? null, outcome: call.outcome,
        exitCode: call.result?.exitCode ?? call.result?.processExitCode ?? null,
        stderr: String(call.result?.stderr ?? '').slice(0, 500),
        state: call.result?.state ?? null,
      })),
      checks: verdict.checks, error, passed: verdict.passed,
      surfaceError: surface?.error ?? null,
      ...(keep ? { room } : {}),
    });
  }
} finally {
  if (originalHome == null) delete process.env.T5_REFOUNDATION_HOME;
  else process.env.T5_REFOUNDATION_HOME = originalHome;
  if (originalPath == null) delete process.env.PATH;
  else process.env.PATH = originalPath;
}

const evidence = {
  schema: 't5.r3-recovery-qualification.v1', recordedAt: new Date().toISOString(),
  sourceCommit, runtimeDigest: runtimeHash.digest('hex'), model: cases.length ? 'gpt-5.5' : null,
  actualUserData: false, cases,
  passed: cases.length === RECOVERY_CASES.length && cases.every((entry) => entry.passed),
};
if (evidencePath) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify({
  ...evidence,
  cases: evidence.cases.map((entry) => ({
    id: entry.id, dimension: entry.dimension, runId: entry.runId,
    runStatus: entry.runStatus, durationMs: entry.durationMs,
    modelCalls: entry.modelCalls, answer: entry.answer, toolCalls: entry.toolCalls,
    checks: entry.checks, passed: entry.passed, ...(keep ? { room: entry.room } : {}),
  })),
}, null, 2));
if (!keep) await Promise.all(rooms.map((room) => rm(room, { recursive: true, force: true })));
if (!evidence.passed) process.exitCode = 1;
