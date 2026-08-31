#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeLocalImageOcr } from '../src/local-image-ocr.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import {
  buildNx1ScenarioReality, evaluateNx1Answer, makeNx1HumanClosureTool, makeNx1IntegralTool,
  NX1_HUMAN_CLOSURE_INSTRUCTIONS, NX1_REALITY_CLOSURE_INSTRUCTIONS,
  nx1CandidateRuntimeContext, nx1HumanClosureRuntimeContext,
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
  const firstModel = await access.model({ ...modelInput,
    instructionsOverride: NX1_REALITY_CLOSURE_INSTRUCTIONS });
  const integral = makeNx1IntegralTool({ reality, scenarioId: definition.id });
  const started = performance.now(); const modelResponses = []; const toolPath = [];
  let finalModel = null;
  const toolDefinition = (tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters });
  const accumulateUsage = () => modelResponses.reduce((sum, response) => ({
    inputTokens: sum.inputTokens + Number(response.usage?.input_tokens ?? 0),
    outputTokens: sum.outputTokens + Number(response.usage?.output_tokens ?? 0),
    cachedInputTokens: sum.cachedInputTokens + Number(response.usage?.input_tokens_details?.cached_tokens ?? 0),
    requestBytes: sum.requestBytes + Number(response.contextReceipt?.requestBytes ?? 0),
  }), { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, requestBytes: 0 });
  try {
    const realityResponse = await firstModel.respond({ messages: [{ role: 'user', content: definition.userPrompt }],
      tools: [toolDefinition(integral.tool)], runtimeContext: nx1CandidateRuntimeContext(reality),
      toolChoice: { requiredToolName: 'integral_method' } });
    modelResponses.push(realityResponse);
    const realityCalls = Array.isArray(realityResponse.toolCalls) ? realityResponse.toolCalls : [];
    const realityCall = realityCalls.length === 1 && realityCalls[0].name === 'integral_method' ? realityCalls[0] : null;
    const realityResult = realityCall ? await integral.tool.execute(realityCall.args) : {
      state: 'candidate_invalid', reason: 'integral_method_call_missing',
    };
    toolPath.push({ name: 'integral_method', outcome: realityCall ? 'succeeded' : 'not_executed', state: realityResult.state });
    if (realityResult.state !== 'verified') return { arm: 'B', kind: 'qualification_integral_method',
      wallMs: Number((performance.now() - started).toFixed(3)), firstUsefulMs: null, answer: null,
      machine: { passed: false, reason: 'reality_closure_failed' }, qualification: {
        reality: integral.qualification(), human: null }, performance: { modelCalls: modelResponses.length,
        toolCalls: toolPath.length, ...accumulateUsage() }, toolPath };

    const verifiedReality = integral.verifiedReality();
    const closure = makeNx1HumanClosureTool({ verifiedReality, scenarioId: definition.id });
    finalModel = await access.model({ ...modelInput, sessionId: `${modelInput.sessionId}-human-closure`,
      instructionsOverride: NX1_HUMAN_CLOSURE_INSTRUCTIONS });
    const closureResponse = await finalModel.respond({ messages: [{ role: 'user', content: definition.userPrompt }],
      tools: [toolDefinition(closure.tool)], runtimeContext: nx1HumanClosureRuntimeContext(verifiedReality),
      toolChoice: { requiredToolName: 'human_closure' } });
    modelResponses.push(closureResponse);
    const closureCalls = Array.isArray(closureResponse.toolCalls) ? closureResponse.toolCalls : [];
    const closureCall = closureCalls.length === 1 && closureCalls[0].name === 'human_closure' ? closureCalls[0] : null;
    const closureResult = closureCall ? await closure.tool.execute(closureCall.args) : {
      state: 'closure_invalid', reason: 'human_closure_call_missing',
    };
    toolPath.push({ name: 'human_closure', outcome: closureCall ? 'succeeded' : 'not_executed', state: closureResult.state });
    const answer = closureResult.state === 'verified' ? closureResult.finalAnswer : null;
    const firstUsefulMs = answer ? Number((performance.now() - started).toFixed(3)) : null;
    return { arm: 'B', kind: 'qualification_integral_method_human_closure',
      wallMs: Number((performance.now() - started).toFixed(3)), firstUsefulMs, answer,
      machine: closureResult.state === 'verified'
        ? closure.qualification()?.answerQuality ?? { passed: false }
        : { passed: false, reason: 'human_closure_failed' },
      qualification: { reality: integral.qualification(), human: closure.qualification() },
      performance: { modelCalls: modelResponses.length, toolCalls: toolPath.length,
        ...accumulateUsage() }, toolPath };
  } finally { await Promise.all([firstModel.close?.(), finalModel?.close?.()]); }
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
      return arm ? arm.machine.passed && arm.qualification?.reality?.passed
        && arm.qualification?.human?.passed : true; }),
    humanBlindEvaluation: 'PENDING', productPromotion: 'NOT_EVALUATED' };
  if (outputPath) await writeFile(resolve(outputPath), JSON.stringify(payload, null, 2));
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} finally { await rm(room, { recursive: true, force: true }); }
