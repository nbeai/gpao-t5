import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { projectConversationRecordReference } from '../src/record-projection.js';
import { makeMemoryClaim } from '../src/temporal-memory.js';

const idx = process.argv.indexOf('--connection'); const connectionId = idx >= 0 ? process.argv[idx + 1] : null;
if (!connectionId || !process.argv.includes('--human-controlled')) throw new Error('connection and human control required');
const sourceFile = process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json');
const room = await mkdtemp(join(tmpdir(), 't5-s3m4-temporal-')); const stateDir = join(room, 'state');
const workspace = join(room, 'workspace'); await Promise.all([stateDir, workspace].map((p) => mkdir(p, { recursive: true })));
let server;
const post = (url, value) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify(value) }).then(async (response) => { const body = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error}`); return body; });
try {
  const state = JSON.parse(await readFile(sourceFile, 'utf8')); const selected = state.connections.find((x) => x.id === connectionId);
  if (!selected?.secretRef) throw new Error('secret reference required');
  const connectionFile = join(stateDir, 'model-connection.json');
  await writeFile(connectionFile, JSON.stringify({ version: state.version, connections: [selected], activeId: selected.id,
    roleBindings: {} }), { mode: 0o600 }); await chmod(connectionFile, 0o600);
  const access = makeConsoleModelAccess({ connectionFile, stateDir,
    secretStore: makePlatformSecretStore({ platform: process.platform }) });
  server = makeConsoleServer({ stateDir, workspace, modelFactory: (args) => access.model(args),
    modelStatus: () => access.status(), learningReviewMode: 'off', memoryFlushMode: 'off' });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`; const sourceSession = randomUUID();
  await server.conversationLedger.ensure({ sessionId: sourceSession });
  const oldEvent = await server.conversationLedger.appendMessage({ sessionId: sourceSession, messageId: 'old',
    message: { role: 'user', content: '2025 source M4-OLD-741' } });
  const currentEvent = await server.conversationLedger.appendMessage({ sessionId: sourceSession, messageId: 'current',
    message: { role: 'user', content: '2026 source M4-CURRENT-852' } });
  const ref = (event) => projectConversationRecordReference({ event, expectedSessionId: sourceSession,
    trust: 'user_asserted', sensitivity: 'personal', channel: 'console', observedAt: '2026-08-27T00:00:00.000Z' });
  await server.memoryLedger.ensure();
  await server.memoryLedger.commitClaim({ claim: makeMemoryClaim({ memoryId: 'm-old', kind: 'fact',
    subjectKey: 'M4-SUBJECT-1', value: 'M4-OLD-741', scope: { global: true, workId: null, projectId: null,
      personId: 'person:owner', organizationId: null }, sources: [ref(oldEvent)],
    recordedAt: '2026-01-01T00:00:00.000Z', validFrom: '2025-01-01T00:00:00.000Z',
    validTo: '2026-01-01T00:00:00.000Z', subjectRevision: 1, sourceOrder: 2, status: 'active',
    supersedes: [], conflictsWith: [], sensitivity: 'personal', alwaysRelevant: false }) });
  await server.memoryLedger.commitClaim({ claim: makeMemoryClaim({ memoryId: 'm-current', kind: 'fact',
    subjectKey: 'M4-SUBJECT-1', value: 'M4-CURRENT-852', scope: { global: true, workId: null, projectId: null,
      personId: 'person:owner', organizationId: null }, sources: [ref(currentEvent)],
    recordedAt: '2026-01-01T00:01:00.000Z', validFrom: '2026-01-01T00:00:00.000Z',
    validTo: '2027-01-01T00:00:00.000Z', subjectRevision: 2, sourceOrder: 3, status: 'active',
    supersedes: ['m-old'], conflictsWith: [], sensitivity: 'personal', alwaysRelevant: false }) });
  const runCase = async (caseId, text, include, exclude) => {
    const started = process.hrtime.bigint(); const session = await post(`${base}/sessions`, {});
    const surface = await post(`${base}/turn`, { sessionId: session.id, text });
    const run = await fetch(`${base}/runs/${surface.runId}`).then((r) => r.json()); const reply = String(surface.reply ?? '');
    const sourceReopened = run.events.some((event) => event.type === 'tool_completed'
      && event.payload?.receipt?.actualCall?.name === 'memory'
      && event.payload?.receipt?.result?.source?.availability === 'available');
    const responses = run.events.filter((event) => event.type === 'model_completed').map((event) => event.payload?.response ?? {});
    return { caseId, passed: reply.includes(include) && !reply.includes(exclude) && sourceReopened,
      sourcePresent: true, oracleValid: true, sourceReopened, model: selected.modelId,
      wallMs: Number(process.hrtime.bigint() - started) / 1_000_000,
      requestBytes: run.events.filter((event) => event.type === 'model_context_built')
        .reduce((sum, event) => sum + Number(event.payload?.contextReceipt?.requestBytes ?? 0), 0) || null,
      tokens: responses.reduce((sum, response) => sum + Number(response.usage?.total_tokens ?? 0), 0) || null };
  };
  const observations = [
    await runCase('M4-Q3', '현재 M4-SUBJECT-1 값을 source 확인 후 알려줘.', 'M4-CURRENT-852', 'M4-OLD-741'),
    await runCase('M4-Q4', '2025년 M4-SUBJECT-1 값을 source 확인 후 알려줘.', 'M4-OLD-741', 'M4-CURRENT-852'),
  ];
  const result = { schema: 't5.s3m4.temporal-recall-sample.v1', connection: { id: selected.id,
    provider: selected.provider, modelId: selected.modelId }, secretReferenceOnly: true,
    isolatedState: true, externalWrites: 0, observations, pass: observations.every((item) => item.passed) };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (!result.pass) process.exitCode = 1;
} finally { if (server) await new Promise((resolve) => server.close(resolve));
  await rm(room, { recursive: true, force: true }); }
