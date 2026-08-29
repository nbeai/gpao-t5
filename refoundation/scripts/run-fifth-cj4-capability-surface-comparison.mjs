#!/usr/bin/env node
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { projectConversationRecordReference } from '../src/record-projection.js';
import { makeMemoryClaim } from '../src/temporal-memory.js';

const sourceFile = process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), 'Library', 'Application Support', 'GPAO-T5', 'credentials', 'model-connection.json');
const connectionId = process.env.T5_FIFTH_MODEL_CONNECTION_ID ?? 'chatgpt_oauth:gpt-5.5';
const sourceState = JSON.parse(await readFile(sourceFile, 'utf8'));
const selected = sourceState.connections.find((connection) => connection.id === connectionId);
if (!selected?.secretRef) throw new Error('exact secret-backed model connection is required');
const wireContextMode = process.env.T5_FIFTH_WIRE_CONTEXT_MODE ?? 'append-continuation';
const currentRunEvidenceMode = process.env.T5_FIFTH_CURRENT_RUN_EVIDENCE_MODE ?? 'full';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function post(base, path, body) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${value.error ?? 'request failed'}`);
  return value;
}

function summarizeRun(run, wallMs) {
  const models = run.events.filter((event) => event.type === 'model_completed');
  const tools = run.events.filter((event) => event.type === 'tool_completed');
  const contexts = run.events.filter((event) => event.type === 'information_context_built');
  return {
    modelCalls: models.length,
    toolCalls: tools.length,
    tools: tools.map((event) => event.payload?.receipt?.actualCall?.name).filter(Boolean),
    totalTokens: models.reduce((sum, event) => sum + Number(event.payload?.response?.usage?.total_tokens ?? 0), 0),
    requestBytes: models.reduce((sum, event) => sum
      + Number(event.payload?.response?.contextReceipt?.requestBytes ?? 0), 0) || null,
    firstToolDefinitions: contexts[0]?.payload?.activeToolDefinitions ?? null,
    firstToolDefinitionBytes: contexts[0]?.payload?.activeToolDefinitionBytes ?? null,
    wallMs: Number(wallMs.toFixed(3)),
  };
}

async function runMode(mode) {
  const room = await mkdtemp(join(tmpdir(), `t5-fifth-cj4-${mode}-`));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
  await Promise.all([stateDir, workspace].map((path) => mkdir(path, { recursive: true })));
  const connectionFile = join(stateDir, 'model-connection.json');
  await writeFile(connectionFile, JSON.stringify({ version: sourceState.version,
    connections: [selected], activeId: selected.id, roleBindings: {} }), { mode: 0o600 });
  await chmod(connectionFile, 0o600);
  const access = makeConsoleModelAccess({ connectionFile, stateDir,
    secretStore: makePlatformSecretStore({ platform: process.platform }),
    wireContextPolicy: { [selected.provider]: wireContextMode } });
  const server = makeConsoleServer({ stateDir, workspace, capabilitySurfaceMode: mode,
    currentRunEvidenceMode,
    modelFactory: (input) => access.model(input), modelStatus: () => access.status(),
    learningReviewMode: 'off', memoryFlushMode: 'off' });
  let base;
  try {
    base = await listen(server);
    const memorySourceSession = await post(base, '/sessions', {});
    await server.conversationLedger.ensure({ sessionId: memorySourceSession.id });
    const sourceEvent = await server.conversationLedger.appendMessage({
      sessionId: memorySourceSession.id, messageId: `cj4-memory-source-${mode}`,
      message: { role: 'user', content: 'My current preferred report code is CJ4-MEMORY-7391.' },
    });
    await server.memoryLedger.ensure();
    const memorySourceOrder = (await server.memoryLedger.read()).events.length + 1;
    await server.memoryLedger.commitClaim({ claim: makeMemoryClaim({
      memoryId: `cj4-memory-${mode}`, kind: 'preference', subjectKey: 'subject:report-code',
      value: 'CJ4-MEMORY-7391',
      scope: { global: true, workId: null, projectId: null, personId: 'person:owner', organizationId: null },
      sources: [projectConversationRecordReference({ event: sourceEvent,
        expectedSessionId: memorySourceSession.id, trust: 'user_asserted', sensitivity: 'personal',
        channel: 'console', observedAt: '2026-08-30T00:00:00.000Z' })],
      recordedAt: '2026-08-30T00:00:00.000Z', validFrom: '2026-08-30T00:00:00.000Z',
      validTo: '2027-08-30T00:00:00.000Z', subjectRevision: 1, sourceOrder: memorySourceOrder,
      status: 'active', supersedes: [], conflictsWith: [], sensitivity: 'personal', alwaysRelevant: false,
    }) });

    const definitions = [
      { id: 'direct', request: '현재 정보만으로 작은 카페의 메뉴 수를 줄일지 의견을 짧게 말해줘.' },
      { id: 'connection', request: '지금 T5에서 사용할 수 있는 연결 상태를 실제로 확인해서 간단히 알려줘.' },
      { id: 'memory', request: '내 현재 선호 보고서 코드를 기억 원문에서 확인해서 정확히 알려줘.' },
    ].filter((scenario) => !process.env.T5_FIFTH_CJ4_SCENARIOS
      || process.env.T5_FIFTH_CJ4_SCENARIOS.split(',').map((value) => value.trim()).includes(scenario.id));
    const results = [];
    for (const scenario of definitions) {
      const session = await post(base, '/sessions', {}); const started = performance.now();
      const surface = await post(base, '/turn', { sessionId: session.id, text: scenario.request });
      const run = await fetch(`${base}/runs/${surface.runId}`).then((response) => response.json());
      const metrics = summarizeRun(run, performance.now() - started);
      const toolReceipts = run.events.filter((event) => event.type === 'tool_completed')
        .map((event) => event.payload?.receipt).filter(Boolean);
      const passed = scenario.id === 'direct'
        ? metrics.toolCalls === 0 && String(surface.reply ?? '').length >= 20
          && !/Tool|Run|Work|schema|tool_search/u.test(String(surface.reply ?? ''))
        : scenario.id === 'connection'
          ? toolReceipts.some((receipt) => receipt.actualCall?.name === 'connection'
            && receipt.outcome === 'succeeded')
          : String(surface.reply ?? '').includes('CJ4-MEMORY-7391')
            && toolReceipts.some((receipt) => receipt.actualCall?.name === 'memory'
              && receipt.outcome === 'succeeded' && receipt.result?.source?.availability === 'available');
      results.push({ id: scenario.id, passed, answer: surface.reply, ...metrics });
    }
    return { mode, results, passed: results.every((result) => result.passed) };
  } finally {
    server.closeWakeStreams(); await server.managedProcesses.stopAll('cj4_shutdown');
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
}

const selectedModes = (process.env.T5_FIFTH_CJ4_MODES ?? 'current-core-v1,directory-first-v1')
  .split(',').map((value) => value.trim()).filter(Boolean);
const modes = [];
for (const mode of selectedModes) modes.push(await runMode(mode));
const output = { schema: 't5.fifth-cj4-capability-surface-comparison.v1',
  model: selected.modelId, provider: selected.provider, wireContextMode, currentRunEvidenceMode,
  actualUserData: false,
  externalWrites: 0, modes, passed: modes.every((mode) => mode.passed) };
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (!output.passed) process.exitCode = 1;
