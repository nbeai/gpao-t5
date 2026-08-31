#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAgent } from '../src/agent-loop.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeLocalImageOcr } from '../src/local-image-ocr.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import {
  buildNx1ScenarioReality, evaluateNx1Answer, evaluateNx1PresentationCoverage,
  makeNx1IntegralTool, nx1CandidateRuntimeContext,
} from '../test/helpers/nx-integral-flagship-qualification.js';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtureRoot = join(repository, 'refoundation', 'fixtures', 's6-ng5-dr0');
const oracle = JSON.parse(await readFile(join(repository, 'refoundation', 'evidence',
  's6-ng5-dr0-hidden-oracle-2026-08-31.json'), 'utf8'));
const sourceConnectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const sourceConnections = JSON.parse(await readFile(sourceConnectionFile, 'utf8'));
const selected = sourceConnections.connections?.find((item) => item.id === 'chatgpt_oauth:gpt-5.5')
  ?? sourceConnections.connections?.find((item) => item.id === sourceConnections.activeId && item.kind === 'chatgpt_oauth');
if (!selected?.secretRef || selected.modelId !== 'gpt-5.5') throw new Error('exact gpt-5.5 ChatGPT OAuth connection is required');

const argument = (name, fallback = null) => {
  const exact = process.argv.find((item) => item.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback;
};
const order = String(argument('--order', 'AB')).toUpperCase();
if (!['AB', 'BA'].includes(order)) throw new Error('--order must be AB or BA');
const requestedArms = String(argument('--arms', 'AB')).toUpperCase();
if (!/^(?:A|B|AB|BA)$/u.test(requestedArms)) throw new Error('--arms must be A, B, AB, or BA');
const selectedIds = new Set(String(argument('--scenarios', oracle.scenarios.map((item) => item.id).join(',')))
  .split(',').map((item) => item.trim()).filter(Boolean));
const scenarios = oracle.scenarios.filter((item) => selectedIds.has(item.id));
if (!scenarios.length) throw new Error('at least one known scenario is required');
const outputPath = argument('--output', null);
const helperPath = resolve(process.env.T5_NX1_IMAGE_OCR_HELPER
  ?? '/Applications/GPAO-T5.app/Contents/Resources/runtime/bin/t5-docx-page-renderer');
const ocrProbe = makeLocalImageOcr({ platform: 'darwin', helper: helperPath });

function childBaseline(definition, output) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [join(repository, 'refoundation', 'scripts',
      'run-s6-ng5-dr0-mixed-document-baseline.mjs')], {
      cwd: repository, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env,
        T5_NG5_SCENARIOS: definition.id, T5_NG5_OUTPUT: output },
    });
    child.once('error', reject); child.once('exit', (code) => code === 0 ? done() : reject(new Error(`baseline arm exited ${code}`)));
  });
}

async function runBaseline(definition, room) {
  const output = join(room, `${definition.id}-baseline.json`); const started = performance.now();
  await childBaseline(definition, output); const payload = JSON.parse(await readFile(output, 'utf8'));
  const result = payload.results[0]; return { arm: 'A', kind: 'current_product',
    wallMs: Number((performance.now() - started).toFixed(3)), answer: result.answer,
    machine: evaluateNx1Answer(definition.id, result.answer),
    performance: result.performance, sourceBefore: result.sourceBefore, sourceAfter: result.sourceAfter,
    toolPath: result.tools };
}

