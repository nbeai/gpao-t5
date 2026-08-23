#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { makeStoredModelCredentialCatalog } from '../src/chatgpt-oauth-credential.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { makeDuckDuckGoSearchProvider } from '../src/duckduckgo-search-provider.js';
import { makeBingSearchProvider } from '../src/bing-search-provider.js';
import { makeNaverSearchProvider } from '../src/naver-search-provider.js';
import { makeStoredOpenAIWebSearchProvider } from '../src/openai-web-search-provider.js';
import { naverReadableUrlResolver } from '../src/naver-readable-url.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

const sourceConnectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const requestedModel = option('--model-id');
const requestedTask = option('--task') ?? 'all';
const evidencePath = option('--evidence') ? resolve(option('--evidence')) : null;
if (!['all', 'news', 'images'].includes(requestedTask)) throw new TypeError('--task must be all, news, or images');
const modelIds = requestedModel ? [requestedModel]
  : ['api_key:openai:gpt-5.6-terra', 'chatgpt_oauth:gpt-5.5'];
const keep = process.argv.includes('--keep');
const room = await mkdtemp(join(tmpdir(), 't5-public-web-completion-'));

async function privateConnection(modelId) {
  const stored = JSON.parse(await readFile(sourceConnectionFile, 'utf8'));
  stored.activeId = modelId;
  const file = join(room, `${modelId.replace(/[^a-z0-9.-]+/giu, '-')}.json`);
  await writeFile(file, JSON.stringify(stored), { mode: 0o600 });
  return file;
}

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeWakeStreams();
  server.closeModelConnections();
  await server.closeMessengers();
  await server.closeBrowsers();
  await server.closeWorkspaceConnections();
  await server.managedProcesses.stopAll('public_web_completion_shutdown');
  await new Promise((resolveClose) => server.close(resolveClose));
}

function completedEvents(run, type) {
  return (run?.events ?? []).filter((event) => event.type === type);
}

function toolReceipts(run) {
  return completedEvents(run, 'tool_completed').map((event) => event.payload.receipt);
}

function modelToolCalls(run) {
  return completedEvents(run, 'model_completed').flatMap((event) => event.payload.response?.toolCalls ?? []);
}

function citedUrls(answer) {
  return [...String(answer).matchAll(/https?:\/\/[^\s)\]]+/gu)].map((match) => match[0].replace(/[.,]+$/u, ''));
}

