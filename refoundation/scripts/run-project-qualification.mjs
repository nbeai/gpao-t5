#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { runAgent } from '../src/agent-loop.js';
import { makeExecTool } from '../src/exec-tool.js';
import { makeOpenAIResponsesModel } from '../src/openai-responses-model.js';
import { makeChatGptResponsesModel } from '../src/chatgpt-responses-model.js';
import {
  makeStoredChatGptCredentialSource, makeStoredModelCredentialCatalog,
} from '../src/chatgpt-oauth-credential.js';
import { makePromptDumper } from '../src/prompt-dump.js';
import {
  PROJECT_CASES, assessProjectCase, materializeProjectCase, snapshotProject,
} from '../src/project-qualification.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const evidencePath = resolve(option('--evidence') ?? 'refoundation/evidence/r1-project-qualification.json');
const keep = process.argv.includes('--keep');
const connectionFile = process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json');
const selected = await makeStoredModelCredentialCatalog({ file: connectionFile }).select(option('--connection'));

function makeModel({ instructions, promptDir, responseDir }) {
  const modelId = option('--model') ?? selected.modelId;
  if (selected.kind === 'chatgpt_oauth') {
    const responseDumper = makePromptDumper({ directory: responseDir });
    return {
      auth: selected.kind,
      modelId,
      model: makeChatGptResponsesModel({
        credentials: makeStoredChatGptCredentialSource({ file: connectionFile }),
        model: modelId,
        endpoint: process.env.T5_REFOUNDATION_CHATGPT_ENDPOINT,
        instructions,
        dump: makePromptDumper({ directory: promptDir }),
        observeResponse: ({ status, raw }) => responseDumper({
          body: { raw }, meta: { provider: 'chatgpt_oauth', status },
        }),
      }),
    };
  }
  const base = String(selected.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  return {
    auth: selected.kind,
    modelId,
    model: makeOpenAIResponsesModel({
      apiKey: selected.apiKey,
      model: modelId,
      endpoint: process.env.T5_REFOUNDATION_OPENAI_ENDPOINT ?? `${base}/responses`,
      instructions,
      dump: makePromptDumper({ directory: promptDir, sensitiveValues: [selected.apiKey] }),
    }),
  };
}

async function allTextFiles(root) {
  const out = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) out.push(path);
    }
  }
  await walk(root);
  return out;
}

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const runtimeFiles = [
  'refoundation/src/agent-loop.js', 'refoundation/src/exec-tool.js',
  'refoundation/src/openai-responses-model.js', 'refoundation/src/chatgpt-responses-model.js',
  'refoundation/src/chatgpt-oauth-credential.js', 'refoundation/src/project-qualification.js',
  'refoundation/scripts/run-project-qualification.mjs',
];
const runtimeHash = createHash('sha256');
for (const file of runtimeFiles) {
  runtimeHash.update(file); runtimeHash.update('\0');
  runtimeHash.update(await readFile(resolve(file))); runtimeHash.update('\0');
}
let runtimeFilesDirty = false;
try { execFileSync('git', ['diff', '--quiet', 'HEAD', '--', ...runtimeFiles]); }
catch { runtimeFilesDirty = true; }

const cases = [];
const rooms = [];
for (const definition of PROJECT_CASES) {
  const room = await mkdtemp(join(tmpdir(), `t5-r1-${definition.id}-`));
  rooms.push(room);
  const home = join(room, 'home');
  const workspace = join(room, 'workspace');
  const data = join(room, 'data');
  const promptDir = join(data, 'prompt-dump');
  const responseDir = join(data, 'response-dump');
  await Promise.all([home, workspace, data].map((path) => mkdir(path, { recursive: true })));
  await materializeProjectCase(definition, workspace);
  const tool = makeExecTool({ workspace });
  const baselineTest = await tool.execute({ command: 'npm test', cwd: null });
  const before = await snapshotProject(workspace);
  const previousHome = process.env.T5_REFOUNDATION_HOME;
  process.env.T5_REFOUNDATION_HOME = home;
  let agentResult;
  let runError = null;
  const instructions = [
    'You are T5 operating an isolated software project.',
    'Understand the user goal, inspect the project with exec, identify the root cause, edit the source, and run the tests.',
    'Do not modify tests or package.json. Do not ask the user to run commands you can run.',
    'Read every tool observation. If a command or approach fails, choose another and continue.',
    'Do not claim completion until the project tests have actually passed.',
    `The workspace is ${workspace}. Use cwd null for its root.`,
  ].join('\n');
  const selectedModel = makeModel({ instructions, promptDir, responseDir });
  try {
    agentResult = await runAgent({
      request: definition.request,
      model: selectedModel.model,
      tools: [tool],
      maxModelTurns: 20,
    });
  } catch (error) {
    runError = error?.message ?? String(error);
    agentResult = { status: 'failed', answer: null, receipts: [], modelCalls: [], modelTurns: 0 };
  } finally {
    if (previousHome == null) delete process.env.T5_REFOUNDATION_HOME;
    else process.env.T5_REFOUNDATION_HOME = previousHome;
  }
  const after = await snapshotProject(workspace);
  const finalTest = await tool.execute({ command: 'npm test', cwd: null });
  const verdict = assessProjectCase({ definition, before, after, baselineTest, finalTest, agentResult });
  const diagnosticFiles = [
    ...await allTextFiles(promptDir).catch(() => []),
    ...await allTextFiles(responseDir).catch(() => []),
  ];
  const diagnosticText = (await Promise.all(diagnosticFiles.map((file) => readFile(file, 'utf8')))).join('\n');
  const credentialLikeMatches = [
    /sk-[A-Za-z0-9_-]{10,}/g, /"authorization"\s*:/gi,
    /"(?:access|refresh)_token"\s*:/gi,
  ].flatMap((pattern) => diagnosticText.match(pattern) ?? []);
  const sourceChanges = definition.sourcePaths.filter((path) => before[path] !== after[path]);
  cases.push({
    id: definition.id,
    request: definition.request,
    auth: selectedModel.auth,
    requestModel: selectedModel.modelId,
    modelCalls: agentResult.modelCalls,
    answer: agentResult.answer,
    toolCalls: agentResult.receipts.map((receipt) => ({
      name: receipt.actualCall?.name ?? receipt.requestedCall?.name,
      command: receipt.actualCall?.args?.command ?? null,
      outcome: receipt.outcome,
      exitCode: receipt.result?.exitCode ?? null,
    })),
    baselineExitCode: baselineTest.exitCode,
    finalExitCode: finalTest.exitCode,
    sourceChanges,
    checks: verdict.checks,
    credentialLikeMatches,
    runError,
    passed: verdict.passed && credentialLikeMatches.length === 0,
    ...(keep ? { room } : {}),
  });
}

const evidence = {
  schema: 't5.refoundation.project-qualification.v1',
  observedAt: new Date().toISOString(),
  sourceCommit,
  runtimeDigest: runtimeHash.digest('hex'),
  runtimeFilesDirty,
  connection: { kind: selected.kind, modelId: selected.modelId },
  cases,
};
evidence.passed = !runtimeFilesDirty && cases.length === PROJECT_CASES.length && cases.every((entry) => entry.passed);
await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ evidence: evidencePath, passed: evidence.passed, cases: cases.map((entry) => ({
  id: entry.id, passed: entry.passed, checks: entry.checks,
})) }, null, 2));
if (!keep) await Promise.all(rooms.map((room) => rm(room, { recursive: true, force: true })));
if (!evidence.passed) process.exit(1);