async function runCandidate(definition, room) {
  const stateDir = join(room, `${definition.id}-candidate-state`); const workspace = join(room, `${definition.id}-candidate-workspace`);
  const home = join(room, `${definition.id}-candidate-home`); await Promise.all([stateDir, workspace, home].map(
    (path) => mkdir(path, { recursive: true })));
  const connectionFile = join(stateDir, 'model-connection.json'); await writeFile(connectionFile, JSON.stringify({
    version: sourceConnections.version, activeId: selected.id, roleBindings: {}, connections: [selected],
  }), { mode: 0o600 });
  for (const source of definition.sources) await copyFile(join(fixtureRoot, source.path), join(workspace, source.path.split('/').at(-1)));
  const reality = await buildNx1ScenarioReality({ definition, fixtureRoot, ocrProbe });
  const access = makeConsoleModelAccess({ connectionFile, stateDir,
    secretStore: makePlatformSecretStore({ platform: process.platform }) });
  const modelInput = { sessionId: `nx1-${definition.id}`, workspace,
    computer: discoverComputerEnvironment({ userHome: home }) };
  const firstModel = await access.model(modelInput);
  let finalModel = null; let modelTurn = 0;
  const model = { async respond(request) {
    modelTurn += 1;
    if (modelTurn === 1) return firstModel.respond(request);
    finalModel ??= await access.model({ ...modelInput, sessionId: `${modelInput.sessionId}-final` });
    const projection = integral.modelProjection();
    return finalModel.respond({ ...request, messages: [{ role: 'user', content: definition.userPrompt }], tools: [],
      runtimeContext: [
        '[T5 NX VERIFIED CORE CLAIMS — runtime-owned qualification projection]',
        'Use only these verified core claims in the final answer. Excluded findings were verified but their content is intentionally not supplied.',
        'For every claim, include every presentationValues entry. Verification-only evidence values are intentionally not supplied.',
        JSON.stringify(projection),
      ].join('\n'), toolChoice: undefined });
  }, async supersedeLastResponse(...args) { return firstModel.supersedeLastResponse?.(...args); } };
  const integral = makeNx1IntegralTool({ reality, scenarioId: definition.id });
  const started = performance.now(); let toolEnded = false; let firstUsefulMs = null;
  const run = await runAgent({ request: definition.userPrompt, model, tools: [integral.tool],
    requiredInitialTool: 'integral_method', maxModelTurns: 3, maxToolCalls: 1,
    resourceSituationMode: 'off', activeOptimizationMode: 'off',
    runtimeContextProvider: ({ turn }) => turn === 1 ? nx1CandidateRuntimeContext(reality) : null,
    onEvent: (event) => { if (event.type === 'tool_end') toolEnded = true; },
    onAnswerDelta: () => { if (toolEnded && firstUsefulMs == null) firstUsefulMs = performance.now() - started; },
  });
  await Promise.all([firstModel.close?.(), finalModel?.close?.()]);
  const usage = run.modelCalls.reduce((sum, call) => ({
    inputTokens: sum.inputTokens + Number(call.usage?.input_tokens ?? 0),
    outputTokens: sum.outputTokens + Number(call.usage?.output_tokens ?? 0),
    cachedInputTokens: sum.cachedInputTokens + Number(call.usage?.input_tokens_details?.cached_tokens ?? 0),
    requestBytes: sum.requestBytes + Number(call.contextReceipt?.requestBytes ?? 0),
  }), { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, requestBytes: 0 });
  const machine = evaluateNx1Answer(definition.id, run.answer);
  const presentationCoverage = evaluateNx1PresentationCoverage(integral.modelProjection(), run.answer);
  machine.presentationCoverage = presentationCoverage;
  machine.passed = machine.passed && presentationCoverage.passed;
  return { arm: 'B', kind: 'qualification_integral_method',
    wallMs: Number((performance.now() - started).toFixed(3)), firstUsefulMs: firstUsefulMs == null ? null : Number(firstUsefulMs.toFixed(3)),
    answer: run.answer, machine,
    qualification: integral.qualification(), performance: { modelCalls: run.modelCalls.length,
      toolCalls: run.receipts.length, ...usage }, toolPath: run.receipts.map((receipt) => ({
      name: receipt.actualCall?.name ?? receipt.requestedCall?.name, outcome: receipt.outcome,
      state: receipt.result?.state ?? null })) };
}

const room = await mkdtemp(join(tmpdir(), `t5-nx1-${order.toLowerCase()}-`));
try {
  const results = [];
  for (const definition of scenarios) {
    const arms = [];
    const executionOrder = [...order].filter((arm) => requestedArms.includes(arm));
    for (const arm of executionOrder) arms.push(arm === 'A' ? await runBaseline(definition, room) : await runCandidate(definition, room));
    results.push({ scenarioId: definition.id, executionOrder: executionOrder.join(''), arms });
  }
  const payload = { schema: 't5.nx1.integral-flagship-comparison.v1', recordedOn: '2026-09-01', order,
    model: 'gpt-5.5', provider: 'chatgpt_oauth', actualUserData: false, externalWrites: 0,
    oracleProjectedToModel: 0, productChanges: 0, results,
    allCandidateMachinePassed: results.every((item) => { const arm = item.arms.find((candidate) => candidate.arm === 'B');
      return arm ? arm.machine.passed && arm.qualification?.passed : true; }),
    humanBlindEvaluation: 'PENDING', productPromotion: 'NOT_EVALUATED' };
  if (outputPath) await writeFile(resolve(outputPath), JSON.stringify(payload, null, 2));
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} finally { await rm(room, { recursive: true, force: true }); }
