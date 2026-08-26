#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  diffS3BusinessWorkspace, snapshotS3BusinessWorkspace,
} from '../src/s3-human-business-scenarios.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const room = resolve(option('--room') ?? '');
if (!option('--room')) throw new Error('--room is required');
const control = join(room, 'tester-control');
const manifest = JSON.parse(await readFile(join(control, 'run-manifest.json'), 'utf8'));
const assessment = JSON.parse(await readFile(join(control, 'human-assessment.json'), 'utf8'));
const stateDir = manifest.paths.stateDir;
const workspaceAfter = await snapshotS3BusinessWorkspace(manifest.paths.workspace);
const workspaceDiff = diffS3BusinessWorkspace(manifest.baseline, workspaceAfter);

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return fallback; throw error; }
}

async function readJsonl(path) {
  try {
    return (await readFile(path, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

const sessionState = await readJson(join(stateDir, 'console-sessions.json'), { sessions: [] });
const runDirectory = join(stateDir, 'runs');
let runFiles = [];
try { runFiles = (await readdir(runDirectory)).filter((name) => name.endsWith('.jsonl')).sort(); }
catch (error) { if (error?.code !== 'ENOENT') throw error; }
const runs = await Promise.all(runFiles.map(async (name) => ({
  runId: name.slice(0, -'.jsonl'.length), events: await readJsonl(join(runDirectory, name)),
})));
const allEvents = runs.flatMap((run) => run.events.map((event) => ({ ...event, runId: run.runId })));
const modelEvents = allEvents.filter((event) => event.type === 'model_completed');
const toolEvents = allEvents.filter((event) => event.type === 'tool_completed');
const surfaceMetrics = allEvents.filter((event) => event.type === 'surface_metric')
  .map((event) => event.payload ?? {});
const toolReceipts = toolEvents.map((event) => event.payload?.receipt).filter(Boolean);
const visibleResults = sessionState.sessions.flatMap((session) => (
  (session.transcript ?? []).filter((entry) => entry.role === 'assistant').map((entry) => entry.result)
));
const visibleAnswers = visibleResults.map((result) => String(result?.reply ?? '')).filter(Boolean);
const digest = (value) => createHash('sha256').update(String(value)).digest('hex');
const terminalTypes = new Map([
  ['run_completed', 'completed'], ['run_failed', 'failed'],
  ['run_cancelled', 'cancelled'], ['run_interrupted', 'interrupted'],
]);
const runSummaries = runs.map((run) => {
  const terminal = [...run.events].reverse().find((event) => terminalTypes.has(event.type));
  const firstAt = Date.parse(run.events[0]?.recordedAt ?? '');
  const lastAt = Date.parse(run.events.at(-1)?.recordedAt ?? '');
  return {
    runId: run.runId, status: terminal ? terminalTypes.get(terminal.type) : 'unknown',
    eventCount: run.events.length,
    wallMs: Number.isFinite(firstAt) && Number.isFinite(lastAt) ? Math.max(0, lastAt - firstAt) : null,
  };
});

const providerTokens = modelEvents.reduce((sum, event) => (
  sum + Number(event.payload?.response?.usage?.total_tokens ?? 0)
), 0);
const requestBytes = modelEvents.reduce((sum, event) => (
  sum + Number(event.payload?.response?.contextReceipt?.requestBytes ?? 0)
), 0);
const approvalRequests = toolReceipts.filter((receipt) => (
  receipt.result?.state === 'approval_required'
)).length;
const connectorAttempts = toolReceipts.filter((receipt) => (
  ['connection', 'capability_prepare', 'cli_prepare'].includes(receipt.requestedCall?.name)
)).length;
const externalWrites = toolReceipts.filter((receipt) => (
  ['external_change', 'external_send', 'payment'].includes(receipt.requestedCall?.args?.effect?.kind)
  && receipt.actualCall
)).length;
const verifiedArtifacts = visibleResults.flatMap((result) => result?.artifacts ?? []).filter((artifact) => (
  artifact?.attachmentId && artifact?.sha256 && Number.isFinite(artifact?.bytes)
)).length;
const internalTerms = /pendingId|toolCallId|local_change|session_search|terminal_session|runId|approvalToken|RecordRef|pending_surface/u;
const firstFeedback = surfaceMetrics.find((item) => item.event === 'first_feedback_visible')?.elapsedMs ?? null;
const firstGrounded = surfaceMetrics.find((item) => item.event === 'first_grounded_content')?.elapsedMs ?? null;
const requiredAssessment = manifest?.scenario?.id
  ? Object.keys(assessment).filter((key) => !['schema', 'scenarioId', 'modelId', 'notes'].includes(key)) : [];
const assessmentComplete = requiredAssessment.every((key) => assessment[key] !== null);

const summary = {
  schema: 't5.s3.human-business-live-summary.v1',
  summarizedAt: new Date().toISOString(),
  sourceCommit: manifest.sourceCommit,
  scenario: manifest.scenario,
  variant: manifest.variant,
  model: manifest.model,
  environment: manifest.environment,
  boundaries: manifest.boundaries,
  machineObservation: {
    sessionCount: sessionState.sessions.length,
    userTurns: sessionState.sessions.reduce((sum, session) => (
      sum + (session.transcript ?? []).filter((entry) => entry.role === 'user').length
    ), 0),
    assistantSurfaces: visibleResults.length,
    runSummaries,
    modelCalls: modelEvents.length,
    toolCalls: toolEvents.length,
    toolNames: toolReceipts.map((receipt) => receipt.requestedCall?.name).filter(Boolean),
    providerTokens, requestBytes,
    firstFeedbackMs: firstFeedback,
    firstMeaningfulGroundedMs: firstGrounded,
    approvalRequests, connectorAttempts, externalWrites,
    verifiedArtifacts,
    internalTermExposure: visibleAnswers.some((answer) => internalTerms.test(answer)),
    answerDigests: visibleAnswers.map((answer) => ({ sha256: digest(answer), chars: answer.length })),
    workspaceDiff,
  },
  humanAssessment: assessment,
  humanAssessmentComplete: assessmentComplete,
  verdict: assessmentComplete ? 'human_review_recorded' : 'pending_human_review',
  nonClaims: [
    'Tool success alone is not purpose achievement.',
    'A disconnected connector scenario is not proof that the connector is implemented.',
    'No real account or real external write was qualified by this environment.',
  ],
};

const output = resolve(option('--output') ?? join(control, 'run-summary.json'));
await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(summary, null, 2));
