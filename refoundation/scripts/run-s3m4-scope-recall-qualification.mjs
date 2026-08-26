import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { projectConversationRecordReference } from '../src/record-projection.js';
import { makeMemoryClaim } from '../src/temporal-memory.js';

const option = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const connectionId = option('--connection'); const repeats = Number(option('--repeats') ?? 1);
if (!connectionId || !process.argv.includes('--human-controlled') || !Number.isInteger(repeats) || repeats < 1 || repeats > 3) {
  throw new Error('--connection, --human-controlled, and repeats 1..3 are required');
}
const sourceFile = process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json');
const room = await mkdtemp(join(tmpdir(), 't5-s3m4-scope-')); const stateDir = join(room, 'state');
const workspace = join(room, 'workspace'); await Promise.all([stateDir, workspace].map((p) => mkdir(p, { recursive: true })));
let server;
const post = (url, value) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify(value) }).then(async (response) => { const body = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error}`); return body; });
try {
  const state = JSON.parse(await readFile(sourceFile, 'utf8'));
  const selected = state.connections.find((item) => item.id === connectionId);
  if (!selected?.secretRef) throw new Error('secret reference connection required');
  const connectionFile = join(stateDir, 'model-connection.json');
  await writeFile(connectionFile, JSON.stringify({ version: state.version, connections: [selected],
    activeId: selected.id, roleBindings: {} }), { mode: 0o600 }); await chmod(connectionFile, 0o600);
  const access = makeConsoleModelAccess({ connectionFile, stateDir,
    secretStore: makePlatformSecretStore({ platform: process.platform }) });
  server = makeConsoleServer({ stateDir, workspace, modelFactory: (args) => access.model(args),
    modelStatus: () => access.status(), learningReviewMode: 'off', memoryFlushMode: 'off' });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const sourceSession = randomUUID(); await server.conversationLedger.ensure({ sessionId: sourceSession });
  const eventA = await server.conversationLedger.appendMessage({ sessionId: sourceSession, messageId: 'alex-a',
    message: { role: 'user', content: 'M4 project A verified person A source.' } });
  const eventB = await server.conversationLedger.appendMessage({ sessionId: sourceSession, messageId: 'alex-b',
    message: { role: 'user', content: 'M4 project A verified person B source.' } });
  const ref = (event) => projectConversationRecordReference({ event, expectedSessionId: sourceSession,
    trust: 'user_asserted', sensitivity: 'personal', channel: 'console', observedAt: '2026-08-27T00:00:00.000Z' });
  await server.memoryLedger.ensure();
  for (const [index, input] of [{ id: 'A', token: 'M4-ALEX-A-913', event: eventA },
    { id: 'B', token: 'M4-ALEX-B-624', event: eventB }].entries()) {
    await server.memoryLedger.commitClaim({ claim: makeMemoryClaim({
      memoryId: `memory-alex-${input.id.toLowerCase()}`, kind: 'fact',
      subjectKey: `person:M4-ALEX-${input.id}`, value: input.token,
      scope: { global: false, workId: null, projectId: 'M4-PROJECT-A',
        personId: `M4-ALEX-${input.id}`, organizationId: null },
      sources: [ref(input.event)], recordedAt: `2026-08-27T00:0${index + 1}:00.000Z`,
      validFrom: '2026-01-01T00:00:00.000Z', validTo: '2027-01-01T00:00:00.000Z',
      subjectRevision: 1, sourceOrder: index + 2, status: 'active', supersedes: [], conflictsWith: [],
      sensitivity: 'personal', alwaysRelevant: false,
    }) });
  }
  const observations = [];
  for (let index = 0; index < repeats; index += 1) {
    const started = process.hrtime.bigint(); const session = await post(`${base}/sessions`, {});
    const surface = await post(`${base}/turn`, { sessionId: session.id,
      text: 'M4-PROJECT-A에서 Alex A의 기억만 source를 확인해 보여줘. Alex B는 제외해.' });
    const run = await fetch(`${base}/runs/${surface.runId}`).then((response) => response.json());
    const reply = String(surface.reply ?? '');
    const sourceReopened = run.events.filter((event) => event.type === 'tool_completed')
      .some((event) => event.payload?.receipt?.actualCall?.name === 'memory'
        && event.payload?.receipt?.result?.source?.availability === 'available');
    const responses = run.events.filter((event) => event.type === 'model_completed')
      .map((event) => event.payload?.response ?? {});
    const tokens = responses.reduce((sum, response) => sum + Number(response.usage?.total_tokens ?? 0), 0) || null;
    const requestBytes = run.events.filter((event) => event.type === 'model_context_built')
      .reduce((sum, event) => sum + Number(event.payload?.contextReceipt?.requestBytes ?? 0), 0) || null;
    observations.push({ passed: reply.includes('M4-ALEX-A-913') && !reply.includes('M4-ALEX-B-624')
      && sourceReopened, sourcePresent: true, oracleValid: true, sourceReopened,
      model: selected.modelId, wallMs: Number(process.hrtime.bigint() - started) / 1_000_000,
      requestBytes, tokens, failureFamily: sourceReopened ? 'scope_selection' : 'source_reopen' });
  }
  const result = { schema: 't5.s3m4.scope-recall-qualification.v1', connection: {
    id: selected.id, provider: selected.provider, modelId: selected.modelId }, repeats,
    secretReferenceOnly: true, isolatedState: true, externalWrites: 0, observations,
    pass: observations.every((item) => item.passed) };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (!result.pass) process.exitCode = 1;
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(room, { recursive: true, force: true });
}
