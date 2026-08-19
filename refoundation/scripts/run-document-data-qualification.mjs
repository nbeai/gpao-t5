#!/usr/bin/env node
import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  DOCUMENT_DATA_TURNS, assessDocumentDataQualification, createDocumentDataFixture,
  hashDocumentSources,
} from '../src/document-data-qualification.js';
import { inspectBusinessDocument } from '../src/document-data-inspector.js';
import { summarizeQualificationPerformance } from '../src/business-workflow-qualification.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';

const keep = process.argv.includes('--keep');
const room = await mkdtemp(join(tmpdir(), 't5-d1-documents-'));
const stateDir = join(room, 'state');
const workspace = join(room, 'workspace');
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
await Promise.all([mkdir(stateDir, { recursive: true }), mkdir(workspace, { recursive: true })]);

const originalHome = process.env.T5_REFOUNDATION_HOME;
process.env.T5_REFOUNDATION_HOME = workspace;
const access = makeConsoleModelAccess({ connectionFile, stateDir });
const computer = discoverComputerEnvironment({ userHome: workspace });
const server = makeConsoleServer({
  stateDir, workspace, computerEnvironment: computer,
  modelFactory: (context) => access.model(context),
  modelStatus: () => access.status(),
});

async function listen() {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function outputFiles(outputPath) {
  try {
    const stat = await lstat(outputPath);
    return stat.isFile() ? [await realpath(outputPath)] : [];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function receiptsOf(run) {
  return (run?.events ?? []).filter((event) => event.type === 'tool_completed')
    .map((event) => event.payload.receipt);
}

async function runDetails(base, runId) {
  return fetch(`${base}/runs/${runId}`).then((response) => response.json());
}

async function executeTurn(base, sessionId, definition, fixture) {
  const prompt = definition.prompt(fixture.sourceDirectory, fixture.outputPath);
  const response = await fetch(`${base}/turn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, text: prompt }),
  });
  const surface = await response.json();
  const run = surface.runId ? await runDetails(base, surface.runId) : null;
  return {
    id: definition.id,
    prompt,
    answer: surface.reply ?? '',
    httpStatus: response.status,
    runId: surface.runId ?? null,
    runStatus: run?.status ?? null,
    receipts: receiptsOf(run),
    run,
    stateAfter: { outputFiles: await outputFiles(fixture.outputPath) },
  };
}

let base;
const turns = [];
try {
  const fixture = await createDocumentDataFixture(workspace);
  base = await listen();
  const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
  for (const definition of DOCUMENT_DATA_TURNS) {
    const turn = await executeTurn(base, session.id, definition, fixture);
    turns.push(turn);
    if (turn.httpStatus !== 200 || turn.runStatus !== 'completed' || !turn.answer.trim()) break;
  }

  const sourceAfter = await hashDocumentSources(fixture.sourcePaths);
  const outputObservation = (await outputFiles(fixture.outputPath)).length
    ? await inspectBusinessDocument({ file: fixture.outputPath }) : null;
  const verdict = assessDocumentDataQualification({
    turns,
    sourcePaths: fixture.sourcePaths,
    outputPath: fixture.outputPath,
    outputObservation,
    sourceBefore: fixture.sourceBefore,
    sourceAfter,
  });
  const connection = await access.status();
  const evidence = {
    schema: 't5.r7-d1-document-data-live.v1',
    recordedAt: new Date().toISOString(),
    model: connection.modelId ?? null,
    provider: connection.provider ?? null,
    actualUserData: false,
    fixtureFiles: fixture.sourcePaths.map((file) => file.split('/').at(-1)),
    naturalLanguageTurns: turns.length,
    performance: summarizeQualificationPerformance(turns.map((turn) => turn.run)),
    checks: verdict.checks,
    method: verdict.method,
    sourceHashesUnchanged: JSON.stringify(fixture.sourceBefore) === JSON.stringify(sourceAfter),
    output: outputObservation ? {
      path: outputObservation.file.path,
      bytes: outputObservation.file.bytes,
      sha256: outputObservation.file.sha256,
      sheets: outputObservation.workbook.sheets.map((sheet) => sheet.name),
      totals: outputObservation.workbook.totals,
    } : null,
    turns: turns.map((turn) => ({
      id: turn.id, answer: turn.answer, runId: turn.runId, runStatus: turn.runStatus,
      tools: turn.receipts.map((receipt) => ({
        name: receipt.requestedCall?.name,
        outcome: receipt.outcome,
        state: receipt.result?.state ?? null,
      })),
    })),
    room: keep ? room : null,
    passed: verdict.passed,
  };
  console.log(JSON.stringify(evidence, null, 2));
  if (!evidence.passed) process.exitCode = 1;
} finally {
  server.closeWakeStreams();
  await server.closeBrowsers().catch(() => {});
  await server.managedProcesses.stopAll('d1_document_shutdown').catch(() => {});
  if (server.listening) await new Promise((resolveClose) => server.close(resolveClose));
  if (originalHome == null) delete process.env.T5_REFOUNDATION_HOME;
  else process.env.T5_REFOUNDATION_HOME = originalHome;
  if (!keep) await rm(room, { recursive: true, force: true });
}
