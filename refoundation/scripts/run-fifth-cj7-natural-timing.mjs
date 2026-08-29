#!/usr/bin/env node
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';

const sourceFile = process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), 'Library', 'Application Support', 'GPAO-T5', 'credentials', 'model-connection.json');
const connectionId = process.env.T5_FIFTH_MODEL_CONNECTION_ID ?? 'chatgpt_oauth:gpt-5.5';
const sourceState = JSON.parse(await readFile(sourceFile, 'utf8'));
const selected = sourceState.connections.find((connection) => connection.id === connectionId);
if (!selected?.secretRef) throw new Error('exact secret-backed model connection is required');
const room = await mkdtemp(join(tmpdir(), 't5-fifth-cj7-'));
const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
await Promise.all([stateDir, workspace].map((path) => mkdir(path, { recursive: true })));
const connectionFile = join(stateDir, 'model-connection.json');
await writeFile(connectionFile, JSON.stringify({ version: sourceState.version,
  connections: [selected], activeId: selected.id, roleBindings: {} }), { mode: 0o600 });
await chmod(connectionFile, 0o600);
const access = makeConsoleModelAccess({ connectionFile, stateDir,
  secretStore: makePlatformSecretStore({ platform: process.platform }) });
const server = makeConsoleServer({ stateDir, workspace, capabilitySurfaceMode: 'directory-first-v1',
  workAdmissionMode: 'action-v1',
  modelFactory: (input) => access.model(input), modelStatus: () => access.status(),
  webSearchProviders: [{ id: 'cj7-public', label: 'CJ7 public fixture',
    async available() { return { available: true }; },
    async search() { return [{ title: 'CJ7 공개 공지', url: 'https://public.example.test/cj7',
      snippet: '오늘 공개된 운영 코드 안내' }]; } }],
  webReadOptions: { resolveHost: async () => ['93.184.216.34'],
    fetchImpl: async (url) => new Response([
    '<html><head><title>CJ7 공개 공지</title></head><body>',
    '<article><time datetime="2026-08-30">2026-08-30</time>',
    '<p>오늘 공개된 운영 코드는 CJ7-PUBLIC-4488입니다.</p></article></body></html>',
  ].join(''), { status: String(url) === 'https://public.example.test/cj7' ? 200 : 404,
    headers: { 'content-type': 'text/html; charset=utf-8' } }) },
  learningReviewMode: 'off', memoryFlushMode: 'off' });

async function post(base, path, body) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${value.error ?? 'request failed'}`);
  return value;
}

function metrics(run) {
  const models = run.events.filter((event) => event.type === 'model_completed');
  const tools = run.events.filter((event) => event.type === 'tool_completed');
  return { modelCalls: models.length, toolCalls: tools.length,
    tools: tools.map((event) => event.payload?.receipt?.actualCall?.name).filter(Boolean),
    tokens: models.reduce((sum, event) => sum + Number(event.payload?.response?.usage?.total_tokens ?? 0), 0),
    requestBytes: models.reduce((sum, event) => sum
      + Number(event.payload?.response?.contextReceipt?.requestBytes ?? 0), 0) || null };
}

await new Promise((resolve, reject) => {
  server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
});
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const definitions = [
    {
      id: 'thought_no_action', taxonomy: 'ANSWER',
      request: '요즘 카페 운영이 힘들어서 그만둘까 하는 생각이 들어.',
      check: ({ surface, run }) => run.events.every((event) => event.type !== 'tool_completed')
        && String(surface.reply ?? '').length >= 20,
    },
    {
      id: 'missing_delivery_question', taxonomy: 'ASK',
      request: '새 거래처 담당자에게 내일 회의가 어렵다고 보내줘.',
      check: ({ surface, run }) => run.events.every((event) => event.type !== 'tool_completed')
        && /어디|어떤.*채널|연락처|이메일|메신저|보낼/u.test(String(surface.reply ?? ''))
        && /\?/u.test(String(surface.reply ?? '')),
    },
    {
      id: 'clear_local_artifact', taxonomy: 'ACT',
      request: '작업공간에 내용이 CJ7-RESULT-7391인 cj7-result.txt를 만들고 실제 결과 파일로 보여줘.',
      check: ({ surface, run }) => (surface.artifacts ?? []).some((item) => item.originalName === 'cj7-result.txt')
        && run.events.some((event) => event.type === 'tool_completed'
          && event.payload?.receipt?.actualCall?.name === 'exec')
        && run.events.some((event) => event.type === 'tool_completed'
          && event.payload?.receipt?.actualCall?.name === 'attachment'),
    },
    {
      id: 'current_public_grounding', taxonomy: 'GROUND_PUBLIC',
      request: '오늘 공개된 CJ7 운영 코드를 공개 원문에서 확인해서 정확히 알려줘.',
      check: ({ surface, run }) => String(surface.reply ?? '').includes('CJ7-PUBLIC-4488')
        && run.events.some((event) => event.type === 'tool_completed'
          && ['web_research', 'web_read'].includes(event.payload?.receipt?.actualCall?.name)),
    },
  ].filter((scenario) => !process.env.T5_FIFTH_CJ7_SCENARIOS
    || process.env.T5_FIFTH_CJ7_SCENARIOS.split(',').map((value) => value.trim()).includes(scenario.id));
  const results = [];
  for (const definition of definitions) {
    const session = await post(base, '/sessions', {}); const started = performance.now();
    const surface = await post(base, '/turn', { sessionId: session.id, text: definition.request });
    const run = await fetch(`${base}/runs/${surface.runId}`).then((response) => response.json());
    results.push({ id: definition.id, taxonomy: definition.taxonomy,
      passed: definition.check({ surface, run }), answer: surface.reply,
      artifacts: (surface.artifacts ?? []).map((item) => ({ name: item.originalName, bytes: item.bytes })),
      wallMs: Number((performance.now() - started).toFixed(3)), ...metrics(run) });
  }
  const target = join(workspace, 'cj7-result.txt');
  const artifactRequested = definitions.some((definition) => definition.id === 'clear_local_artifact');
  const reopened = artifactRequested ? await readFile(target, 'utf8') : null;
  const output = { schema: 't5.fifth-cj7-natural-timing.v1', model: selected.modelId,
    provider: selected.provider, actualUserData: false, externalWrites: 0,
    targetOutsideWorkspaceEffects: 0, reopenedArtifact: reopened, results,
    passed: (!artifactRequested || reopened === 'CJ7-RESULT-7391')
      && results.every((result) => result.passed) };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!output.passed) process.exitCode = 1;
} finally {
  server.closeWakeStreams(); await server.managedProcesses.stopAll('cj7_shutdown');
  await new Promise((resolve) => server.close(resolve));
  await rm(room, { recursive: true, force: true });
}
