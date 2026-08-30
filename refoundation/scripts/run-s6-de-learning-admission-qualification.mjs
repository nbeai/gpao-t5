#!/usr/bin/env node
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';

const sourceFile = process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), 'Library', 'Application Support', 'GPAO-T5', 'credentials', 'model-connection.json');
const source = JSON.parse(await readFile(sourceFile, 'utf8'));
const selected = source.connections.find((item) => item.id === (process.env.T5_SIXTH_MODEL_CONNECTION_ID ?? source.activeId));
if (!selected?.secretRef) throw new Error('exact secret-backed model connection is required');
const room = await mkdtemp(join(tmpdir(), 't5-s6-de-admission-')); const stateDir = join(room, 'state');
const workspace = join(room, 'workspace'); await Promise.all([stateDir, workspace].map((path) => mkdir(path, { recursive: true })));
const connectionFile = join(stateDir, 'model-connection.json');
await writeFile(connectionFile, JSON.stringify({ version: source.version,
  connections: [selected], activeId: selected.id, roleBindings: {} }), { mode: 0o600 });
await chmod(connectionFile, 0o600);
const access = makeConsoleModelAccess({ connectionFile, stateDir,
  secretStore: makePlatformSecretStore({ platform: process.platform }) });
let learningModelFactories = 0;
const server = makeConsoleServer({ stateDir, workspace, capabilitySurfaceMode: 'directory-first-v1',
  workAdmissionMode: 'action-v1', learningReviewMode: 'proposal', learningReviewIdleMs: 100,
  memoryFlushMode: 'off', modelFactory: (input) => {
    if (input.purpose === 'learning_review') learningModelFactories += 1;
    return access.model(input);
  }, modelStatus: () => access.status() });

async function post(base, path, body) {
  const response = await fetch(`${base}${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${value.error ?? 'request failed'}`);
  return value;
}

await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const session = await post(base, '/sessions', {}); const runs = [];
  for (const [name, marker] of [['first-note.txt', 'FIRST-7391'], ['second-note.txt', 'SECOND-8520']]) {
    const turn = await post(base, '/turn', { sessionId: session.id,
      text: `${name} 파일을 만들고 내용이 ${marker}인지 다시 확인해줘.` });
    runs.push(await fetch(`${base}/runs/${turn.runId}`).then((response) => response.json()));
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  const eligibility = await server.learningSourceEligibility();
  const lifecycle = await server.capabilityLifecycleLedger.events();
  const failedTools = runs.flatMap((run) => run.events).filter((event) => event.type === 'tool_completed'
    && event.payload?.receipt?.outcome === 'failed').length;
  const reviewerEvents = lifecycle.filter((event) => event.type === 'learning_review_completed');
  const candidates = (await server.capabilityLifecycleLedger.list()).filter((item) => item.state === 'candidate');
  const passed = runs.every((run) => run.status === 'completed') && failedTools === 0
    && eligibility.sources.length === 2 && eligibility.sources.every((item) => item.learningSignals.length === 0)
    && learningModelFactories === 0 && reviewerEvents.length === 0 && candidates.length === 0;
  process.stdout.write(`${JSON.stringify({ schema: 't5.s6-de-learning-admission-qualification.v1', passed,
    model: selected.modelId, actualUserData: false, externalWrites: 0, foregroundRuns: runs.length,
    failedTools, eligibleSources: eligibility.eligible,
    learningSignals: eligibility.sources.map((item) => item.learningSignals),
    learningModelFactories, reviewerEvents: reviewerEvents.length, candidates: candidates.length,
  }, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
} finally {
  server.closeWakeStreams(); await server.managedProcesses.stopAll('s6_de_admission_shutdown');
  await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
}
