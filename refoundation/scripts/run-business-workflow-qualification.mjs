#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  BUSINESS_MEMORY_PROMPT, BUSINESS_WORKFLOW_TURNS, assessBusinessWorkflow,
  createBusinessFixtureServer, summarizeQualificationPerformance,
} from '../src/business-workflow-qualification.js';
import { BROWSER_NAMESPACE, makeAgentBrowserDriver, sessionNameForOwner } from '../src/agent-browser-driver.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';

const runFile = promisify(execFile);
function option(name) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; }
const keep = process.argv.includes('--keep');
const requestedModelId = option('--model-id');
const evidencePath = option('--evidence') ? resolve(option('--evidence')) : null;
const room = await mkdtemp(join(tmpdir(), 't5-w6-business-'));
const stateDir = join(room, 'state');
const workspace = join(room, 'workspace');
const sourceConnectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
await Promise.all([mkdir(stateDir, { recursive: true }), mkdir(workspace, { recursive: true })]);

const originalHome = process.env.T5_REFOUNDATION_HOME;
process.env.T5_REFOUNDATION_HOME = workspace;
const fixture = createBusinessFixtureServer();
let consoleServer = null;
let consoleBase = null;

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function closeConsole(reason) {
  if (!consoleServer) return;
  consoleServer.closeWakeStreams();
  await consoleServer.closeBrowsers();
  await consoleServer.managedProcesses.stopAll(reason);
  await new Promise((resolveClose) => consoleServer.close(resolveClose));
  consoleServer = null;
  consoleBase = null;
}

let connectionFile = sourceConnectionFile;
if (requestedModelId) {
  const stored = JSON.parse(await readFile(sourceConnectionFile, 'utf8')); stored.activeId = requestedModelId;
  connectionFile = join(room, 'model-connection.json'); await writeFile(connectionFile, JSON.stringify(stored), { mode: 0o600 });
}
const access = makeConsoleModelAccess({ connectionFile, stateDir });
const computer = discoverComputerEnvironment({ userHome: workspace });

async function startConsole() {
  consoleServer = makeConsoleServer({
    stateDir, workspace, computerEnvironment: computer,
    webReadOptions: { allowPrivateUrls: true },
    modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
    browserDriverFactory: (sessionId) => makeAgentBrowserDriver({
      ownerId: sessionId,
      outputDirectory: join(stateDir, 'browser', sessionNameForOwner(sessionId), 'artifacts'),
    }),
  });
  consoleBase = await listen(consoleServer);
}

async function createSession() {
  const response = await fetch(`${consoleBase}/sessions`, { method: 'POST' });
  if (!response.ok) throw new Error(`session create failed: ${response.status}`);
  return response.json();
}

async function runDetails(runId) {
  if (!runId) return null;
  return fetch(`${consoleBase}/runs/${runId}`).then((response) => response.json());
}

function receiptsOf(run) {
  return (run?.events ?? [])
    .filter((event) => event.type === 'tool_completed')
    .map((event) => event.payload.receipt);
}

async function siteState(siteBase) {
  return fetch(`${siteBase}/state`).then((response) => response.json());
}

