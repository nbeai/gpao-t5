#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { makeStoredModelCredentialCatalog } from '../src/chatgpt-oauth-credential.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { makeStoredOpenAIWebSearchProvider } from '../src/openai-web-search-provider.js';
import { ResourceLedger } from '../src/resource-ledger.js';
import { deriveResourceReport } from '../src/resource-report.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

const modelId = option('--model-id') ?? 'api_key:openai:gpt-5.6-terra';
const evidencePath = option('--evidence') ? resolve(option('--evidence')) : null;
const sourceConnectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const room = await mkdtemp(join(tmpdir(), 't5-qh4-live-'));
const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
await mkdir(workspace, { recursive: true });

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeWakeStreams(); server.closeModelConnections();
  await server.closeMessengers(); await server.closeBrowsers(); await server.closeWorkspaceConnections();
  await server.managedProcesses.stopAll('qh4_live_shutdown');
  await new Promise((resolveClose) => server.close(resolveClose));
}

function receipts(run) {
  return (run?.events ?? []).filter((event) => event.type === 'tool_completed')
    .map((event) => event.payload.receipt);
}

try {
  const stored = JSON.parse(await readFile(sourceConnectionFile, 'utf8')); stored.activeId = modelId;
  const privateConnection = join(room, 'model-connection.json');
  await writeFile(privateConnection, JSON.stringify(stored), { mode: 0o600 });
  const access = makeConsoleModelAccess({ connectionFile: privateConnection, stateDir: join(stateDir, 'model') });
  const credentialCatalog = makeStoredModelCredentialCatalog({ file: privateConnection });
  const provider = makeStoredOpenAIWebSearchProvider({ credentialCatalog });
  const errors = [];
  const server = makeConsoleServer({
    stateDir, workspace,
    modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
    webSearchProviders: [provider],
    onError: (error) => errors.push(error?.message ?? String(error)),
  });
  const base = await listen(server);
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const prompt = '한국적인 한옥 카페 인테리어 참고 이미지 3개를 실제 이미지로 바로 보여줘.';
    const startedAt = performance.now();
    const response = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: prompt }), signal: AbortSignal.timeout(90_000),
    });
    const surface = await response.json(); const wallMs = Math.round(performance.now() - startedAt);
    const run = surface.runId
      ? await fetch(`${base}/runs/${surface.runId}`).then((item) => item.json()) : null;
    const allReceipts = receipts(run);
    const visualReceipts = allReceipts.filter((receipt) => receipt.actualCall?.name === 'visual_reference');
    const visual = visualReceipts[0]?.result ?? null;
    const previewCount = visual?.previews?.length ?? 0; const failureCount = visual?.failures?.length ?? 0;
    const factualWebCalls = allReceipts.filter((receipt) => (
      ['web_research', 'web_search', 'web_read'].includes(receipt.actualCall?.name)
    )).length;
    const resource = deriveResourceReport(await new ResourceLedger(join(stateDir, 'resources')).read());
    const identityComplete = (visual?.previews ?? []).every((preview) => (
      /^https?:\/\//u.test(preview.sourceUrl ?? '')
      && /^https?:\/\//u.test(preview.imageSourceUrl ?? '')
      && preview.sourceUrl !== preview.imageSourceUrl
      && preview.attachmentId && preview.previewUrl && preview.sha256
    ));
    const checks = {
      completedRun: run?.status === 'completed' && response.status === 200,
      visualCalledOnce: visualReceipts.length === 1,
      requestedThree: visual?.coverage?.requested === 3,
      noZeroPreviewZeroFailure: previewCount > 0 || failureCount > 0,
      exactCoverageOrTypedShortfall: previewCount === 3
        || (previewCount < 3 && visual?.verificationMissing === true && failureCount > 0),
      sourceDirectIdentity: identityComplete,
      noVisibleBrowser: allReceipts.every((receipt) => receipt.actualCall?.name !== 'browser'),
      noFactualWebPreviewPromotion: previewCount === 0 || identityComplete,
      boundedProviderCalls: (visual?.providerCalls?.length ?? 0) <= 1,
      resourceSettled: resource.unsettled === 0,
      userAnswerPresent: Boolean(String(surface.reply ?? '').trim()),
    };
    const report = {
      schema: 't5.qh4-visual-evidence-live.v1', recordedAt: new Date().toISOString(), modelId,
      environment: 'isolated_home_data_workspace_public_provider',
      result: {
        runId: surface.runId ?? null, wallMs, modelCalls: resource.modelCallsObserved,
        toolCalls: resource.toolCallsObserved, internalCalls: resource.internalCallsObserved,
        providerTokens: resource.providerTokensCommitted, providerCalls: visual?.providerCalls ?? [],
        factualWebCalls,
        requested: 3, previewCount, failureCount,
        providerQualification: visual?.providerQualification ?? null,
        failureCodes: [...new Set((visual?.failures ?? []).map((failure) => failure.failureCode))],
        checks, serverErrors: errors,
      },
      passed: Object.values(checks).every(Boolean) && errors.length === 0,
    };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (evidencePath) await writeFile(evidencePath, serialized, { mode: 0o600 });
    process.stdout.write(serialized);
    if (!report.passed) process.exitCode = 1;
  } finally { await close(server); }
} finally {
  if (process.argv.includes('--keep')) process.stderr.write(`kept ${room}\n`);
  else await rm(room, { recursive: true, force: true });
}
