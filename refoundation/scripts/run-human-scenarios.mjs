#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { ConsoleSessionStore } from '../src/console-session-store.js';
import {
  HUMAN_SCENARIOS, assessHumanScenario, materializeHumanScenario, snapshotHumanFiles,
} from '../src/human-scenarios.js';

const keep = process.argv.includes('--keep');
const scenarioIndex = process.argv.indexOf('--scenario');
const scenarioId = scenarioIndex >= 0 ? process.argv[scenarioIndex + 1] : null;
const selectedScenarios = scenarioId
  ? HUMAN_SCENARIOS.filter((scenario) => scenario.id === scenarioId) : HUMAN_SCENARIOS;
if (scenarioId && !selectedScenarios.length) throw new TypeError(`unknown --scenario: ${scenarioId}`);
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server, reason) {
  server.closeWakeStreams();
  await server.managedProcesses.stopAll(reason);
  await new Promise((resolveClose) => server.close(resolveClose));
}

async function runDetails(base, runId) {
  if (!runId) return null;
  return fetch(`${base}/runs/${runId}`).then((response) => response.json());
}

function toolFacts(runs) {
  const events = runs.flatMap((run) => run?.events ?? []);
  const names = events.filter((event) => event.type === 'tool_completed')
    .map((event) => event.payload.receipt.requestedCall.name);
  return {
    toolNames: names,
    computerToolCalls: names.filter((name) => (
      ['exec', 'process_start', 'process_control', 'pty_start'].includes(name)
    )).length,
  };
}

async function observe(base, home) {
  const files = await snapshotHumanFiles(home);
  const memory = await fetch(`${base}/memory/state`).then((response) => response.json());
  return {
    files, memoryItems: memory.items,
    notificationConfigured: existsSync(join(home, '.fake-notification-state')),
  };
}

const originalHome = process.env.T5_REFOUNDATION_HOME;
const originalPath = process.env.PATH;
const results = [];
const rooms = [];
try {
  for (const definition of selectedScenarios) {
    const room = await mkdtemp(join(tmpdir(), `t5-r4-${definition.id}-`));
    rooms.push(room);
    const home = join(room, 'home');
    const stateDir = join(room, 'state');
    const skillsRoot = join(room, 'skills-none');
    await Promise.all([home, stateDir].map((path) => mkdir(path, { recursive: true })));
    const fixture = await materializeHumanScenario(definition, home, room);
    process.env.T5_REFOUNDATION_HOME = home;
    process.env.PATH = fixture.bin ? `${fixture.bin}${delimiter}${originalPath ?? ''}` : originalPath;
    const baseComputer = discoverComputerEnvironment({ userHome: home });
    const computer = fixture.shellProgram ? {
      ...baseComputer,
      commandRuntime: { ...baseComputer.commandRuntime, program: fixture.shellProgram },
    } : baseComputer;
    const access = makeConsoleModelAccess({ connectionFile, stateDir });
    const server = makeConsoleServer({
      stateDir, workspace: home, skillsRoot, computerEnvironment: computer,
      modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
    });
    const base = await listen(server);
    const sessions = new ConsoleSessionStore(stateDir);
    let session = await sessions.create();
    const turns = [];
    const observations = [await observe(base, home)];
    const startedAt = Date.now();
    try {
      for (const [index, step] of definition.turns.entries()) {
        if (step.newSessionBefore) session = await sessions.create();
        const response = await fetch(`${base}/turn`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id, text: step.prompt }),
        });
        let surface = await response.json();
        const runs = [await runDetails(base, surface.runId)];
        let approvals = 0;
        if (surface.kind === 'approval' && surface.pendingId && step.approveIfRequested) {
          approvals += 1;
          const approvedResponse = await fetch(`${base}/turn`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: session.id, approve: surface.pendingId }),
          });
          surface = await approvedResponse.json();
          runs.push(await runDetails(base, surface.runId));
        }
        const facts = toolFacts(runs);
        turns.push({
          turn: index + 1, sessionId: session.id, prompt: step.prompt,
          answer: surface.reply ?? '', kind: surface.kind ?? null,
          pendingId: surface.pendingId ?? null, approvals,
          httpStatus: response.status,
          runStatus: runs.every((run) => run?.status === 'completed') ? 'completed' : runs.map((run) => run?.status).join(','),
          ...facts,
        });
        observations.push(await observe(base, home));
      }
    } finally {
      await close(server, 'human_scenario_shutdown');
    }
    const verdict = assessHumanScenario({ definition, turns, fixture, observations });
    results.push({
      id: definition.id, title: definition.title, turns: definition.turns.length,
      durationMs: Date.now() - startedAt, checks: verdict.checks, passed: verdict.passed,
      transcript: turns.map((turn) => ({
        turn: turn.turn, prompt: turn.prompt, answer: turn.answer,
        toolNames: turn.toolNames, approvals: turn.approvals,
      })),
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
  schema: 't5.r4-human-scenarios.v1', recordedAt: new Date().toISOString(),
  model: 'gpt-5.5', actualUserData: false,
  scenarioCount: results.length, naturalLanguageTurns: results.reduce((sum, row) => sum + row.turns, 0),
  results, passed: results.every((row) => row.passed),
};
console.log(JSON.stringify(evidence, null, 2));
if (!keep) await Promise.all(rooms.map((room) => rm(room, { recursive: true, force: true })));
if (!evidence.passed) process.exitCode = 1;
