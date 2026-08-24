#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';

function option(name) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; }
const selected = option('--model-id');
const models = selected ? [selected] : ['api_key:openai:gpt-5.6-terra', 'chatgpt_oauth:gpt-5.5'];
const sourceConnectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const room = await mkdtemp(join(tmpdir(), 't5-d-time-live-')); const results = [];

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

for (const modelId of models) {
  const modelRoom = join(room, modelId.replaceAll(/[^a-z0-9.-]+/giu, '_'));
  const stateDir = join(modelRoom, 'state'); const workspace = join(modelRoom, 'workspace');
  await Promise.all([mkdir(stateDir, { recursive: true }), mkdir(workspace, { recursive: true })]);
  const stored = JSON.parse(await readFile(sourceConnectionFile, 'utf8')); stored.activeId = modelId;
  const connectionFile = join(modelRoom, 'model-connection.json');
  await writeFile(connectionFile, JSON.stringify(stored), { mode: 0o600 });
  const access = makeConsoleModelAccess({ connectionFile, stateDir });
  const server = makeConsoleServer({ stateDir, workspace,
    modelStatus: () => access.status(), modelFactory: (context) => access.model(context) });
  const base = await listen(server); const began = performance.now(); let failure = null; let diagnostic = null;
  try {
    await server.startAutomations();
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const scheduledAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const request = `${scheduledAt}에 TIME-CONTINUITY-731이라는 문구를 이 대화에 남기는 일을 예약해줘.`;
    const createdResponse = await fetch(`${base}/turn`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id, text: request }) });
    if (!createdResponse.ok) throw new Error(`create_http_${createdResponse.status}`);
    const created = await createdResponse.json();
    const listed = await server.automationStore.list(); const job = listed.jobs[0];
    if (!job) throw new Error('automation_not_created');
    await server.automationScheduler.runNow(job.id);
    let occurrence = null;
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      occurrence = (await server.automationStore.list()).runs[0] ?? null;
      if (occurrence && ['succeeded', 'failed', 'unknown', 'cancelled'].includes(occurrence.status)) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    if (!occurrence || occurrence.status !== 'succeeded') {
      const runs = occurrence?.sourceRunId ? await server.runLedger.read(occurrence.sourceRunId).catch(() => null) : null;
      diagnostic = occurrence ? {
        jobPrompt: job.prompt,
        jobRequirements: job.requirements,
        status: occurrence.status, executionStatus: occurrence.executionStatus,
        objectiveStatus: occurrence.objectiveStatus, surfaceStatus: occurrence.surfaceStatus,
        deliveryStatus: occurrence.deliveryStatus, summary: occurrence.userSafeSummary ?? null,
        runStatus: runs?.status ?? null,
        runEvents: runs?.events?.map((event) => event.type) ?? [],
        tools: runs?.events?.filter((event) => event.type === 'tool_completed').map((event) => ({
          name: event.payload?.receipt?.requestedCall?.name ?? null,
          outcome: event.payload?.receipt?.outcome ?? null,
          state: event.payload?.receipt?.result?.state ?? null,
          declaredStatus: event.payload?.receipt?.result?.status ?? null,
          summary: event.payload?.receipt?.result?.summary ?? null,
          remaining: event.payload?.receipt?.result?.remaining ?? null,
        })) ?? [],
      } : null;
      throw new Error(`occurrence_${occurrence?.status ?? 'timeout'}`);
    }
    const surface = await server.sessionStore.load(session.id);
    const delivered = (surface.transcript ?? []).filter((entry) => entry.role === 'assistant'
      && entry.result?.automation?.automationRunId === occurrence.occurrenceId);
    const run = await server.runLedger.read(occurrence.sourceRunId);
    const modelCalls = run.events.filter((event) => event.type === 'model_completed').length;
    const toolCalls = run.events.filter((event) => event.type === 'tool_completed').length;
    const resources = await server.resourceLedger.read();
    const occurrenceScope = resources.find((event) => event.type === 'ScopeCreated'
      && event.scopeId === occurrence.resourceScopeId);
    const internalLeak = /occurrence|fence|resourceScope|automation_outcome/iu.test([
      created.reply, ...delivered.map((entry) => entry.result?.reply ?? ''),
    ].join('\n'));
    const passed = delivered.length === 1 && delivered[0].result.reply.includes('TIME-CONTINUITY-731')
      && occurrence.executionStatus === 'completed' && occurrence.objectiveStatus === 'achieved'
      && occurrence.surfaceStatus === 'persisted' && occurrence.deliveryStatus === 'succeeded'
      && Boolean(occurrence.sourceWorkId && occurrence.executionWorkId && occurrenceScope)
      && !internalLeak;
    if (!passed) failure = 'qualification_invariant_failed';
    results.push({ modelId, passed, failure, wallMs: Math.round(performance.now() - began),
      modelCalls, toolCalls, occurrence: { status: occurrence.status,
        executionStatus: occurrence.executionStatus, objectiveStatus: occurrence.objectiveStatus,
        surfaceStatus: occurrence.surfaceStatus, deliveryStatus: occurrence.deliveryStatus },
      deliveryCount: delivered.length, workBound: Boolean(occurrence.sourceWorkId && occurrence.executionWorkId),
      resourceBound: Boolean(occurrenceScope), internalTermsVisible: internalLeak });
  } catch (error) {
    failure = error?.message ?? String(error);
    results.push({ modelId, passed: false, failure, diagnostic,
      wallMs: Math.round(performance.now() - began) });
  } finally {
    await server.closeAutomations(); await server.closeMessengers(); server.closeWakeStreams();
    await server.managedProcesses.stopAll('qualification_finished');
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

const report = { schema: 't5.s2-d-time-continuity-live.v1', recordedAt: new Date().toISOString(),
  results, passed: results.every((item) => item.passed) };
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
await rm(room, { recursive: true, force: true });
if (!report.passed) process.exitCode = 1;
