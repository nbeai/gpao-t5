#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import {
  TEXT_TABULAR_CASUAL_TURNS, TEXT_TABULAR_TURNS,
  assessTextTabularQualification, createTextTabularFixtureBytes,
} from '../src/text-tabular-qualification.js';

const keep = process.argv.includes('--keep'); const variant = process.argv.includes('--casual') ? 'casual' : 'canonical';
const definitions = variant === 'casual' ? TEXT_TABULAR_CASUAL_TURNS : TEXT_TABULAR_TURNS;
const room = await mkdtemp(join(tmpdir(), 't5-d4-text-tabular-')); const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
await Promise.all([mkdir(stateDir, { recursive: true }), mkdir(workspace, { recursive: true })]);
const originalHome = process.env.T5_REFOUNDATION_HOME; process.env.T5_REFOUNDATION_HOME = workspace;
const access = makeConsoleModelAccess({ connectionFile, stateDir }); const computer = discoverComputerEnvironment({ userHome: workspace });
const server = makeConsoleServer({ stateDir, workspace, computerEnvironment: computer, modelFactory: (context) => access.model(context), modelStatus: () => access.status() });
async function listen() { await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); }); return `http://127.0.0.1:${server.address().port}`; }
function receipts(run) { return (run?.events ?? []).filter((event) => event.type === 'tool_completed').map((event) => event.payload.receipt); }
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

const turns = [];
try {
  const base = await listen(); const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
  const fixtures = createTextTabularFixtureBytes(); const records = [];
  for (const fixture of fixtures) {
    const response = await fetch(`${base}/attachments?sessionId=${session.id}&filename=${encodeURIComponent(fixture.fileName)}`, {
      method: 'POST', headers: { 'content-type': fixture.mimeType }, body: fixture.bytes,
    });
    const record = await response.json(); records.push({ ...fixture, attachmentId: record.attachmentId });
  }
  for (const [index, definition] of definitions.entries()) {
    const response = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: definition.prompt(), attachmentIds: index === 0 ? records.map((record) => record.attachmentId) : [] }),
    });
    const surface = await response.json(); const run = surface.runId ? await fetch(`${base}/runs/${surface.runId}`).then((item) => item.json()) : null;
    turns.push({ id: definition.id, answer: surface.reply ?? '', runId: surface.runId ?? null, runStatus: run?.status ?? null, receipts: receipts(run), run });
    if (response.status !== 200 || run?.status !== 'completed' || !surface.reply?.trim()) break;
  }
  const inputRecords = await Promise.all(records.map(async (record) => {
    const stored = await server.attachmentStore.get({ sessionId: session.id, attachmentId: record.attachmentId });
    return { key: record.key, sha256: record.sha256, afterSha256: hash(await readFile(stored.storedPath)), encoding: stored.encoding ?? null };
  }));
  const verdict = assessTextTabularQualification({ turns, inputRecords }); const status = await access.status();
  const evidence = {
    schema: 't5.d4-text-tabular-live.v1', recordedAt: new Date().toISOString(), actualUserData: false,
    model: status.modelId ?? null, provider: status.provider ?? null, variant,
    performance: {
      runs: turns.length,
      modelTurns: turns.reduce((sum, turn) => sum + (turn.run?.events ?? []).filter((event) => event.type === 'model_completed').length, 0),
      providerTokens: turns.reduce((sum, turn) => sum + (turn.run?.events ?? []).filter((event) => event.type === 'model_completed').reduce((part, event) => part + Number(event.payload?.response?.usage?.total_tokens ?? 0), 0), 0),
      toolCalls: turns.flatMap((turn) => turn.receipts).length,
    },
    inputRecords, checks: verdict.checks,
    turns: turns.map((turn) => ({ id: turn.id, runId: turn.runId, runStatus: turn.runStatus, answer: turn.answer, tools: turn.receipts.map((receipt) => ({ name: receipt.requestedCall?.name, outcome: receipt.outcome, state: receipt.result?.state ?? null })) })),
    room: keep ? room : null, passed: verdict.passed,
  };
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`); if (!evidence.passed) process.exitCode = 1;
} finally {
  server.closeWakeStreams(); await server.closeBrowsers().catch(() => {}); await server.managedProcesses.stopAll('d4_text_tabular_shutdown').catch(() => {});
  if (server.listening) await new Promise((ok) => server.close(ok));
  if (originalHome == null) delete process.env.T5_REFOUNDATION_HOME; else process.env.T5_REFOUNDATION_HOME = originalHome;
  if (!keep) await rm(room, { recursive: true, force: true });
}
