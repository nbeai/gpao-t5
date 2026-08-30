#!/usr/bin/env node
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { makeStoredModelCredentialCatalog } from '../src/chatgpt-oauth-credential.js';
import { makeStoredOpenAIWebSearchProvider } from '../src/openai-web-search-provider.js';
import { makeDuckDuckGoSearchProvider } from '../src/duckduckgo-search-provider.js';
import { makeNaverSearchProvider } from '../src/naver-search-provider.js';
import { makeBingSearchProvider } from '../src/bing-search-provider.js';
import { naverReadableUrlResolver } from '../src/naver-readable-url.js';

const sourceFile = process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), 'Library', 'Application Support', 'GPAO-T5', 'credentials', 'model-connection.json');
const source = JSON.parse(await readFile(sourceFile, 'utf8'));
const requestedId = process.env.T5_SIXTH_MODEL_CONNECTION_ID ?? source.activeId;
const selected = source.connections.find((item) => item.id === requestedId);
if (!selected?.secretRef) throw new Error('exact secret-backed model connection is required');

const room = await mkdtemp(join(tmpdir(), 't5-s6-p0-interactive-'));
const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
await Promise.all([stateDir, workspace].map((path) => mkdir(path, { recursive: true })));
const connectionFile = join(stateDir, 'model-connection.json');
await writeFile(connectionFile, JSON.stringify({ version: source.version,
  connections: [selected], activeId: selected.id, roleBindings: {} }), { mode: 0o600 });
await chmod(connectionFile, 0o600);
const secretStore = makePlatformSecretStore({ platform: process.platform });
const access = makeConsoleModelAccess({ connectionFile, stateDir, secretStore });
const credentialCatalog = makeStoredModelCredentialCatalog({ file: connectionFile, secretStore });
const server = makeConsoleServer({ stateDir, workspace, capabilitySurfaceMode: 'directory-first-v1',
  workAdmissionMode: 'action-v1', learningReviewMode: 'off', memoryFlushMode: 'off',
  modelFactory: (input) => access.model(input), modelStatus: () => access.status(),
  webSearchProviders: [makeStoredOpenAIWebSearchProvider({ credentialCatalog }),
    makeNaverSearchProvider(), makeDuckDuckGoSearchProvider(), makeBingSearchProvider()],
  webReadOptions: { urlResolvers: [naverReadableUrlResolver] } });

async function post(base, path, body) {
  const response = await fetch(`${base}${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${value.error ?? 'request failed'}`);
  return value;
}

function metrics(run) {
  const models = run.events.filter((event) => event.type === 'model_completed');
  const tools = run.events.filter((event) => event.type === 'tool_completed');
  return { modelCalls: models.length, toolCalls: tools.length,
    tools: tools.map((event) => event.payload?.receipt?.actualCall?.name).filter(Boolean),
    toolDetails: tools.map((event) => ({ name: event.payload?.receipt?.actualCall?.name,
      args: event.payload?.receipt?.requestedCall?.args,
      state: event.payload?.receipt?.result?.state ?? null,
      sourceCount: event.payload?.receipt?.result?.sources?.length ?? null,
      readableCount: event.payload?.receipt?.result?.readableCount ?? null })),
    tokens: models.reduce((sum, event) => sum + Number(event.payload?.response?.usage?.total_tokens ?? 0), 0),
    requestBytes: models.reduce((sum, event) => sum
      + Number(event.payload?.response?.contextReceipt?.requestBytes ?? 0), 0) || null };
}

await new Promise((resolve, reject) => {
  server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
});
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const weatherSession = await post(base, '/sessions', {}); const weatherStarted = performance.now();
  const weather = await post(base, '/turn', { sessionId: weatherSession.id,
    text: '오늘 서울 날씨를 현재 공개 출처에서 확인해서 간단히 알려줘.' });
  const weatherEnded = performance.now();
  const weatherRun = await fetch(`${base}/runs/${weather.runId}`).then((response) => response.json());
  const webReceipt = weatherRun.events.find((event) => event.type === 'tool_completed'
    && event.payload?.receipt?.actualCall?.name === 'web_research')?.payload?.receipt;

  const attachmentSession = await post(base, '/sessions', {});
  const canary = 'S6-ATTACHMENT-7391';
  const uploadedResponse = await fetch(`${base}/attachments?sessionId=${attachmentSession.id}&filename=s6-note.txt`, {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: canary,
  });
  const uploaded = await uploadedResponse.json();
  if (!uploadedResponse.ok) throw new Error(`attachment upload failed: ${uploaded.error ?? uploadedResponse.status}`);
  const attachmentStarted = performance.now();
  const attachment = await post(base, '/turn', { sessionId: attachmentSession.id,
    text: '첨부한 메모의 코드를 읽어서 그대로 알려줘.', attachmentIds: [uploaded.attachmentId] });
  const attachmentRun = await fetch(`${base}/runs/${attachment.runId}`).then((response) => response.json());

  const weatherMetrics = metrics(weatherRun); const attachmentMetrics = metrics(attachmentRun);
  const output = { schema: 't5.s6-p0-interactive-qualification.v1', model: selected.modelId,
    provider: selected.provider, actualUserData: false, externalWrites: 0,
    weather: { passed: weatherMetrics.modelCalls <= 3 && weatherMetrics.toolCalls <= 2
      && weatherMetrics.tools[0] === 'web_research' && !weatherMetrics.tools.includes('tool_search')
      && !weatherMetrics.tools.includes('work_completion') && webReceipt?.result?.observedPageContent === true
      && /서울/u.test(weather.reply ?? ''), wallMs: Number((weatherEnded - weatherStarted).toFixed(3)),
    answer: weather.reply, ...weatherMetrics,
    sourceCount: webReceipt?.result?.sources?.length ?? 0 },
    attachment: { passed: attachmentMetrics.modelCalls === 2 && attachmentMetrics.toolCalls === 1
      && attachmentMetrics.tools[0] === 'attachment' && String(attachment.reply ?? '').includes(canary),
    wallMs: Number((performance.now() - attachmentStarted).toFixed(3)), ...attachmentMetrics },
  };
  output.passed = output.weather.passed && output.attachment.passed;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!output.passed) process.exitCode = 1;
} finally {
  server.closeWakeStreams(); await server.managedProcesses.stopAll('s6_p0_shutdown');
  await new Promise((resolve) => server.close(resolve));
  await rm(room, { recursive: true, force: true });
}