async function turn(base, prompt, timeoutMs = 45_000) {
  const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
  const startedAt = Date.now();
  const response = await fetch(`${base}/turn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, text: prompt }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const surface = await response.json();
  const run = surface.runId
    ? await fetch(`${base}/runs/${surface.runId}`).then((item) => item.json()) : null;
  return { answer: String(surface.reply ?? ''), wallMs: Date.now() - startedAt, run,
    httpStatus: response.status, surfaceError: surface.error ?? null };
}

function newsScore(result, browserNavigations) {
  const receipts = toolReceipts(result.run);
  const research = receipts.find((receipt) => receipt.actualCall?.name === 'web_research')?.result;
  const readableSources = (research?.sources ?? []).filter((source) => source.state === 'read')
    .map((source) => ({
      url: source.source?.finalUrl ?? source.candidateUrl,
      publishedAt: source.source?.publishedAt ?? null,
      modifiedAt: source.source?.modifiedAt ?? null,
    })).filter((source) => source.url);
  const readableUrls = readableSources.map((source) => source.url);
  const queries = modelToolCalls(result.run).filter((call) => call.name === 'web_research')
    .flatMap((call) => call.args?.queries?.length ? call.args.queries : [call.args?.query])
    .map(String);
  const urls = citedUrls(result.answer);
  const recentCutoff = Date.now() - (7 * 24 * 60 * 60 * 1_000);
  const citesRecentDatedSource = readableSources.some((source) => {
    const published = Date.parse(source.publishedAt ?? '');
    return urls.includes(source.url) && Number.isFinite(published)
      && published >= recentCutoff && published <= Date.now() + (24 * 60 * 60 * 1_000);
  });
  const checks = {
    completed: result.run?.status === 'completed' && result.httpStatus === 200,
    underThirtySeconds: result.wallMs < 30_000,
    visibleBrowserNavigations: browserNavigations === 0,
    oneBoundedResearch: receipts.filter((receipt) => receipt.actualCall?.name === 'web_research').length === 1,
    readableSource: readableUrls.length > 0,
    currentYearQuery: queries.some((query) => /2026/u.test(query)),
    twoFocusedQueries: queries.length === 2,
    citesReadSource: urls.some((url) => readableUrls.includes(url)),
    citesRecentDatedSource,
    usefulFirstAnswer: result.answer.length >= 120,
    noCandidateDisclaimer: !/검색 결과 기준|원문.{0,12}확인하지 못/u.test(result.answer),
  };
  return { passed: Object.values(checks).every(Boolean), checks, readableSources, queries };
}

function imageScore(result, browserNavigations) {
  const receipts = toolReceipts(result.run);
  const visual = receipts.find((receipt) => receipt.actualCall?.name === 'visual_reference')?.result;
  const previews = visual?.previews ?? [];
  const checks = {
    completed: result.run?.status === 'completed' && result.httpStatus === 200,
    underThirtySeconds: result.wallMs < 30_000,
    visibleBrowserNavigations: browserNavigations === 0,
    previewedThree: previews.length >= 3,
    embedsThreePreviews: previews.filter((preview) => result.answer.includes(preview.previewUrl)).length >= 3,
    citesThreeSources: previews.filter((preview) => result.answer.includes(preview.sourceUrl)).length >= 3,
  };
  return { passed: Object.values(checks).every(Boolean), checks, previews: previews.map((preview) => ({
    title: preview.title, sourceUrl: preview.sourceUrl, previewUrl: preview.previewUrl,
  })) };
}

const results = [];
try {
  for (const modelId of modelIds) {
    const connectionFile = await privateConnection(modelId);
    const stateDir = join(room, `state-${modelId.split(':').at(-1)}`);
    const workspace = join(stateDir, 'workspace');
    await mkdir(workspace, { recursive: true });
    const access = makeConsoleModelAccess({ connectionFile, stateDir: join(stateDir, 'model') });
    const credentialCatalog = makeStoredModelCredentialCatalog({ file: connectionFile });
    const providers = [
      makeStoredOpenAIWebSearchProvider({ credentialCatalog }), makeNaverSearchProvider(),
      makeDuckDuckGoSearchProvider(), makeBingSearchProvider(),
    ];
    let browserNavigations = 0;
    const serverErrors = [];
    const browserDriver = {
      profile: { id: 'qualification', kind: 'managed_isolated', selected: true },
      userControlActive: () => false,
      async available() { return { available: true, version: 'qualification' }; },
      async navigate() { browserNavigations += 1; throw new Error('visible browser forbidden in public-web qualification'); },
      async close() {},
    };
    const server = makeConsoleServer({
      stateDir, workspace,
      modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
      webSearchProviders: providers,
      webReadOptions: { urlResolvers: [naverReadableUrlResolver] },
      browserDriverFactory: () => browserDriver,
      onError: (error) => serverErrors.push(error?.message ?? String(error)),
    });
    const base = await listen(server);
    try {
      let newsResult = null; let imageResult = null;
      if (requestedTask === 'all' || requestedTask === 'news') {
        browserNavigations = 0;
        const news = await turn(base, '오늘 러우 전쟁 관련 최신 뉴스 하나만 알려줘');
        newsResult = { prompt: '오늘 러우 전쟁 관련 최신 뉴스 하나만 알려줘',
          wallMs: news.wallMs, httpStatus: news.httpStatus, surfaceError: news.surfaceError,
          answer: news.answer, score: newsScore(news, browserNavigations) };
      }
      if (requestedTask === 'all' || requestedTask === 'images') {
        browserNavigations = 0;
        const images = await turn(base, '한국적인 한옥 카페 인테리어 참고 이미지 3개 찾아서 바로 보여줘');
        imageResult = { prompt: '한국적인 한옥 카페 인테리어 참고 이미지 3개 찾아서 바로 보여줘',
          wallMs: images.wallMs, httpStatus: images.httpStatus, surfaceError: images.surfaceError,
          answer: images.answer, score: imageScore(images, browserNavigations) };
      }
      results.push({ modelId, news: newsResult, images: imageResult, serverErrors,
        passed: [newsResult, imageResult].filter(Boolean).every((item) => item.score.passed) });
    } finally {
      await close(server);
    }
  }
  const evidence = {
    schema: 't5.public-web-completion-qualification.v1', recordedAt: new Date().toISOString(), results,
    passed: results.every((result) => result.passed),
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (evidencePath) await writeFile(evidencePath, serialized, { mode: 0o600 });
  process.stdout.write(serialized);
  if (!evidence.passed) process.exitCode = 1;
} finally {
  if (keep) process.stderr.write(`kept ${room}\n`);
  else await rm(room, { recursive: true, force: true });
}
