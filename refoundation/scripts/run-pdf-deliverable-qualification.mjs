#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { inspectBusinessDocument } from '../src/document-data-inspector.js';
import {
  PDF_DELIVERABLE_CASUAL_TURNS, PDF_DELIVERABLE_TURNS, assessPdfDeliverableQualification,
  createPdfDeliverableFixture, renderPdfReality,
} from '../src/pdf-deliverable-qualification.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';

const keep = process.argv.includes('--keep'); const room = await mkdtemp(join(tmpdir(), 't5-d3-pdf-truth-'));
const variant = process.argv.includes('--casual') ? 'casual' : 'canonical';
const definitions = variant === 'casual' ? PDF_DELIVERABLE_CASUAL_TURNS : PDF_DELIVERABLE_TURNS;
const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
await Promise.all([mkdir(stateDir, { recursive: true }), mkdir(workspace, { recursive: true })]);
const originalHome = process.env.T5_REFOUNDATION_HOME; process.env.T5_REFOUNDATION_HOME = workspace;
const access = makeConsoleModelAccess({ connectionFile, stateDir }); const computer = discoverComputerEnvironment({ userHome: workspace });
const server = makeConsoleServer({
  stateDir, workspace, computerEnvironment: computer,
  modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
});

async function listen() { await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); }); return `http://127.0.0.1:${server.address().port}`; }
async function exists(path) { try { return (await lstat(path)).isFile(); } catch (error) { if (error?.code === 'ENOENT') return false; throw error; } }
async function digest(path) { return createHash('sha256').update(await readFile(path)).digest('hex'); }
function receipts(run) { return (run?.events ?? []).filter((event) => event.type === 'tool_completed').map((event) => event.payload.receipt); }

const turns = [];
try {
  const fixture = await createPdfDeliverableFixture(workspace); const base = await listen();
  const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
  for (const definition of definitions) {
    const prompt = definition.prompt(fixture.sourcePath, fixture.outputPath);
    const response = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id, text: prompt }) });
    const surface = await response.json(); const run = surface.runId ? await fetch(`${base}/runs/${surface.runId}`).then((item) => item.json()) : null;
    turns.push({ id: definition.id, prompt, answer: surface.reply ?? '', runId: surface.runId ?? null, runStatus: run?.status ?? null, receipts: receipts(run), run, stateAfter: { outputExists: await exists(fixture.outputPath) } });
    if (response.status !== 200 || run?.status !== 'completed' || !surface.reply?.trim()) break;
  }
  const outputExists = await exists(fixture.outputPath); const outputPath = outputExists ? await realpath(fixture.outputPath) : null;
  const outputObservation = outputPath ? await inspectBusinessDocument({ file: outputPath, maxPages: 5, maxPageChars: 20_000 }) : null;
  const renderReality = outputPath ? await renderPdfReality(outputPath) : null; const sourceSha256After = await digest(fixture.sourcePath);
  const verdict = assessPdfDeliverableQualification({ turns, outputObservation, renderReality, sourceSha256Before: fixture.sourceSha256, sourceSha256After });
  const status = await access.status(); const evidence = {
    schema: 't5.d3-t0-pdf-deliverable-live.v1', recordedAt: new Date().toISOString(), actualUserData: false,
    variant,
    model: status.modelId ?? null, provider: status.provider ?? null,
    performance: {
      runs: turns.length,
      modelTurns: turns.reduce((sum, turn) => sum + (turn.run?.events ?? []).filter((event) => event.type === 'model_completed').length, 0),
      visualObservationModelCalls: turns.reduce((sum, turn) => sum + (turn.run?.events ?? []).filter((event) => event.type === 'visual_observation_model_completed').length, 0),
      toolCalls: turns.flatMap((turn) => turn.receipts).length,
    },
    output: outputObservation ? { path: outputObservation.file.path, bytes: outputObservation.file.bytes, sha256: outputObservation.file.sha256, pageCount: outputObservation.pdf.pageCount, extractableChars: outputObservation.pdf.extractableChars } : null,
    renderReality, checks: verdict.checks, falseCompletion: verdict.falseCompletion,
    falseCompletionAtCreation: verdict.falseCompletionAtCreation, falseCompletionAtFinal: verdict.falseCompletionAtFinal,
    claims: verdict.claims, matchedAnchors: verdict.matchedAnchors,
    isolatedVisual: verdict.isolatedVisual,
    turns: turns.map((turn) => ({ id: turn.id, runId: turn.runId, runStatus: turn.runStatus, answer: turn.answer, tools: turn.receipts.map((receipt) => ({ name: receipt.requestedCall?.name, outcome: receipt.outcome, state: receipt.result?.state ?? null })) })),
    room: keep ? room : null, passed: verdict.passed,
  };
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`); if (!evidence.passed) process.exitCode = 1;
} finally {
  server.closeWakeStreams(); await server.closeBrowsers().catch(() => {}); await server.managedProcesses.stopAll('d3_pdf_truth_shutdown').catch(() => {});
  if (server.listening) await new Promise((ok) => server.close(ok));
  if (originalHome == null) delete process.env.T5_REFOUNDATION_HOME; else process.env.T5_REFOUNDATION_HOME = originalHome;
  if (!keep) await rm(room, { recursive: true, force: true });
}
