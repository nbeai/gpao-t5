import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';

const option = (name) => {
  const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null;
};
const connectionId = option('--connection');
if (!connectionId) throw new Error('--connection is required');
if (!process.argv.includes('--human-controlled')) {
  throw new Error('--human-controlled is required because this qualification uses an actual model account');
}

const sourceConnectionFile = process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json');
const room = await mkdtemp(join(tmpdir(), 't5-s3m2-live-'));
const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
await Promise.all([stateDir, workspace].map((path) => mkdir(path, { recursive: true })));

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}
const post = (url, value) => fetch(url, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
}).then(async (response) => {
  const body = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error ?? 'request failed'}`);
  return body;
});

let server;
try {
  const source = JSON.parse(await readFile(sourceConnectionFile, 'utf8'));
  const selected = source.connections.find((item) => item.id === connectionId);
  if (!selected) throw new Error(`connection not found: ${connectionId}`);
  if (!selected.secretRef || Object.keys(selected).some((key) => ['apiKey', 'accessToken', 'refreshToken'].includes(key))) {
    throw new Error('connection is not secret-reference-only');
  }
  const isolatedConnectionFile = join(stateDir, 'model-connection.json');
  await writeFile(isolatedConnectionFile, JSON.stringify({
    version: source.version, connections: [selected], activeId: selected.id, roleBindings: {},
  }), { mode: 0o600 });
  await chmod(isolatedConnectionFile, 0o600);
  const access = makeConsoleModelAccess({ connectionFile: isolatedConnectionFile, stateDir });
  server = makeConsoleServer({
    stateDir, workspace,
    modelFactory: (args) => access.model(args), modelStatus: () => access.status(),
    learningReviewMode: 'off', memoryFlushMode: 'off',
  });
  const base = await listen(server);
  const runTurn = async (text) => {
    const session = await post(`${base}/sessions`, {});
    const surface = await post(`${base}/turn`, { sessionId: session.id, text });
    const run = await fetch(`${base}/runs/${surface.runId}`).then((response) => response.json());
    return { surface, run };
  };
  const remember = await runTurn('2025-01-01부터 2026-01-01 전까지 내 테스트 코드 선호가 M2-OLD-741이었다고 기억해.');
  const correct = await runTurn('같은 테스트 코드 선호를 2026-01-01부터 2027-01-01 전까지 M2-NEW-852로 고쳐.');
  const current = await runTurn('현재 유효한 내 테스트 코드 선호를 출처를 확인한 뒤 알려줘.');
  const historical = await runTurn('2025년 당시 내 테스트 코드 선호를 출처를 확인한 뒤 알려줘.');
  const unknown = await runTurn('2030년에 유효한 내 테스트 코드 선호가 확정되어 있는지 알려줘. 모르면 모른다고 해.');
  const memory = await server.memoryLedger.read();
  const toolResults = (run) => run.events.filter((event) => event.type === 'tool_completed')
    .map((event) => event.payload?.receipt?.result).filter(Boolean);
  const sourceReopened = [current, historical].every(({ run }) => toolResults(run).some((result) => (
    result?.source?.availability === 'available' && result?.source?.digestMatched === true
  )));
  const answer = (journey) => String(journey.surface.reply ?? '');
  const result = {
    schema: 't5.s3m2.live-model-qualification.v1',
    connection: { id: selected.id, provider: selected.provider, modelId: selected.modelId },
    secretReferenceOnly: true,
    isolatedState: true,
    journeys: {
      remember: { completed: remember.surface.status !== 'failed', tool: toolResults(remember.run).length },
      correct: { completed: correct.surface.status !== 'failed', tool: toolResults(correct.run).length },
      current: { containsExpected: answer(current).includes('M2-NEW-852') },
      historical: { containsExpected: answer(historical).includes('M2-OLD-741') },
      unknown: {
        abstained: !answer(unknown).includes('M2-NEW-852') && !answer(unknown).includes('M2-OLD-741'),
      },
    },
    sourceReopened,
    claims: memory.claims.map((claim) => ({
      memoryId: claim.memoryId, status: claim.status, validFrom: claim.validFrom, validTo: claim.validTo,
      sourceRecords: claim.sources.length,
    })),
    providerCalls: [remember, correct, current, historical, unknown]
      .reduce((sum, journey) => sum + journey.run.events.filter((event) => event.type === 'model_completed').length, 0),
  };
  result.pass = result.journeys.remember.completed && result.journeys.correct.completed
    && result.journeys.current.containsExpected && result.journeys.historical.containsExpected
    && result.journeys.unknown.abstained && result.sourceReopened
    && result.claims.filter((claim) => claim.status === 'active').length === 1
    && result.claims.some((claim) => claim.status === 'superseded');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.pass) process.exitCode = 1;
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(room, { recursive: true, force: true });
}
