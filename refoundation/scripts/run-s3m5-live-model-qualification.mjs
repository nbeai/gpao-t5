import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { generateLivingLibrary } from '../src/living-library.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { createUserNote } from '../src/user-note.js';

const option = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const connectionId = option('--connection');
if (!connectionId || !process.argv.includes('--human-controlled')) {
  throw new Error('--connection and --human-controlled are required');
}
const sourceConnectionFile = process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json');
const room = await mkdtemp(join(tmpdir(), 't5-s3m5-live-'));
const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
await Promise.all([stateDir, workspace].map((path) => mkdir(path, { recursive: true })));
let server;

const post = (url, value) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify(value) }).then(async (response) => {
  const result = await response.json(); if (!response.ok) throw new Error(`HTTP ${response.status}: ${result.error}`);
  return result;
});

try {
  const source = JSON.parse(await readFile(sourceConnectionFile, 'utf8'));
  const selected = source.connections.find((item) => item.id === connectionId);
  if (!selected?.secretRef || Object.keys(selected).some((key) => ['apiKey', 'accessToken', 'refreshToken'].includes(key))) {
    throw new Error('secret-reference-only connection is required');
  }
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
  const remember = await runTurn('2026-01-01부터 2027-01-01 전까지 내 기록 형식 선호를 M5-STANDARD-MARKDOWN-915로 기억해.');
  const correct = await runTurn('같은 기록 형식 선호를 같은 기간에 M5-PLAIN-FILES-926으로 고쳐.');
  const inspect = await runTurn('현재 기록 형식 선호를 원래 출처를 다시 열어 확인한 뒤 알려줘.');
  const exported = await runTurn('내 T5 기억을 portable JSON으로 내보내서 현재와 과거 기록을 확인해.');
  const memory = await server.memoryLedger.read();
  const notes = join(room, 'notes'); await createUserNote({ root: notes, noteId: 'qualification-note',
    title: '사용자 기록', content: '표준 파일은 특정 앱 없이도 읽을 수 있어야 한다.' });
  const generatedAt = '2026-08-27T04:00:00.000Z';
  const absent = await generateLivingLibrary({ state: memory, outputRoot: join(room, 'without-obsidian'),
    userNotesRoot: notes, generatedAt });
  await mkdir(join(notes, '.obsidian')); await writeFile(join(notes, '.obsidian', 'app.json'), '{}', 'utf8');
  const present = await generateLivingLibrary({ state: memory, outputRoot: join(room, 'with-obsidian'),
    userNotesRoot: notes, generatedAt });
  const receipts = (journey) => journey.run.events.filter((event) => event.type === 'tool_completed')
    .map((event) => event.payload?.receipt).filter(Boolean);
  const summary = (journey) => receipts(journey).map((receipt) => ({
    name: receipt.actualCall?.name ?? receipt.requestedCall?.name ?? null,
    outcome: receipt.outcome ?? null, state: receipt.result?.state ?? null,
    sourceAvailability: receipt.result?.source?.availability ?? null,
    sourceDigestMatched: receipt.result?.source?.digestMatched ?? null,
  }));
  const resources = (journey) => {
    const responses = journey.run.events.filter((event) => event.type === 'model_completed')
      .map((event) => event.payload?.response ?? {});
    const totalTokens = responses.reduce((sum, response) => { const usage = response.usage ?? {};
      return sum + Number(usage.total_tokens ?? usage.totalTokens ?? 0); }, 0);
    const requestBytes = journey.run.events.filter((event) => event.type === 'model_context_built')
      .reduce((sum, event) => sum + Number(event.payload?.contextReceipt?.requestBytes ?? 0), 0);
    return { wallMs: journey.wallMs, providerCalls: responses.length,
      totalTokens: totalTokens || null, requestBytes: requestBytes || null };
  };
  const exportResult = receipts(exported).find((receipt) => receipt.actualCall?.name === 'memory_control'
    && receipt.result?.state === 'exported')?.result;
  const files = {};
  for (const name of ['index.html', 'memory.md', 'manifest.json']) {
    files[name] = (await readFile(join(absent.directory, name), 'utf8'))
      === (await readFile(join(present.directory, name), 'utf8'));
  }
  const journeys = { remember, correct, inspect, exported };
  const result = {
    schema: 't5.s3m5.live-model-qualification.v1',
    connection: { id: selected.id, provider: selected.provider, modelId: selected.modelId },
    secretReferenceOnly: true, isolatedState: true, externalWrites: 0,
    journeys: {
      remember: { committed: summary(remember).some((item) => item.name === 'memory_claim' && item.state === 'committed'),
        tools: summary(remember) },
      correct: { committed: summary(correct).some((item) => item.name === 'memory_claim' && item.state === 'committed'),
        tools: summary(correct) },
      inspect: { expected: String(inspect.surface.reply ?? '').includes('M5-PLAIN-FILES-926'),
        sourceReopened: summary(inspect).some((item) => item.sourceAvailability === 'available'
          && item.sourceDigestMatched === true), tools: summary(inspect) },
      export: { exported: Boolean(exportResult), claims: exportResult?.bundle?.claims?.length ?? null,
        localPathLeaked: /\/Users\/|[A-Za-z]:\\/u.test(JSON.stringify(exportResult?.bundle ?? {})),
        tools: summary(exported) },
    },
    library: { requiresObsidian: absent.manifest.requiresObsidian,
      noPluginSameFiles: files, generationIdEqual: absent.manifest.generationId === present.manifest.generationId,
      userNotes: absent.manifest.userNotes },
    claims: memory.claims.map((claim) => ({ status: claim.status, valueMarker: claim.value,
      sourceRecords: claim.sources.length })),
    resources: Object.fromEntries(Object.entries(journeys).map(([name, journey]) => [name, resources(journey)])),
  };
  result.pass = result.journeys.remember.committed && result.journeys.correct.committed
    && result.journeys.inspect.expected && result.journeys.inspect.sourceReopened
    && result.journeys.export.exported && !result.journeys.export.localPathLeaked
    && result.library.requiresObsidian === false && Object.values(result.library.noPluginSameFiles).every(Boolean)
    && result.library.generationIdEqual && result.library.userNotes === 1
    && result.claims.some((claim) => claim.status === 'superseded')
    && result.claims.some((claim) => claim.status === 'active'
      && String(claim.valueMarker).includes('M5-PLAIN-FILES-926'));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.pass) process.exitCode = 1;
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(room, { recursive: true, force: true });
}
