import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';

const option = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const connectionId = option('--connection');
if (!connectionId || !process.argv.includes('--human-controlled')) {
  throw new Error('--connection and --human-controlled are required');
}
const sourceConnectionFile = process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json');
const room = await mkdtemp(join(tmpdir(), 't5-s3m3-live-'));
const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
await Promise.all([stateDir, workspace].map((path) => mkdir(path, { recursive: true })));
let server;
const post = (url, value) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify(value) }).then(async (response) => {
  const body = await response.json(); if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error}`); return body;
});
try {
  const source = JSON.parse(await readFile(sourceConnectionFile, 'utf8'));
  const selected = source.connections.find((item) => item.id === connectionId);
  if (!selected?.secretRef) throw new Error('secret-reference-only connection is required');
  const connectionFile = join(stateDir, 'model-connection.json');
  await writeFile(connectionFile, JSON.stringify({ version: source.version, connections: [selected],
    activeId: selected.id, roleBindings: {} }), { mode: 0o600 }); await chmod(connectionFile, 0o600);
  const access = makeConsoleModelAccess({ connectionFile, stateDir,
    secretStore: makePlatformSecretStore({ platform: process.platform }) });
  server = makeConsoleServer({ stateDir, workspace, modelFactory: (args) => access.model(args),
    modelStatus: () => access.status(), learningReviewMode: 'off', memoryFlushMode: 'off' });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const runTurn = async (text) => {
    const started = process.hrtime.bigint(); const session = await post(`${base}/sessions`, {});
    const surface = await post(`${base}/turn`, { sessionId: session.id, text });
    const run = await fetch(`${base}/runs/${surface.runId}`).then((response) => response.json());
    return { surface, run, wallMs: Number(process.hrtime.bigint() - started) / 1_000_000 };
  };
  const remember = await runTurn('2026-01-01부터 2027-01-01 전까지 내 삭제 시험 선호를 M3-FORGET-731로 기억해.');
  const forget = await runTurn('내 삭제 시험 선호 기억을 정확히 잊어. 대화 기록 전체를 지우지는 마.');
  const absence = await runTurn('현재 삭제 시험 선호가 기억에 남아 있지 않다면 M3-ABSENT-000을 포함해 답해.');
  const restore = await runTurn('방금 잊은 삭제 시험 선호 기억을 복원해.');
  const restored = await runTurn('현재 삭제 시험 선호를 source를 확인한 뒤 알려줘.');
  const exported = await runTurn('내 T5 기억을 portable JSON으로 내보내서 내용을 확인해.');
  const receipts = (journey) => journey.run.events.filter((event) => event.type === 'tool_completed')
    .map((event) => event.payload?.receipt).filter(Boolean);
  const summary = (journey) => receipts(journey).map((receipt) => ({
    name: receipt.actualCall?.name ?? receipt.requestedCall?.name ?? null,
    outcome: receipt.outcome ?? null, state: receipt.result?.state ?? null,
  }));
  const resource = (journey) => {
    const responses = journey.run.events.filter((event) => event.type === 'model_completed')
      .map((event) => event.payload?.response ?? {});
    const totalTokens = responses.reduce((sum, response) => { const usage = response.usage ?? {};
      return sum + Number(usage.total_tokens ?? usage.totalTokens ?? 0); }, 0);
    const requestBytes = journey.run.events.filter((event) => event.type === 'model_context_built')
      .reduce((sum, event) => sum + Number(event.payload?.contextReceipt?.requestBytes ?? 0), 0);
    return { wallMs: journey.wallMs, providerCalls: responses.length,
      totalTokens: totalTokens || null, requestBytes: requestBytes || null };
  };
  const forgetResult = receipts(forget).find((receipt) => receipt.actualCall?.name === 'memory_claim')?.result;
  const exportResult = receipts(exported).find((receipt) => receipt.actualCall?.name === 'memory_control'
    && receipt.result?.state === 'exported')?.result;
  const memory = await server.memoryLedger.read();
  const journeys = { remember, forget, absence, restore, restored, exported };
  const result = {
    schema: 't5.s3m3.live-model-qualification.v1',
    connection: { id: selected.id, provider: selected.provider, modelId: selected.modelId },
    secretReferenceOnly: true, isolatedState: true, externalWrites: 0,
    journeys: {
      remember: { committed: summary(remember).some((item) => item.name === 'memory_claim' && item.state === 'committed'), tools: summary(remember) },
      forget: { retracted: forgetResult?.state === 'retracted', receipt: forgetResult?.forgetReceipt ?? null, tools: summary(forget) },
      absence: { passed: String(absence.surface.reply ?? '').includes('M3-ABSENT-000') },
      restore: { restored: summary(restore).some((item) => item.name === 'memory_control' && item.state === 'restored'), tools: summary(restore) },
      restored: { passed: String(restored.surface.reply ?? '').includes('M3-FORGET-731') },
      export: { exported: Boolean(exportResult), claimCount: exportResult?.bundle?.claims?.length ?? null,
        localPathLeaked: /\/Users\/|[A-Za-z]:\\/u.test(JSON.stringify(exportResult?.bundle ?? {})), tools: summary(exported) },
    },
    resources: Object.fromEntries(Object.entries(journeys).map(([name, journey]) => [name, resource(journey)])),
    finalState: { activeClaims: memory.claims.filter((claim) => claim.status === 'active').length,
      tombstones: memory.tombstones.length },
  };
  result.pass = result.journeys.remember.committed && result.journeys.forget.retracted
    && result.journeys.forget.receipt?.searchHitAfter === 0
    && result.journeys.forget.receipt?.contextProjectionAfter === 0
    && result.journeys.absence.passed && result.journeys.restore.restored
    && result.journeys.restored.passed && result.journeys.export.exported
    && result.journeys.export.localPathLeaked === false
    && result.finalState.activeClaims === 1 && result.finalState.tombstones === 0;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.pass) process.exitCode = 1;
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(room, { recursive: true, force: true });
}