async function executeTurn(sessionId, id, prompt, siteBase) {
  process.stderr.write(`[w7] ${requestedModelId ?? 'active-model'} ${id}\n`);
  const response = await fetch(`${consoleBase}/turn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, text: prompt }),
    signal: AbortSignal.timeout(120_000),
  });
  const surface = await response.json();
  const run = await runDetails(surface.runId);
  return {
    id, prompt, answer: surface.reply ?? '', kind: surface.kind ?? null,
    httpStatus: response.status, runId: surface.runId ?? null,
    runStatus: run?.status ?? null, receipts: receiptsOf(run), run,
    stateAfter: structuredClone(await siteState(siteBase)),
  };
}

async function simulateUserLogin(sessionId) {
  const session = sessionNameForOwner(sessionId);
  const root = join(stateDir, 'browser', session);
  const binary = resolve('refoundation/node_modules/.bin/agent-browser');
  const args = [
    '--namespace', BROWSER_NAMESPACE,
    '--profile', join(root, 'profile'), '--headed', 'true', '--no-auto-dialog',
    '--idle-timeout', '10m', '--session', session, '--restore',
    '--download-path', join(root, 'downloads'), '--pin-tab', '--json',
  ];
  const env = {
    ...process.env, HOME: root, USERPROFILE: root,
    AGENT_BROWSER_SOCKET_DIR: `/private/tmp/t5-ab-${process.getuid?.() ?? 'user'}`,
    AGENT_BROWSER_AUTOSAVE_INTERVAL_MS: '0',
  };
  const filled = JSON.parse((await runFile(binary, [
    ...args, 'fill', 'input[type="password"]', 'fixture-only-secret',
  ], { encoding: 'utf8', env })).stdout);
  if (filled.success !== true) throw new Error('simulated user login fill failed');
  const clicked = JSON.parse((await runFile(binary, [...args, 'click', '#user-login'], {
    encoding: 'utf8', env,
  })).stdout);
  if (clicked.success !== true) throw new Error('simulated user login click failed');
  await runFile(binary, [...args, 'wait', '1000'], { encoding: 'utf8', env });
}

const results = [];
let siteBase;
try {
  siteBase = await listen(fixture.server);
  await startConsole();

  const memorySession = await createSession();
  const memoryTurn = await executeTurn(
    memorySession.id, 'memory-prelude', BUSINESS_MEMORY_PROMPT, siteBase,
  );

  const mainSession = await createSession();
  let downloadReceipt = null;
  let uploadReceipt = null;

  for (const definition of BUSINESS_WORKFLOW_TURNS) {
    if (definition.restartBefore) {
      await closeConsole('w6_business_restart');
      await startConsole();
    }
    const prompt = definition.prompt(siteBase, {});
    const turn = await executeTurn(mainSession.id, definition.id, prompt, siteBase);
    results.push(turn);
    if (turn.httpStatus !== 200 || turn.runStatus !== 'completed' || !turn.answer.trim()) break;
    if (definition.id === 'login-and-overview') {
      const loginStart = turn.receipts.find((receipt) => receipt.requestedCall?.args?.action === 'login_start');
      const observedLoginPage = turn.receipts.some((receipt) => receipt.requestedCall?.name === 'browser'
        && receipt.requestedCall?.args?.action === 'navigate'
        && /\/login(?:$|[?#])/u.test(String(receipt.result?.tab?.url ?? receipt.result?.observation?.refScope?.url ?? '')));
      if (loginStart || observedLoginPage) await simulateUserLogin(mainSession.id);
    }
    if (definition.id === 'download-settlement') {
      downloadReceipt = turn.receipts.find((receipt) => receipt.requestedCall?.args?.action === 'download') ?? null;
    }
    if (definition.id === 'upload-downloaded') {
      uploadReceipt = turn.receipts.find((receipt) => receipt.requestedCall?.args?.action === 'upload') ?? null;
    }
  }

  const memory = await fetch(`${consoleBase}/memory/state`).then((response) => response.json());
  const finalState = await siteState(siteBase);
  if (downloadReceipt) downloadReceipt.expectedSha256 = fixture.pdf.sha256;
  const artifactAfterRestart = downloadReceipt?.result?.artifact?.attachmentId
    ? await consoleServer.attachmentStore.get({
      sessionId: mainSession.id, attachmentId: downloadReceipt.result.artifact.attachmentId,
    }) : null;
  const verdict = assessBusinessWorkflow({
    turns: results, finalState, memoryItems: memory.items,
    downloadReceipt, uploadReceipt, artifactAfterRestart,
  });
  const connection = await access.status();
  const performance = summarizeQualificationPerformance([
    memoryTurn.run, ...results.map((turn) => turn.run),
  ]);
  const evidence = {
    schema: 't5.r6-w6a-business-workflow-live.v1',
    recordedAt: new Date().toISOString(),
    model: connection.modelId ?? null,
    provider: connection.provider ?? null,
    actualUserData: false,
    actualBusinessAccount: false,
    simulatedUserLoginActions: 1,
    memoryPrelude: {
      answer: memoryTurn.answer,
      runStatus: memoryTurn.runStatus,
      toolNames: memoryTurn.receipts.map((receipt) => receipt.requestedCall?.name),
    },
    sessionId: mainSession.id,
    naturalLanguageTurns: results.length + 1,
    performance,
    checks: verdict.checks,
    actions: verdict.actions,
    finalState: {
      logins: finalState.logins,
      reservationMutations: finalState.reservationMutations,
      replyCount: finalState.replies.length,
      downloadCount: finalState.downloads,
      uploads: finalState.uploads,
    },
    fileRoundTrip: downloadReceipt && uploadReceipt ? {
      attachmentId: downloadReceipt.result.artifact?.attachmentId ?? null,
      bytes: downloadReceipt.result.file.bytes,
      sha256: downloadReceipt.result.file.sha256,
      uploadArtifactMatched: uploadReceipt.requestedCall.args.attachmentId === downloadReceipt.result.artifact?.attachmentId,
      uploadShaMatched: uploadReceipt.result.file.sha256 === downloadReceipt.result.file.sha256,
      artifactPersistedAfterRestart: artifactAfterRestart?.sha256 === downloadReceipt.result.artifact?.sha256,
    } : null,
    turns: results.map((turn) => ({
      id: turn.id, answer: turn.answer,
      runId: turn.runId, runStatus: turn.runStatus,
      actions: turn.receipts.map((receipt) => ({
        name: receipt.requestedCall?.name,
        action: receipt.requestedCall?.args?.action ?? null,
        outcome: receipt.outcome,
        state: receipt.result?.state ?? null,
        actual: receipt.actualCall != null,
      })),
    })),
    room: keep ? room : null,
    passed: verdict.passed,
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (evidencePath) { await mkdir(dirname(evidencePath), { recursive: true }); await writeFile(evidencePath, serialized, 'utf8'); }
  process.stdout.write(serialized);
  if (!evidence.passed) process.exitCode = 1;
} finally {
  await closeConsole('w6_business_shutdown').catch(() => {});
  if (fixture.server.listening) await new Promise((resolveClose) => fixture.server.close(resolveClose));
  if (originalHome == null) delete process.env.T5_REFOUNDATION_HOME;
  else process.env.T5_REFOUNDATION_HOME = originalHome;
  if (!keep) await rm(room, { recursive: true, force: true });
}
