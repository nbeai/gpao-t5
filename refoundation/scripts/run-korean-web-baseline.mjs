#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { makeBingSearchProvider } from '../src/bing-search-provider.js';
import { makeStoredModelCredentialCatalog } from '../src/chatgpt-oauth-credential.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { makeDuckDuckGoSearchProvider } from '../src/duckduckgo-search-provider.js';
import { scoreClosedSetTable, summarizeWebRun } from '../src/korean-web-baseline.js';
import { makeNaverSearchProvider } from '../src/naver-search-provider.js';
import { makeStoredOpenAIWebSearchProvider } from '../src/openai-web-search-provider.js';

function option(name) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; }
const datasetPath = option('--dataset') ? resolve(option('--dataset')) : null;
const evidencePath = option('--evidence') ? resolve(option('--evidence')) : null;
const requestedModelId = option('--model-id');
const keep = process.argv.includes('--keep');
if (!datasetPath) throw new TypeError('--dataset must point to the pinned K-BrowseComp JSONL');

const configRoot = resolve(new URL('../config/', import.meta.url).pathname);
const selection = JSON.parse(await readFile(join(configRoot, 'w8-korean-web-baseline.json'), 'utf8'));
const shapeTasks = JSON.parse(await readFile(join(configRoot, 'w8-korean-web-shape-tasks.json'), 'utf8'));
const shapeGold = JSON.parse(await readFile(join(configRoot, 'w8-korean-web-shape-gold.json'), 'utf8'));
const sourceConnectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const room = await mkdtemp(join(tmpdir(), 't5-w8-korean-web-'));

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function parseJsonObject(text) {
  const source = String(text ?? '').trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '');
  try { return JSON.parse(source); } catch { /* find one bounded object */ }
  const start = source.indexOf('{'); const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('grader did not return a JSON object');
  return JSON.parse(source.slice(start, end + 1));
}
function contaminated(value) {
  return /(?:k-?browsecomp|ko_browsecomp|huggingface\.co\/datasets\/prometheus-eval|github\.com\/prometheus-eval)/iu
    .test(String(value ?? ''));
}
function filteredProvider(provider) {
  return {
    id: provider.id, label: provider.label,
    available: (...args) => provider.available(...args),
    async search(...args) {
      const rows = await provider.search(...args);
      return rows.filter((row) => !contaminated(`${row.url} ${row.title} ${row.snippet}`));
    },
  };
}
function filteredFetch(input, init) {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : String(input?.url ?? '');
  if (contaminated(url)) return Promise.resolve(new Response('benchmark contamination source blocked', { status: 451 }));
  return fetch(input, init);
}
async function listen(server) {
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  server.closeWakeStreams(); server.closeModelConnections();
  await server.closeMessengers(); await server.closeBrowsers(); await server.closeWorkspaceConnections();
  await server.managedProcesses.stopAll('w8_korean_web_shutdown');
  await new Promise((resolveClose) => server.close(resolveClose));
}
async function privateConnection(modelId, suffix) {
  const stored = JSON.parse(await readFile(sourceConnectionFile, 'utf8'));
  stored.activeId = modelId;
  const path = join(room, `${suffix}-${modelId.replace(/[^a-z0-9.-]+/giu, '-')}.json`);
  await writeFile(path, JSON.stringify(stored), { mode: 0o600 });
  return path;
}
async function executeTurn(base, prompt) {
  const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
  const startedAt = Date.now();
  const response = await fetch(`${base}/turn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, text: prompt }), signal: AbortSignal.timeout(300_000),
  });
  const surface = await response.json();
  const run = surface.runId ? await fetch(`${base}/runs/${surface.runId}`).then((item) => item.json()) : null;
  return {
    answer: String(surface.reply ?? ''), httpStatus: response.status, runStatus: run?.status ?? null,
    wallMs: Date.now() - startedAt, run, performance: summarizeWebRun(run),
  };
}

const datasetBytes = await readFile(datasetPath);
if (sha256(datasetBytes) !== selection.kBrowseComp.datasetSha256) throw new Error('K-BrowseComp dataset digest differs from the sealed selection');
const dataset = datasetBytes.toString('utf8').trim().split(/\n/u).map(JSON.parse);
for (const sample of selection.kBrowseComp.samples) {
  const row = dataset[sample.index];
  if (!row || sha256(row.problem) !== sample.problemSha256 || sha256(row.answer) !== sample.answerSha256) {
    throw new Error(`K-BrowseComp sealed sample ${sample.index} differs from the pinned data`);
  }
}

const modelIds = requestedModelId ? [requestedModelId]
  : ['api_key:openai:gpt-5.6-terra', 'chatgpt_oauth:gpt-5.5'];
const results = [];
for (const modelId of modelIds) {
  const connectionFile = await privateConnection(modelId, 'solver');
  const stateDir = join(room, `state-${modelId.split(':').at(-1)}`); const workspace = join(stateDir, 'workspace');
  await mkdir(workspace, { recursive: true });
  const access = makeConsoleModelAccess({ connectionFile, stateDir: join(stateDir, 'model') });
  const credentialCatalog = makeStoredModelCredentialCatalog({ file: connectionFile });
  const webSearchProviders = [
    makeStoredOpenAIWebSearchProvider({ credentialCatalog }), makeNaverSearchProvider(),
    makeDuckDuckGoSearchProvider(), makeBingSearchProvider(),
  ].map(filteredProvider);
  const server = makeConsoleServer({
    stateDir, workspace, modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
    webSearchProviders, webReadOptions: { fetchImpl: filteredFetch },
  });
  const base = await listen(server);
  try {
    const kBrowseComp = [];
    for (const sample of selection.kBrowseComp.samples) {
      process.stderr.write(`[w8] ${modelId} K-BrowseComp ${sample.index}\n`);
      const source = dataset[sample.index]; const result = await executeTurn(base, source.problem);
      kBrowseComp.push({ sample, gold: source.answer, ...result });
    }
    const shape = [];
    for (const task of shapeTasks.tasks) {
      process.stderr.write(`[w8] ${modelId} shape ${task.id}\n`);
      const gold = shapeGold.tasks.find((entry) => entry.id === task.id);
      const result = await executeTurn(base, task.prompt);
      shape.push({ task, score: scoreClosedSetTable({ answer: result.answer, task, gold }), ...result });
    }
    results.push({ modelId, kBrowseComp, shape });
  } finally { await close(server); }
}

const graderConnectionFile = await privateConnection('api_key:openai:gpt-5.6-terra', 'grader');
const graderAccess = makeConsoleModelAccess({ connectionFile: graderConnectionFile, stateDir: join(room, 'grader-model') });
for (const model of results) {
  for (const result of model.kBrowseComp) {
    const reviewer = await graderAccess.model({
      sessionId: `w8-grader-${randomUUID()}`, workspace: join(room, 'grader-workspace'), computer: {},
      instructionsOverride: [
        'You strictly grade one Korean short-answer web research result against a supplied gold answer.',
        'Ignore harmless punctuation, spacing, romanization, Hanja, and an explanatory appositive that preserves the same referent.',
        'If the response gives multiple materially different candidates, no final answer, or contradicts the gold, mark correct false.',
        'Do not solve the question. Return only JSON with correct boolean, extractedFinalAnswer string, and one-sentence reason.',
      ].join('\n'),
    });
    const response = await reviewer.respond({ messages: [{ role: 'user', content: JSON.stringify({
      question: dataset[result.sample.index].problem, goldAnswer: result.gold, response: result.answer,
    }) }], tools: [] });
    result.grading = parseJsonObject(response.text);
  }
}

const publicResults = results.map((model) => ({
  modelId: model.modelId,
  kBrowseComp: model.kBrowseComp.map((result) => ({
    sample: result.sample, answer: result.answer, grading: result.grading,
    httpStatus: result.httpStatus, runStatus: result.runStatus, wallMs: result.wallMs, performance: result.performance,
    contaminatedObservation: result.performance.observedUrls.some(contaminated),
  })),
  shape: model.shape.map((result) => ({
    id: result.task.id, answer: result.answer, score: result.score,
    httpStatus: result.httpStatus, runStatus: result.runStatus, wallMs: result.wallMs, performance: result.performance,
  })),
}));
for (const model of publicResults) {
  const kCorrect = model.kBrowseComp.filter((result) => result.grading?.correct === true).length;
  model.summary = {
    kBrowseCompCorrect: kCorrect, kBrowseCompTotal: model.kBrowseComp.length,
    kBrowseCompAccuracy: model.kBrowseComp.length ? kCorrect / model.kBrowseComp.length : 0,
    shapePurposeComplete: model.shape.filter((result) => result.score.exactPurposeComplete).length,
    shapeTotal: model.shape.length,
    meanItemF1: model.shape.reduce((sum, result) => sum + result.score.item.f1, 0) / model.shape.length,
    meanCellF1: model.shape.reduce((sum, result) => sum + result.score.cells.f1, 0) / model.shape.length,
    meanRowF1: model.shape.reduce((sum, result) => sum + result.score.rows.f1, 0) / model.shape.length,
    totalWallMs: [...model.kBrowseComp, ...model.shape].reduce((sum, result) => sum + result.wallMs, 0),
    totalModelTurns: [...model.kBrowseComp, ...model.shape].reduce((sum, result) => sum + result.performance.modelTurns, 0),
    totalToolCalls: [...model.kBrowseComp, ...model.shape].reduce((sum, result) => sum + result.performance.toolCalls, 0),
    totalTokens: [...model.kBrowseComp, ...model.shape].reduce((sum, result) => sum + result.performance.usage.total, 0),
  };
}
const evidence = {
  schema: 't5.w8-korean-web-baseline.v1', recordedAt: new Date().toISOString(), actualUserData: false,
  benchmarkBoundary: {
    kBrowseComp: 'official verified data subset with T5 local gold-equivalence grading; not an official leaderboard run',
    koWideSearch: 'official methodology only; gated gold not accessed and no official score claimed',
    contaminationSourcesBlocked: true, browserIncluded: false,
  },
  source: {
    repositoryCommit: selection.kBrowseComp.repositoryCommit,
    datasetSha256: selection.kBrowseComp.datasetSha256,
    selectedIndexes: selection.kBrowseComp.samples.map((sample) => sample.index),
  },
  results: publicResults,
  executionComplete: publicResults.every((model) => model.kBrowseComp.every((result) => result.runStatus === 'completed'
    && !result.contaminatedObservation) && model.shape.every((result) => result.runStatus === 'completed')),
  room: keep ? room : null,
};
const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
if (evidencePath) { await mkdir(dirname(evidencePath), { recursive: true }); await writeFile(evidencePath, serialized, 'utf8'); }
process.stdout.write(serialized);
if (!evidence.executionComplete) process.exitCode = 1;
if (!keep) await rm(room, { recursive: true, force: true });
